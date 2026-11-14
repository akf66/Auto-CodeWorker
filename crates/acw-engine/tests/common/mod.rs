//! Test harness: a real Engine on a temp directory, with the local forge, the local sandbox,
//! a scripted Worker and the rule-based model service on a random port.
#![allow(dead_code)]

use acw_core::*;
use acw_engine::{build, config::Config, demo, devllm, engine::{Actor, Engine}, router::Incoming, start};
use std::sync::Arc;
use std::time::Duration;

pub struct Harness {
    pub eng: Arc<Engine>,
    pub llm: Arc<devllm::DevLlm>,
    pub tmp: tempfile::TempDir,
    pub repo: std::path::PathBuf,
    /// Where the Engine's HTTP API listens.
    pub base: String,
}

impl Harness {
    pub async fn new(worker_script: &str) -> Self {
        Self::with(worker_script, |_| {}).await
    }

    pub async fn with(worker_script: &str, tweak: impl FnOnce(&mut Config)) -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().canonicalize().unwrap();
        let repo = demo::sample_repo(&dir).await.unwrap();
        let script = dir.join("worker.sh");
        std::fs::write(&script, worker_script).unwrap();
        let llm = Arc::new(devllm::DevLlm::default());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let llm_addr = listener.local_addr().unwrap();
        let router = devllm::router(llm.clone());
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });

        let api = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", api.local_addr().unwrap());
        let mut cfg = Config { data_dir: dir.join("data"), auth: "token".into(), public_url: base.clone(), gateway_url: base.clone(), ..Default::default() };
        cfg.forge.kind = "local".into();
        cfg.forge.poll_seconds = 5;
        cfg.sandbox.provider = "local".into();
        cfg.sandbox.allow_unisolated = true;
        cfg.worker.agent = "scripted".into();
        cfg.worker.scripted_cmd = format!("sh '{}'", script.display());
        cfg.worker.retry_seconds = 1;
        tweak(&mut cfg);
        let eng = build(cfg).unwrap();
        demo::seed(&eng, &repo, &format!("http://{llm_addr}/v1")).await.unwrap();
        start(&eng);
        let app = acw_engine::http::app(eng.clone());
        tokio::spawn(async move { axum::serve(api, app).await.unwrap() });
        Harness { eng, llm, tmp, repo, base }
    }

    pub fn actor(&self, id: &str) -> Actor {
        Actor::member(self.eng.store.read(|v| v.member(id)).unwrap().unwrap())
    }

    pub async fn say(&self, sender: &str, text: &str) -> RouteRecord {
        self.eng.route(Incoming { sender: sender.into(), channel: "控制台".into(), thread: format!("t:{sender}"), text: text.into() }).await.unwrap()
    }

    pub fn ticket(&self, id: &str) -> Ticket {
        self.eng.ticket(id).unwrap()
    }

    /// Poll until the ticket satisfies `cond`; panic with its state when it does not within `secs`.
    pub async fn until(&self, id: &str, secs: u64, what: &str, cond: impl Fn(&Ticket) -> bool) -> Ticket {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(secs);
        loop {
            let t = self.ticket(id);
            if cond(&t) {
                return t;
            }
            if tokio::time::Instant::now() > deadline {
                let lines: Vec<String> = self.eng.store.read(|v| v.events_for(id)).unwrap().iter().filter_map(|e| acw_engine::views::timeline_entry(e).map(|(k, w, d)| format!("  [{k}] {w} {}", d.lines().next().unwrap_or_default()))).collect();
                panic!("等不到“{what}”：{} 停在 {:?}（{} / {}）\n{}", id, t.stage, t.state, t.why, lines[lines.len().saturating_sub(25)..].join("\n"));
            }
            tokio::time::sleep(Duration::from_millis(80)).await;
        }
    }

    pub fn kinds(&self, id: &str) -> Vec<String> {
        self.eng.store.read(|v| v.events_for(id)).unwrap().iter().map(|e| e.event.kind()).collect()
    }

    pub fn security(&self) -> Vec<(String, String)> {
        self.eng.store.read(|v| v.events_of_kind("security_logged", 100)).unwrap().into_iter().filter_map(|e| match e.event {
            Event::SecurityLogged { kind, result, .. } => Some((kind, result)),
            _ => None,
        }).collect()
    }
}

pub const SHOUT: &str = "给 hello 的 greet.sh 加一个 --shout 参数，验收：`sh greet.sh --shout kai | grep -q 'HELLO, KAI'`";
