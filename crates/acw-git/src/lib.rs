//! The git gateway. Code crosses the sandbox boundary only as git bundles, and only through here:
//!
//!   remote --fetch--> mirror (on the Engine host) --bundle--> sandbox
//!   sandbox --bundle--> mirror --push--> remote
//!
//! The forge token stays on the host. A sandbox never holds a credential, and the only thing it
//! can cause to be pushed is its own task branch, `acw/T-<n>-…`.

pub mod forge;

use anyhow::{anyhow, bail, Context, Result};
use std::path::{Path, PathBuf};
use tokio::process::Command;

pub use forge::{verify_signature, Forge, ForgeEvent, GitHub, LocalForge, PrInfo, PrStatus};

/// Where a project's repository lives and how to authenticate to it.
#[derive(Clone, Debug, Default)]
pub struct Remote {
    pub url: String,
    /// Sent as `http.extraHeader`; never written to disk, never passed to a sandbox.
    pub auth_header: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Accepted {
    pub head: String,
    pub commits: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Change {
    /// `A`, `M`, `D`, `R`…
    pub status: char,
    pub path: String,
}

pub struct GitGateway {
    mirrors: PathBuf,
    /// One writer per mirror at a time: fetches, bundle imports and pushes on the same repository
    /// from different tasks would otherwise race on its refs.
    locks: std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<tokio::sync::Mutex<()>>>>,
}

/// Task branches are `acw/<ticket>` or `acw/<ticket>-<slug>`. Nothing else is ever accepted or pushed.
pub fn branch_allowed(branch: &str, ticket: &str) -> bool {
    let Some(rest) = branch.strip_prefix("acw/") else { return false };
    let Some(tail) = rest.strip_prefix(ticket) else { return false };
    ticket.starts_with("T-")
        && ticket[2..].chars().all(|c| c.is_ascii_digit())
        && !ticket[2..].is_empty()
        && (tail.is_empty() || (tail.starts_with('-') && tail.len() > 1 && tail[1..].chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')))
}

pub fn branch_name(ticket: &str, title: &str) -> String {
    let slug: String = title.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    let slug: Vec<&str> = slug.split('-').filter(|s| !s.is_empty()).take(5).collect();
    if slug.is_empty() {
        format!("acw/{ticket}")
    } else {
        format!("acw/{ticket}-{}", slug.join("-"))
    }
}

pub async fn git(dir: &Path, args: &[&str]) -> Result<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .await
        .context("运行 git")?;
    if !out.status.success() {
        // arguments are not echoed: they may carry the auth header
        bail!("git {} 失败：{}", args.iter().find(|a| !a.starts_with('-') && !a.contains('=')).unwrap_or(&""), String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_owned())
}

impl GitGateway {
    pub fn new(mirrors: impl Into<PathBuf>) -> Result<Self> {
        let mirrors = mirrors.into();
        std::fs::create_dir_all(&mirrors)?;
        Ok(GitGateway { mirrors, locks: Default::default() })
    }

    async fn lock(&self, project: &str) -> tokio::sync::OwnedMutexGuard<()> {
        let m = self.locks.lock().map(|mut l| l.entry(project.to_owned()).or_default().clone()).unwrap_or_default();
        m.lock_owned().await
    }

    pub fn mirror(&self, project: &str) -> PathBuf {
        self.mirrors.join(format!("{project}.git"))
    }

    async fn auth_git(&self, dir: &Path, remote: &Remote, args: &[&str]) -> Result<String> {
        let header;
        let mut full: Vec<&str> = Vec::new();
        if let Some(h) = &remote.auth_header {
            header = format!("http.extraHeader={h}");
            full.extend(["-c", &header]);
        }
        full.extend_from_slice(args);
        git(dir, &full).await
    }

    /// Bring the mirror up to date with the remote's branches.
    pub async fn sync(&self, project: &str, remote: &Remote) -> Result<()> {
        let _guard = self.lock(project).await;
        let dir = self.mirror(project);
        if !dir.join("HEAD").exists() {
            tokio::fs::create_dir_all(&dir).await?;
            git(&dir, &["init", "-q", "--bare"]).await?;
        }
        self.auth_git(&dir, remote, &["fetch", "-q", "--prune", &remote.url, "+refs/heads/*:refs/remotes/origin/*"]).await?;
        Ok(())
    }

    /// The commit a task branch should sit on: the remote's copy of an ordinary branch, the mirror's copy of a task branch.
    pub async fn base_tip(&self, project: &str, base: &str) -> Result<Option<String>> {
        if base.starts_with("acw/") {
            if let Some(sha) = self.rev(project, &format!("refs/heads/{base}")).await? {
                return Ok(Some(sha));
            }
        }
        self.rev(project, &format!("refs/remotes/origin/{base}")).await
    }

    pub async fn rev(&self, project: &str, name: &str) -> Result<Option<String>> {
        Ok(git(&self.mirror(project), &["rev-parse", "-q", "--verify", &format!("{name}^{{commit}}")]).await.ok().filter(|s| !s.is_empty()))
    }

    /// What a new sandbox starts from: the base branch, plus the task branch when it already exists
    /// (a task being resumed after its sandbox was lost).
    pub async fn seed_bundle(&self, project: &str, base: &str, branch: Option<&str>) -> Result<Vec<u8>> {
        let _guard = self.lock(project).await;
        let dir = self.mirror(project);
        let base_ref = format!("refs/remotes/origin/{base}");
        let base_local = format!("refs/heads/{base}");
        if base.starts_with("acw/") {
            // a stacked task starts from another task's branch: the mirror's own copy of it is the newest
            if self.rev(project, &base_local).await?.is_none() {
                match self.rev(project, &base_ref).await? {
                    Some(sha) => git(&dir, &["update-ref", &base_local, &sha]).await.map(|_| ())?,
                    None => bail!("仓库里没有分支 {base}"),
                }
            }
        } else {
            if self.rev(project, &base_ref).await?.is_none() {
                bail!("仓库里没有分支 {base}");
            }
            // bundles carry refs by name, so give the commits plain branch names inside a scratch namespace
            git(&dir, &["update-ref", &base_local, &base_ref]).await?;
        }
        let mut refs = vec![format!("refs/heads/{base}")];
        if let Some(b) = branch {
            let local = format!("refs/heads/{b}");
            let remote_b = format!("refs/remotes/origin/{b}");
            // The mirror's copy is ahead when a push failed; the remote's is ahead, or different, when a
            // person committed to the branch. Human commits win: keep ours only if it contains theirs.
            if let Some(theirs) = self.rev(project, &remote_b).await? {
                let keep_ours = match self.rev(project, &local).await? {
                    Some(ours) => git(&dir, &["merge-base", "--is-ancestor", &theirs, &ours]).await.is_ok(),
                    None => false,
                };
                if !keep_ours {
                    git(&dir, &["update-ref", &local, &theirs]).await?;
                }
            }
            if self.rev(project, &local).await?.is_some() {
                refs.push(local);
            }
        }
        let file = dir.join(format!("seed-{}.bundle", std::process::id()));
        let file_s = file.to_string_lossy().into_owned();
        let mut args = vec!["bundle", "create", "-q", file_s.as_str()];
        args.extend(refs.iter().map(String::as_str));
        git(&dir, &args).await?;
        let data = tokio::fs::read(&file).await?;
        let _ = tokio::fs::remove_file(&file).await;
        Ok(data)
    }

    /// Take a bundle a sandbox produced. It must carry exactly the task branch, and that branch
    /// must be named for this ticket; anything else is refused before a single object is fetched.
    pub async fn accept_bundle(&self, project: &str, ticket: &str, branch: &str, base_sha: &str, bundle: &[u8]) -> Result<Accepted> {
        let _guard = self.lock(project).await;
        if !branch_allowed(branch, ticket) {
            bail!("分支 {branch} 不是任务 {ticket} 的分支，拒绝接收");
        }
        let dir = self.mirror(project);
        let file = dir.join(format!("in-{ticket}-{}.bundle", std::process::id()));
        tokio::fs::write(&file, bundle).await?;
        let file_s = file.to_string_lossy().into_owned();
        let result = async {
            let heads = git(&dir, &["bundle", "list-heads", &file_s]).await?;
            let names: Vec<&str> = heads.lines().filter_map(|l| l.split_whitespace().nth(1)).collect();
            let want = format!("refs/heads/{branch}");
            if names != [want.as_str()] {
                bail!("bundle 里的引用是 {names:?}，只接受 {want}");
            }
            git(&dir, &["bundle", "verify", "-q", &file_s]).await?;
            git(&dir, &["fetch", "-q", &file_s, &format!("+{want}:{want}")]).await?;
            let head = self.rev(project, &want).await?.ok_or_else(|| anyhow!("接收后找不到分支 {branch}"))?;
            let commits = git(&dir, &["rev-list", "--count", &format!("{base_sha}..{head}")]).await?.parse().unwrap_or(0);
            Ok(Accepted { head, commits })
        }
        .await;
        let _ = tokio::fs::remove_file(&file).await;
        result
    }

    /// Push the task branch from the mirror to the remote. Force is safe: the branch belongs to the task.
    pub async fn push(&self, project: &str, ticket: &str, branch: &str, remote: &Remote) -> Result<()> {
        let _guard = self.lock(project).await;
        if !branch_allowed(branch, ticket) {
            bail!("分支 {branch} 不是任务 {ticket} 的分支，拒绝推送");
        }
        let spec = format!("+refs/heads/{branch}:refs/heads/{branch}");
        self.auth_git(&self.mirror(project), remote, &["push", "-q", &remote.url, &spec]).await?;
        Ok(())
    }

    pub async fn changes(&self, project: &str, base: &str, head: &str) -> Result<Vec<Change>> {
        let out = git(&self.mirror(project), &["diff", "--name-status", "--no-renames", &format!("{base}...{head}")]).await?;
        Ok(out
            .lines()
            .filter_map(|l| {
                let (s, p) = l.split_once('\t')?;
                Some(Change { status: s.chars().next()?, path: p.to_owned() })
            })
            .collect())
    }

    /// Unified diff of the task branch against its merge base, cut at `max_bytes`.
    pub async fn diff(&self, project: &str, base: &str, head: &str, max_bytes: usize) -> Result<String> {
        let mut d = git(&self.mirror(project), &["diff", "--no-color", "-U3", &format!("{base}...{head}")]).await?;
        if d.len() > max_bytes {
            let cut = (0..=max_bytes).rev().find(|i| d.is_char_boundary(*i)).unwrap_or(0);
            d.truncate(cut);
            d.push_str("\n[diff 过长，后面的部分已截断]\n");
        }
        Ok(d)
    }

    /// Lines the branch adds, for checks that look at what was introduced (skipped tests and the like).
    pub async fn added_lines(&self, project: &str, base: &str, head: &str) -> Result<Vec<(String, String)>> {
        let d = git(&self.mirror(project), &["diff", "--no-color", "-U0", &format!("{base}...{head}")]).await?;
        let mut file = String::new();
        let mut out = Vec::new();
        for l in d.lines() {
            if let Some(p) = l.strip_prefix("+++ b/") {
                file = p.to_owned();
            } else if l.starts_with('+') && !l.starts_with("+++") {
                out.push((file.clone(), l[1..].to_owned()));
            }
        }
        Ok(out)
    }
}

/// Shell snippets the Engine runs inside a sandbox. They need no network and no credentials.
pub mod inside {
    fn q(s: &str) -> String {
        format!("'{}'", s.replace('\'', "'\\''"))
    }

    /// Run with cwd `io`, after `seed.bundle` was put there.
    pub fn seed(base: &str, branch: &str) -> String {
        format!(
            "set -e; rm -rf ../repo/.git; git clone -q -b {b} seed.bundle ../repo; cd ../repo; \
             git config user.name 'Auto-CodWorker'; git config user.email 'acw@localhost'; \
             if git rev-parse -q --verify origin/{t} >/dev/null; then git checkout -q -B {t} origin/{t}; else git checkout -q -B {t}; fi; \
             git remote remove origin; git rev-parse HEAD",
            b = q(base),
            t = q(branch)
        )
    }

    /// Commit whatever the Worker left uncommitted, then print the head. Run with cwd `repo`.
    pub fn commit_all(message: &str) -> String {
        format!("set -e; git add -A; if ! git diff --cached --quiet; then git commit -q -m {}; fi; git rev-parse HEAD", q(message))
    }

    /// Write `io/out.bundle` with the task branch's commits on top of `base_sha`. Prints the commit count.
    pub fn export(base_sha: &str, branch: &str) -> String {
        format!(
            "set -e; n=$(git rev-list --count {b}..{t}); if [ \"$n\" -gt 0 ]; then git bundle create -q ../io/out.bundle {b}..{t}; fi; echo $n",
            b = q(base_sha),
            t = q(&format!("refs/heads/{branch}"))
        )
    }
}

pub fn basic_auth(user: &str, token: &str) -> String {
    format!("Authorization: Basic {}", base64(format!("{user}:{token}").as_bytes()))
}

fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn sh(dir: &Path, cmd: &str) -> String {
        let out = Command::new("sh").arg("-c").arg(cmd).current_dir(dir).output().await.unwrap();
        assert!(out.status.success(), "{cmd}: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_owned()
    }

    /// A bare "remote" with one commit on main.
    async fn remote(tmp: &Path) -> Remote {
        let bare = tmp.join("remote.git");
        let work = tmp.join("seed");
        tokio::fs::create_dir_all(&work).await.unwrap();
        sh(tmp, "git init -q --bare -b main remote.git").await;
        sh(&work, "git init -q -b main . && git config user.email a@b && git config user.name a && echo hello > README.md && mkdir tests && echo t > tests/a_test.txt && git add -A && git commit -q -m init && git push -q ../remote.git main").await;
        Remote { url: bare.to_string_lossy().into_owned(), auth_header: None }
    }

    #[test]
    fn only_task_branches_are_allowed() {
        assert!(branch_allowed("acw/T-12", "T-12"));
        assert!(branch_allowed("acw/T-12-fix-login", "T-12"));
        assert!(!branch_allowed("acw/T-123", "T-12"), "another ticket's branch");
        assert!(!branch_allowed("main", "T-12"));
        assert!(!branch_allowed("acw/T-12/../../main", "T-12"));
        assert!(!branch_allowed("acw/T-12-Fix", "T-12"));
        assert_eq!(branch_name("T-7", "Fix login 500 错误"), "acw/T-7-fix-login-500");
        assert_eq!(branch_name("T-7", "登录页偶发报错"), "acw/T-7");
    }

    #[test]
    fn basic_auth_header() {
        assert_eq!(basic_auth("x-access-token", "abc"), "Authorization: Basic eC1hY2Nlc3MtdG9rZW46YWJj");
    }

    #[tokio::test]
    async fn round_trip_through_a_sandbox_and_refusals() {
        let tmp = tempfile::tempdir().unwrap();
        let rem = remote(tmp.path()).await;
        let gw = GitGateway::new(tmp.path().join("mirrors")).unwrap();
        gw.sync("p", &rem).await.unwrap();
        let base_sha = gw.rev("p", "refs/remotes/origin/main").await.unwrap().unwrap();

        // "sandbox": seed, change, export
        let sb = tmp.path().join("sb");
        for d in ["repo", "io"] {
            tokio::fs::create_dir_all(sb.join(d)).await.unwrap();
        }
        tokio::fs::write(sb.join("io/seed.bundle"), gw.seed_bundle("p", "main", Some("acw/T-1-x")).await.unwrap()).await.unwrap();
        let head0 = sh(&sb.join("io"), &inside::seed("main", "acw/T-1-x")).await;
        assert_eq!(head0, base_sha);
        tokio::fs::write(sb.join("repo/new.txt"), "work").await.unwrap();
        let head1 = sh(&sb.join("repo"), &inside::commit_all("T-1: add file")).await;
        assert_ne!(head1, base_sha);
        assert_eq!(sh(&sb.join("repo"), &inside::export(&base_sha, "acw/T-1-x")).await, "1");
        let bundle = tokio::fs::read(sb.join("io/out.bundle")).await.unwrap();

        // wrong ticket, wrong branch name: refused
        assert!(gw.accept_bundle("p", "T-2", "acw/T-1-x", &base_sha, &bundle).await.is_err());
        assert!(gw.accept_bundle("p", "T-1", "acw/T-1-y", &base_sha, &bundle).await.is_err(), "bundle carries another ref than the one claimed");

        let acc = gw.accept_bundle("p", "T-1", "acw/T-1-x", &base_sha, &bundle).await.unwrap();
        assert_eq!(acc, Accepted { head: head1.clone(), commits: 1 });
        assert_eq!(gw.changes("p", &base_sha, &head1).await.unwrap(), [Change { status: 'A', path: "new.txt".into() }]);
        assert!(gw.diff("p", &base_sha, &head1, 10_000).await.unwrap().contains("+work"));
        assert_eq!(gw.added_lines("p", &base_sha, &head1).await.unwrap(), [("new.txt".to_owned(), "work".to_owned())]);

        gw.push("p", "T-1", "acw/T-1-x", &rem).await.unwrap();
        assert_eq!(sh(Path::new(&rem.url), "git rev-parse refs/heads/acw/T-1-x").await, head1);
        assert!(gw.push("p", "T-1", "main", &rem).await.is_err(), "the gateway never pushes anything but the task branch");

        // a sandbox that tries to smuggle main in its bundle
        sh(&sb.join("repo"), "git checkout -q -b main2 && echo evil > README.md && git commit -qam evil && git branch -f main HEAD 2>/dev/null || git branch main HEAD").await;
        sh(&sb.join("repo"), &format!("git bundle create -q ../io/evil.bundle {base_sha}..refs/heads/main")).await;
        let evil = tokio::fs::read(sb.join("io/evil.bundle")).await.unwrap();
        assert!(gw.accept_bundle("p", "T-1", "acw/T-1-x", &base_sha, &evil).await.is_err());

        // resuming: a fresh seed carries the task branch
        gw.sync("p", &rem).await.unwrap();
        let sb2 = tmp.path().join("sb2");
        for d in ["repo", "io"] {
            tokio::fs::create_dir_all(sb2.join(d)).await.unwrap();
        }
        tokio::fs::write(sb2.join("io/seed.bundle"), gw.seed_bundle("p", "main", Some("acw/T-1-x")).await.unwrap()).await.unwrap();
        assert_eq!(sh(&sb2.join("io"), &inside::seed("main", "acw/T-1-x")).await, head1);
    }
}
