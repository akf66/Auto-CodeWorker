//! Sandboxes on other machines. A sandbox host is a small server (`acw sandbox-host`) that runs
//! on each machine with sandbox capacity and wraps that machine's own provider (Firecracker, or
//! the local one for trying things out). The Engine's `remote` provider spreads sandboxes over the
//! hosts it is configured with and talks to them over HTTP with one shared token.
//!
//! This protocol is Auto-CodWorker's own. It is also the place to attach a hosted sandbox service:
//! implement the same `SandboxProvider` trait against that service's API.
//!
//!   GET    /v1/info                         { name, isolated, count }
//!   POST   /v1/sandboxes                    { id, project, template, egress } -> { host, template }
//!   GET    /v1/sandboxes/{id}               200 or 404
//!   DELETE /v1/sandboxes/{id}
//!   POST   /v1/sandboxes/{id}/exec          { cmd, cwd, env, timeout_ms, idle_ms, stdin } -> lines of JSON:
//!                                           {"line": "..."} per output line, {"hb": 1} while silent,
//!                                           {"done": {...}} or {"error": "..."} last. Closing the
//!                                           connection cancels the command.
//!   PUT    /v1/sandboxes/{id}/files?path=   body: the file
//!   GET    /v1/sandboxes/{id}/files?path=
//!   POST   /v1/sandboxes/{id}/pause | resume

use acw_sandbox::{CancellationToken, Created, ExecResult, ExecSpec, LineSink, SandboxProvider, SandboxSpec};
use anyhow::{anyhow, bail, Result};
use async_trait::async_trait;
use axum::body::{Body, Bytes};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine as _;
use futures::StreamExt;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

// ---------------------------------------------------------------- the host side

pub struct Host {
    pub provider: Arc<dyn SandboxProvider>,
    pub token: String,
    pub name: String,
    count: AtomicUsize,
}

type H = State<Arc<Host>>;

fn authed(h: &Host, headers: &HeaderMap) -> bool {
    let got = headers.get("authorization").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).unwrap_or_default();
    !h.token.is_empty() && got.len() == h.token.len() && got.bytes().zip(h.token.bytes()).fold(0u8, |a, (x, y)| a | (x ^ y)) == 0
}

fn fail(e: anyhow::Error) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))).into_response()
}

pub fn host_app(provider: Arc<dyn SandboxProvider>, token: &str, name: &str) -> Router {
    let host = Arc::new(Host { provider, token: token.to_owned(), name: name.to_owned(), count: AtomicUsize::new(0) });
    Router::new()
        .route("/v1/info", get(|State(h): H| async move { Json(json!({ "name": h.name, "provider": h.provider.name(), "isolated": h.provider.isolated(), "count": h.count.load(Ordering::SeqCst) })) }))
        .route("/v1/sandboxes", post(create))
        .route("/v1/sandboxes/{id}", get(exists).delete(destroy))
        .route("/v1/sandboxes/{id}/exec", post(exec))
        .route("/v1/sandboxes/{id}/files", get(get_file).put(put_file))
        .route("/v1/sandboxes/{id}/{action}", post(pause_resume))
        .layer(axum::middleware::from_fn_with_state(host.clone(), |State(h): H, req: axum::extract::Request, next: axum::middleware::Next| async move {
            if !authed(&h, req.headers()) {
                return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "需要沙箱主机的令牌" }))).into_response();
            }
            next.run(req).await
        }))
        .layer(axum::extract::DefaultBodyLimit::max(512 * 1024 * 1024))
        .with_state(host)
}

async fn create(State(h): H, Json(b): Json<Value>) -> Response {
    let spec = SandboxSpec {
        id: b["id"].as_str().unwrap_or_default().to_owned(),
        project: b["project"].as_str().unwrap_or_default().to_owned(),
        template: b["template"].as_str().map(str::to_owned),
        egress: b["egress"].as_array().into_iter().flatten().filter_map(|v| v.as_str().map(str::to_owned)).collect(),
    };
    match h.provider.create(&spec).await {
        Ok(c) => {
            h.count.fetch_add(1, Ordering::SeqCst);
            Json(json!({ "host": if c.host == "localhost" { h.name.clone() } else { c.host }, "template": c.template, "isolated": h.provider.isolated() })).into_response()
        }
        Err(e) => fail(e),
    }
}

