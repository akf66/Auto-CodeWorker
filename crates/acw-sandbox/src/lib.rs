//! Sandboxes. A provider gives the Engine a place to run a task: create it, run commands in it,
//! move files in and out, pause it, throw it away. The Engine never assumes more than this,
//! so providers are interchangeable.
//!
//! Layout inside every sandbox (paths given to this API are relative to the sandbox root):
//!   repo/   the working copy
//!   io/     files exchanged with the Engine (git bundles, generated tests)
//!   home/   HOME of the agent process

pub mod firecracker;
pub mod local;

use anyhow::Result;
use async_trait::async_trait;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
pub use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug, Default)]
pub struct SandboxSpec {
    pub id: String,
    pub project: String,
    pub template: Option<String>,
    /// `host:port` pairs the sandbox may reach. Everything else is closed.
    pub egress: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct Created {
    /// Which machine it runs on, for the inventory.
    pub host: String,
    pub template: String,
}

#[derive(Clone, Debug)]
pub struct ExecSpec {
    /// Run with `sh -c`.
    pub cmd: String,
    /// Relative to the sandbox root; defaults to `repo`.
    pub cwd: String,
    pub env: Vec<(String, String)>,
    pub timeout: Duration,
    /// Kill the command when it prints nothing for this long.
    pub idle_timeout: Option<Duration>,
    pub stdin: Option<Vec<u8>>,
}

impl ExecSpec {
    pub fn new(cmd: impl Into<String>) -> Self {
        ExecSpec { cmd: cmd.into(), cwd: "repo".into(), env: Vec::new(), timeout: Duration::from_secs(600), idle_timeout: None, stdin: None }
    }
    pub fn timeout(mut self, d: Duration) -> Self {
        self.timeout = d;
        self
    }
    pub fn idle(mut self, d: Duration) -> Self {
        self.idle_timeout = Some(d);
        self
    }
    pub fn env(mut self, k: &str, v: &str) -> Self {
        self.env.push((k.to_owned(), v.to_owned()));
        self
    }
    pub fn cwd(mut self, d: &str) -> Self {
        self.cwd = d.to_owned();
        self
    }
    pub fn stdin(mut self, data: Vec<u8>) -> Self {
        self.stdin = Some(data);
        self
    }
}

#[derive(Clone, Debug, Default)]
pub struct ExecResult {
    pub code: i32,
    /// stdout and stderr interleaved; only the tail is kept when it is long.
    pub output: String,
    pub timed_out: bool,
    pub idle: bool,
    pub cancelled: bool,
}

impl ExecResult {
    pub fn ok(&self) -> bool {
        self.code == 0 && !self.timed_out && !self.idle && !self.cancelled
    }
    pub fn tail(&self, lines: usize) -> String {
        let all: Vec<&str> = self.output.lines().collect();
        all[all.len().saturating_sub(lines)..].join("\n")
    }
}

/// Called for each output line as it arrives.
pub type LineSink = Arc<dyn Fn(&str) + Send + Sync>;

#[async_trait]
pub trait SandboxProvider: Send + Sync {
    fn name(&self) -> &'static str;
    /// False for providers that give no isolation. The Engine refuses to run untrusted work on them
    /// unless configured to allow it.
    fn isolated(&self) -> bool;
    async fn create(&self, spec: &SandboxSpec) -> Result<Created>;
    async fn exists(&self, id: &str) -> bool;
    async fn exec(&self, id: &str, spec: ExecSpec, sink: Option<LineSink>, cancel: CancellationToken) -> Result<ExecResult>;
    async fn put_file(&self, id: &str, path: &str, data: &[u8]) -> Result<()>;
    async fn get_file(&self, id: &str, path: &str) -> Result<Vec<u8>>;
    async fn pause(&self, id: &str) -> Result<()>;
    async fn resume(&self, id: &str) -> Result<()>;
    async fn destroy(&self, id: &str) -> Result<()>;
}

const KEEP_BYTES: usize = 256 * 1024;

/// Run a prepared command to the end, streaming its output. Shared by the providers: the local one
/// runs the task command itself, the Firecracker one runs `ssh` to the guest.
pub(crate) async fn run_process(mut cmd: Command, spec: &ExecSpec, sink: Option<LineSink>, cancel: CancellationToken) -> Result<ExecResult> {
    cmd.stdin(if spec.stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    let mut child = cmd.spawn()?;
    let pid = child.id();
    if let (Some(data), Some(mut stdin)) = (spec.stdin.clone(), child.stdin.take()) {
        tokio::spawn(async move {
            let _ = stdin.write_all(&data).await;
            let _ = stdin.shutdown().await;
        });
    }
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    for stream in [child.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>), child.stderr.take().map(|s| Box::new(s) as _)]
        .into_iter()
        .flatten()
    {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stream).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
    }
    drop(tx);

    let mut res = ExecResult::default();
    let deadline = tokio::time::sleep(spec.timeout);
    tokio::pin!(deadline);
    let idle = spec.idle_timeout.unwrap_or(Duration::from_secs(u32::MAX as u64));
    let mut open = true;
    loop {
        tokio::select! {
            line = rx.recv(), if open => match line {
                Some(l) => {
                    if let Some(s) = &sink { s(&l); }
                    res.output.push_str(&l);
                    res.output.push('\n');
                    if res.output.len() > KEEP_BYTES * 2 {
                        let cut = res.output.len() - KEEP_BYTES;
                        let cut = (cut..res.output.len()).find(|i| res.output.is_char_boundary(*i)).unwrap_or(cut);
                        res.output = format!("[前面的输出已截断]\n{}", &res.output[cut..]);
                    }
                }
                None => open = false,
            },
            status = child.wait(), if !open => {
                res.code = status?.code().unwrap_or(-1);
                return Ok(res);
            }
            _ = &mut deadline => { res.timed_out = true; break; }
            _ = tokio::time::sleep(idle), if open => { res.idle = true; break; }
            _ = cancel.cancelled() => { res.cancelled = true; break; }
        }
    }
    kill_group(pid).await;
    let _ = child.kill().await;
    res.code = -1;
    Ok(res)
}

async fn kill_group(pid: Option<u32>) {
    #[cfg(unix)]
    if let Some(pid) = pid {
        let _ = Command::new("kill").args(["-KILL", "--", &format!("-{pid}")]).output().await;
    }
    #[cfg(not(unix))]
    let _ = pid;
}

/// Single-quote a string for `sh`.
pub fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Reject paths that would leave the sandbox root.
pub(crate) fn safe_rel(path: &str) -> Result<&str> {
    let p = path.trim_start_matches('/');
    if p.is_empty() || p.split('/').any(|seg| seg == "..") {
        anyhow::bail!("沙箱路径不合法：{path}");
    }
    Ok(p)
}
