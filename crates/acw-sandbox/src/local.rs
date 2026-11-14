//! Local provider: a directory and ordinary processes on the Engine's own machine.
//!
//! This gives NO isolation: a command can read the host's files and reach the network. It exists
//! for development, tests and demos. The environment of each command is cleared so that the
//! Engine's own secrets are not inherited, but that is hygiene, not a boundary.

use crate::*;
use anyhow::{anyhow, Context};
use std::path::{Path, PathBuf};

pub struct LocalProvider {
    root: PathBuf,
    /// Extra PATH entries, for example where `codex` is installed.
    path: String,
}

impl LocalProvider {
    pub fn new(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        std::fs::create_dir_all(&root)?;
        let root = root.canonicalize()?;
        Ok(LocalProvider { root, path: std::env::var("PATH").unwrap_or_else(|_| "/usr/local/bin:/usr/bin:/bin".into()) })
    }
    fn dir(&self, id: &str) -> Result<PathBuf> {
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Err(anyhow!("沙箱编号不合法：{id}"));
        }
        Ok(self.root.join(id))
    }
    pub fn path_of(&self, id: &str) -> Result<PathBuf> {
        self.dir(id)
    }
}

#[async_trait]
impl SandboxProvider for LocalProvider {
    fn name(&self) -> &'static str {
        "local"
    }
    fn isolated(&self) -> bool {
        false
    }
    async fn create(&self, spec: &SandboxSpec) -> Result<Created> {
        let dir = self.dir(&spec.id)?;
        if dir.exists() {
            tokio::fs::remove_dir_all(&dir).await?;
        }
        for sub in ["repo", "io", "home"] {
            tokio::fs::create_dir_all(dir.join(sub)).await?;
        }
        Ok(Created { host: "localhost".into(), template: spec.template.clone().unwrap_or_else(|| "none".into()) })
    }
    async fn exists(&self, id: &str) -> bool {
        self.dir(id).map(|d| d.join("repo").is_dir()).unwrap_or(false)
    }
    async fn exec(&self, id: &str, spec: ExecSpec, sink: Option<LineSink>, cancel: CancellationToken) -> Result<ExecResult> {
        let dir = self.dir(id)?;
        let cwd = dir.join(safe_rel(&spec.cwd)?);
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg(&spec.cmd).current_dir(&cwd).env_clear();
        cmd.env("PATH", &self.path).env("HOME", dir.join("home")).env("ACW_SANDBOX", dir.as_os_str()).env("LANG", "C.UTF-8");
        for (k, v) in &spec.env {
            cmd.env(k, v);
        }
        run_process(cmd, &spec, sink, cancel).await.with_context(|| format!("在沙箱 {id} 里执行命令"))
    }
    async fn put_file(&self, id: &str, path: &str, data: &[u8]) -> Result<()> {
        let p = self.dir(id)?.join(safe_rel(path)?);
        if let Some(parent) = p.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(&p, data).await?;
        Ok(())
    }
    async fn get_file(&self, id: &str, path: &str) -> Result<Vec<u8>> {
        let p: PathBuf = self.dir(id)?.join(safe_rel(path)?);
        Ok(tokio::fs::read(Path::new(&p)).await?)
    }
    async fn pause(&self, _id: &str) -> Result<()> {
        Ok(())
    }
    async fn resume(&self, _id: &str) -> Result<()> {
        Ok(())
    }
    async fn destroy(&self, id: &str) -> Result<()> {
        let dir = self.dir(id)?;
        if dir.exists() {
            // services of the environment plan run as plain background processes here: stop them
            if let Ok(mut rd) = tokio::fs::read_dir(dir.join("io")).await {
                while let Ok(Some(e)) = rd.next_entry().await {
                    let name = e.file_name().to_string_lossy().into_owned();
                    if name.starts_with("svc-") && name.ends_with(".pid") {
                        if let Some(pid) = tokio::fs::read_to_string(e.path()).await.ok().and_then(|s| s.trim().parse::<u32>().ok()) {
                            let _ = tokio::process::Command::new("kill").arg(pid.to_string()).status().await;
                        }
                    }
                }
            }
            tokio::fs::remove_dir_all(dir).await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    async fn sandbox() -> (tempfile::TempDir, LocalProvider) {
        let tmp = tempfile::tempdir().unwrap();
        let p = LocalProvider::new(tmp.path()).unwrap();
        p.create(&SandboxSpec { id: "sb-1".into(), ..Default::default() }).await.unwrap();
        (tmp, p)
    }

    #[tokio::test]
    async fn runs_commands_and_streams_lines() {
        let (_tmp, p) = sandbox().await;
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s2 = seen.clone();
        let sink: LineSink = Arc::new(move |l| s2.lock().unwrap().push(l.to_owned()));
        let r = p.exec("sb-1", ExecSpec::new("echo one; echo two >&2; exit 3"), Some(sink), CancellationToken::new()).await.unwrap();
        assert_eq!(r.code, 3);
        assert!(!r.ok());
        let mut lines = seen.lock().unwrap().clone();
        lines.sort();
        assert_eq!(lines, ["one", "two"]);
    }

    #[tokio::test]
    async fn the_engine_environment_is_not_inherited() {
        std::env::set_var("ACW_TEST_HOST_SECRET", "leak");
        let (_tmp, p) = sandbox().await;
        let r = p.exec("sb-1", ExecSpec::new("echo \"[$ACW_TEST_HOST_SECRET][$GIVEN]\"").env("GIVEN", "yes"), None, CancellationToken::new()).await.unwrap();
        assert_eq!(r.output.trim(), "[][yes]");
    }

    #[tokio::test]
    async fn kills_on_timeout_idle_and_cancel() {
        let (_tmp, p) = sandbox().await;
        let r = p.exec("sb-1", ExecSpec::new("sleep 30").timeout(Duration::from_millis(200)), None, CancellationToken::new()).await.unwrap();
        assert!(r.timed_out);
        let r = p.exec("sb-1", ExecSpec::new("echo hi; sleep 30").idle(Duration::from_millis(200)), None, CancellationToken::new()).await.unwrap();
        assert!(r.idle && r.output.contains("hi"));
        let cancel = CancellationToken::new();
        let c2 = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            c2.cancel();
        });
        let r = p.exec("sb-1", ExecSpec::new("sleep 30"), None, cancel).await.unwrap();
        assert!(r.cancelled);
    }

    #[tokio::test]
    async fn files_stay_inside_the_sandbox() {
        let (_tmp, p) = sandbox().await;
        p.put_file("sb-1", "io/in.txt", b"hello").await.unwrap();
        assert_eq!(p.get_file("sb-1", "io/in.txt").await.unwrap(), b"hello");
        assert!(p.put_file("sb-1", "../escape.txt", b"x").await.is_err());
        assert!(p.exec("sb-1", ExecSpec::new("true").cwd("../.."), None, CancellationToken::new()).await.is_err());
        p.destroy("sb-1").await.unwrap();
        assert!(!p.exists("sb-1").await);
    }
}