async fn exists(State(h): H, Path(id): Path<String>) -> StatusCode {
    if h.provider.exists(&id).await { StatusCode::OK } else { StatusCode::NOT_FOUND }
}

async fn destroy(State(h): H, Path(id): Path<String>) -> Response {
    let was = h.provider.exists(&id).await;
    match h.provider.destroy(&id).await {
        Ok(()) => {
            if was {
                let _ = h.count.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1));
            }
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => fail(e),
    }
}

async fn pause_resume(State(h): H, Path((id, action)): Path<(String, String)>) -> Response {
    let r = match action.as_str() {
        "pause" => h.provider.pause(&id).await,
        "resume" => h.provider.resume(&id).await,
        _ => return StatusCode::NOT_FOUND.into_response(),
    };
    match r {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(e) => fail(e),
    }
}

async fn put_file(State(h): H, Path(id): Path<String>, Query(q): Query<HashMap<String, String>>, body: Bytes) -> Response {
    match h.provider.put_file(&id, q.get("path").map(String::as_str).unwrap_or_default(), &body).await {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(e) => fail(e),
    }
}

async fn get_file(State(h): H, Path(id): Path<String>, Query(q): Query<HashMap<String, String>>) -> Response {
    match h.provider.get_file(&id, q.get("path").map(String::as_str).unwrap_or_default()).await {
        Ok(data) => data.into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn exec(State(h): H, Path(id): Path<String>, Json(b): Json<Value>) -> Response {
    let mut spec = ExecSpec::new(b["cmd"].as_str().unwrap_or_default());
    if let Some(cwd) = b["cwd"].as_str() {
        spec = spec.cwd(cwd);
    }
    spec.timeout = Duration::from_millis(b["timeout_ms"].as_u64().unwrap_or(600_000));
    spec.idle_timeout = b["idle_ms"].as_u64().map(Duration::from_millis);
    spec.env = b["env"].as_array().into_iter().flatten().filter_map(|p| Some((p.get(0)?.as_str()?.to_owned(), p.get(1)?.as_str()?.to_owned()))).collect();
    spec.stdin = b["stdin"].as_str().and_then(|s| base64::engine::general_purpose::STANDARD.decode(s).ok());

    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let cancel = CancellationToken::new();
    let sink_tx = tx.clone();
    let sink: LineSink = Arc::new(move |l: &str| {
        let _ = sink_tx.send(json!({ "line": l }).to_string());
    });
    // the caller went away: stop the command
    let (gone, c2) = (tx.clone(), cancel.clone());
    tokio::spawn(async move {
        gone.closed().await;
        c2.cancel();
    });
    let hb = tx.clone();
    let beat = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(15)).await;
            if hb.send(json!({ "hb": 1 }).to_string()).is_err() {
                break;
            }
        }
    });
    tokio::spawn(async move {
        let last = match h.provider.exec(&id, spec, Some(sink), cancel).await {
            Ok(r) => json!({ "done": { "code": r.code, "output": r.output, "timed_out": r.timed_out, "idle": r.idle, "cancelled": r.cancelled } }),
            Err(e) => json!({ "error": e.to_string() }),
        };
        beat.abort();
        let _ = tx.send(last.to_string());
    });
    let stream = tokio_stream::wrappers::UnboundedReceiverStream::new(rx).map(|l| Ok::<_, std::convert::Infallible>(format!("{l}\n")));
    Response::builder().header("content-type", "application/x-ndjson").body(Body::from_stream(stream)).unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

// ---------------------------------------------------------------- the Engine side

pub struct RemoteProvider {
    hosts: Vec<String>,
    token: String,
    allow_unisolated: bool,
    http: reqwest::Client,
    /// Which host a sandbox is on. Rebuilt by asking the hosts when the Engine restarts.
    placed: Mutex<HashMap<String, String>>,
}

impl RemoteProvider {
    pub fn new(hosts: Vec<String>, token: String, allow_unisolated: bool) -> Result<Self> {
        if hosts.is_empty() {
            bail!("sandbox.remote.hosts 是空的：至少要有一台沙箱主机");
        }
        if token.is_empty() {
            bail!("没有沙箱主机的令牌（sandbox.remote.token_env 指的环境变量是空的）");
        }
        Ok(RemoteProvider { hosts: hosts.into_iter().map(|h| h.trim_end_matches('/').to_owned()).collect(), token, allow_unisolated, http: reqwest::Client::new(), placed: Default::default() })
    }

    async fn call(&self, req: reqwest::RequestBuilder) -> Result<reqwest::Response> {
        let resp = req.bearer_auth(&self.token).send().await?;
        if resp.status().is_success() {
            return Ok(resp);
        }
        let status = resp.status().as_u16();
        let msg = resp.json::<Value>().await.ok().and_then(|v| v["error"].as_str().map(str::to_owned)).unwrap_or_default();
        Err(anyhow!("沙箱主机返回 {status}{}", if msg.is_empty() { String::new() } else { format!("：{msg}") }))
    }

    /// The host a sandbox is on; found by asking around when it is not remembered.
    async fn host_of(&self, id: &str) -> Result<String> {
        if let Some(h) = self.placed.lock().ok().and_then(|p| p.get(id).cloned()) {
            return Ok(h);
        }
        for h in &self.hosts {
            if let Ok(r) = self.http.get(format!("{h}/v1/sandboxes/{id}")).bearer_auth(&self.token).timeout(Duration::from_secs(10)).send().await {
                if r.status().is_success() {
                    if let Ok(mut p) = self.placed.lock() {
                        p.insert(id.to_owned(), h.clone());
                    }
                    return Ok(h.clone());
                }
            }
        }
        Err(anyhow!("没有哪台沙箱主机上有 {id}"))
    }
}

/// Percent-encode a query value.
fn enc(s: &str) -> String {
    s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~/".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

#[async_trait]
impl SandboxProvider for RemoteProvider {
    fn name(&self) -> &'static str {
        "remote"
    }
    /// Hosts are checked one by one when a sandbox is created: a host without isolation is only
    /// used when the configuration allows it, and then this provider as a whole counts as unisolated.
    fn isolated(&self) -> bool {
        !self.allow_unisolated
    }

    async fn create(&self, spec: &SandboxSpec) -> Result<Created> {
        // the reachable host with the fewest sandboxes
        let mut best: Option<(usize, String)> = None;
        let mut why = Vec::new();
        for h in &self.hosts {
            match self.http.get(format!("{h}/v1/info")).bearer_auth(&self.token).timeout(Duration::from_secs(10)).send().await {
                Ok(r) if r.status().is_success() => {
                    let v: Value = r.json().await.unwrap_or(Value::Null);
                    if v["isolated"] != true && !self.allow_unisolated {
                        why.push(format!("{h} 用的提供方（{}）没有隔离", v["provider"].as_str().unwrap_or("?")));
                        continue;
                    }
                    let n = v["count"].as_u64().unwrap_or(0) as usize;
                    if best.as_ref().is_none_or(|(m, _)| n < *m) {
                        best = Some((n, h.clone()));
                    }
                }
                Ok(r) => why.push(format!("{h} 返回 {}", r.status().as_u16())),
                Err(e) => why.push(format!("{h} 连不上：{e}")),
            }
        }
        let Some((_, host)) = best else { bail!("没有可用的沙箱主机：{}", why.join("；")) };
        let v: Value = self.call(self.http.post(format!("{host}/v1/sandboxes")).timeout(Duration::from_secs(300)).json(&json!({ "id": spec.id, "project": spec.project, "template": spec.template, "egress": spec.egress }))).await?.json().await?;
        if let Ok(mut p) = self.placed.lock() {
            p.insert(spec.id.clone(), host.clone());
        }
        Ok(Created { host: v["host"].as_str().unwrap_or(&host).to_owned(), template: v["template"].as_str().unwrap_or("none").to_owned() })
    }

    async fn exists(&self, id: &str) -> bool {
        match self.host_of(id).await {
            Ok(h) => self.http.get(format!("{h}/v1/sandboxes/{id}")).bearer_auth(&self.token).timeout(Duration::from_secs(10)).send().await.map(|r| r.status().is_success()).unwrap_or(false),
            Err(_) => false,
        }
    }

    async fn exec(&self, id: &str, spec: ExecSpec, sink: Option<LineSink>, cancel: CancellationToken) -> Result<ExecResult> {
        let host = self.host_of(id).await?;
        let body = json!({
            "cmd": spec.cmd, "cwd": spec.cwd, "env": spec.env, "timeout_ms": spec.timeout.as_millis() as u64,
            "idle_ms": spec.idle_timeout.map(|d| d.as_millis() as u64),
            "stdin": spec.stdin.as_ref().map(|s| base64::engine::general_purpose::STANDARD.encode(s)),
        });
        let resp = self.call(self.http.post(format!("{host}/v1/sandboxes/{id}/exec")).json(&body)).await?;
        let mut stream = resp.bytes_stream();
        let mut buf: Vec<u8> = Vec::new();
        loop {
            let chunk = tokio::select! {
                c = stream.next() => c,
                // dropping the stream closes the connection, which stops the command on the host
                _ = cancel.cancelled() => return Ok(ExecResult { code: -1, cancelled: true, ..Default::default() }),
            };
            let Some(chunk) = chunk else { bail!("沙箱主机在命令结束前断开了连接") };
            buf.extend_from_slice(&chunk?);
            while let Some(i) = buf.iter().position(|b| *b == b'\n') {
                let line: Vec<u8> = buf.drain(..=i).collect();
                let v: Value = serde_json::from_slice(&line[..line.len() - 1]).unwrap_or(Value::Null);
                if let Some(l) = v["line"].as_str() {
                    if let Some(s) = &sink {
                        s(l);
                    }
                } else if let Some(d) = v.get("done") {
                    return Ok(ExecResult { code: d["code"].as_i64().unwrap_or(-1) as i32, output: d["output"].as_str().unwrap_or_default().to_owned(), timed_out: d["timed_out"] == true, idle: d["idle"] == true, cancelled: d["cancelled"] == true });
                } else if let Some(e) = v["error"].as_str() {
                    bail!("{e}");
                }
            }
        }
    }

    async fn put_file(&self, id: &str, path: &str, data: &[u8]) -> Result<()> {
        let host = self.host_of(id).await?;
        self.call(self.http.put(format!("{host}/v1/sandboxes/{id}/files?path={}", enc(path))).body(data.to_vec())).await?;
        Ok(())
    }
    async fn get_file(&self, id: &str, path: &str) -> Result<Vec<u8>> {
        let host = self.host_of(id).await?;
        Ok(self.call(self.http.get(format!("{host}/v1/sandboxes/{id}/files?path={}", enc(path)))).await?.bytes().await?.to_vec())
    }
    async fn pause(&self, id: &str) -> Result<()> {
        let host = self.host_of(id).await?;
        self.call(self.http.post(format!("{host}/v1/sandboxes/{id}/pause"))).await?;
        Ok(())
    }
    async fn resume(&self, id: &str) -> Result<()> {
        let host = self.host_of(id).await?;
        self.call(self.http.post(format!("{host}/v1/sandboxes/{id}/resume"))).await?;
        Ok(())
    }
    async fn destroy(&self, id: &str) -> Result<()> {
        let Ok(host) = self.host_of(id).await else { return Ok(()) };
        self.call(self.http.delete(format!("{host}/v1/sandboxes/{id}"))).await?;
        if let Ok(mut p) = self.placed.lock() {
            p.remove(id);
        }
        Ok(())
    }
}
