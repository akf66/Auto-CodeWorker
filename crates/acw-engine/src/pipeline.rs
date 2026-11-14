//! The life of a task once it holds a slot:
//!
//!   provisioning → working → checking → reviewing → testing → opening → PR open
//!
//! Each arrow is an event. The loop reads the task's stage from the projection, does that stage's
//! work, and writes the next stage; after a restart it simply picks up at the stage it finds.
//! The task's durable state is the event log plus its remote branch: the sandbox is disposable.

use crate::agent::{compose_prompt, parse_progress};
use crate::engine::*;
use crate::models::StageError;
use acw_core::*;
use acw_git::{branch_name, inside};
use acw_sandbox::{CancellationToken, ExecSpec, SandboxSpec};
use anyhow::{anyhow, Result};
use std::sync::Arc;
use std::time::Duration;

/// How a stage ended, other than by moving the task on.
pub enum Halt {
    /// A person has to act; the queue item is already open.
    Blocked,
    /// A model is unavailable. Not a failure: wait and try again.
    Wait(String),
}

pub type StageResult = Result<Option<Halt>>;

/// A pipeline may only move a task that is still its own. When a person stopped the task or took
/// it over in the meantime, their command stands and the pipeline's late write is refused.
pub fn advance(tx: &mut Tx, id: &str, stage: Stage, state: &str, why: &str, resume: Option<Stage>) -> Result<()> {
    if !tx.view().ticket(id)?.is_some_and(|t| t.stage.is_active()) {
        return Err(anyhow!("任务已经不在运行，流水线不再改它的状态"));
    }
    set_stage(tx, "engine", id, stage, state, why, resume)
}

pub fn sandbox_id(ticket: &str) -> String {
    format!("sb-{ticket}")
}

impl Engine {
    pub fn emit(&self, actor: &str, ticket: &str, event: Event) -> Result<()> {
        self.store.write(|tx| tx.emit(actor, Some(ticket), event).map(|_| ()))
    }

    pub fn stage(&self, id: &str, stage: Stage, state: &str, why: &str) -> Result<()> {
        self.store.write(|tx| advance(tx, id, stage, state, why, None))
    }

    /// Stop and ask a person. `kind` is both the question type and the queue item kind.
    pub fn block(&self, t: &Ticket, kind: &str, text: &str, options: &[&str], resume: Stage, need: Role) -> Result<()> {
        let link = self.link(&t.id);
        self.store.write(|tx| {
            tx.emit("engine", Some(&t.id), Event::AskRaised { ask: Ask { kind: kind.to_owned(), text: text.to_owned(), options: options.iter().map(|s| s.to_string()).collect() } })?;
            let state = match kind {
                "ask" => "等你回答一个问题",
                "budget" => "超出预算，等你决定",
                "oscillation" => "审查来回改，等你决定",
                "rounds" => "审查轮数用完，等你决定",
                "risk" => "有需要批准的改动",
                "evidence" => "有验收标准没法自动取证",
                _ => "等你决定",
            };
            advance(tx, &t.id, Stage::Blocked, state, text, Some(resume))?;
            open_queue(tx, t, kind, text, need, (kind == "ask").then_some(t.by.as_str()), &link)
        })
    }

    fn fail(&self, id: &str, reason: &str) -> Result<()> {
        let link = self.link(id);
        self.store.write(|tx| {
            let Some(t) = tx.view().ticket(id)? else { return Ok(()) };
            if !t.stage.is_active() {
                return Ok(());
            }
            let resume = if t.stage == Stage::Waiting { t.resume.unwrap_or(Stage::Provisioning) } else { t.stage };
            set_stage(tx, "engine", id, Stage::Failed, "失败", reason, Some(resume))?;
            open_queue(tx, &t, "failed", reason, Role::Approver, Some(&t.by), &link)
        })
    }

    /// Start the pipeline of a task that holds a slot. Idempotent.
    pub fn spawn_run(self: &Arc<Self>, id: &str) {
        static GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let cancel = CancellationToken::new();
        let gen = GEN.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        {
            let Ok(mut runs) = self.runs.lock() else { return };
            if runs.contains_key(id) {
                return;
            }
            runs.insert(id.to_owned(), Run { cancel: cancel.clone(), gen });
        }
        let (eng, id) = (self.clone(), id.to_owned());
        tokio::spawn(async move {
            if let Err(e) = eng.drive(&id, &cancel).await {
                if !cancel.is_cancelled() {
                    tracing::warn!("{id} 失败：{e:#}");
                    if let Err(e2) = eng.fail(&id, &format!("{e:#}")) {
                        tracing::error!("记录 {id} 的失败时出错：{e2}");
                    }
                }
            }
            if let Ok(mut runs) = eng.runs.lock() {
                // only remove our own entry: a stop followed by a retry may have put a new one there
                if runs.get(&id).is_some_and(|r| r.gen == gen) {
                    runs.remove(&id);
                }
            }
            eng.kick();
        });
    }

    async fn drive(self: &Arc<Self>, id: &str, cancel: &CancellationToken) -> Result<()> {
        loop {
            if cancel.is_cancelled() || self.store.read(|v| v.draining())? {
                return Ok(());
            }
            let t = self.ticket(id)?;
            if t.stage.is_active() && t.stage != Stage::Waiting && over_budget(&t, &self.settings()?) {
                let s = self.settings()?;
                let text = format!("已花 ¥{:.2}，超过单任务上限 ¥{:.0}。提高预算继续，或停止任务。", t.cost, s.budget + t.budget_extra);
                self.block(&t, "budget", &text, &["提高预算", "停止任务"], t.stage, Role::Approver)?;
                return Ok(());
            }
            if t.stage.is_active() && t.stage != Stage::Waiting {
                if let Some((spent, cap)) = self.plan_over_budget(&t)? {
                    let text = format!("计划 {} 已花 ¥{spent:.2}，超过计划上限 ¥{cap:.2}（各任务估算之和加 20%）。提高这个任务的预算继续，或停止任务。", t.plan.clone().unwrap_or_default());
                    if t.budget_extra == 0.0 {
                        self.block(&t, "budget", &text, &["提高预算", "停止任务"], t.stage, Role::Approver)?;
                        return Ok(());
                    }
                }
            }
            let halt = match t.stage {
                Stage::Provisioning => self.provision(&t, cancel).await?,
                Stage::Working => self.work(&t, cancel).await?,
                Stage::Checking => self.check(&t, cancel).await?,
                Stage::Reviewing => self.review(&t, cancel).await?,
                Stage::Testing => self.test(&t, cancel).await?,
                Stage::Opening => self.open_pr(&t, cancel).await?,
                Stage::Waiting => {
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_secs(self.cfg.worker.retry_seconds)) => {}
                        _ = cancel.cancelled() => return Ok(()),
                    }
                    self.stage(id, t.resume.unwrap_or(Stage::Provisioning), "模型恢复后重试", "")?;
                    None
                }
                _ => return Ok(()),
            };
            match halt {
                None => {}
                Some(Halt::Blocked) => return Ok(()),
                Some(Halt::Wait(why)) => {
                    let t = self.ticket(id)?;
                    self.store.write(|tx| advance(tx, id, Stage::Waiting, "模型不可用，等待重试", &why, Some(t.stage)))?;
                }
            }
        }
    }

    /// Turn a stage-model error into what the pipeline should do about it.
    pub fn on_stage_error(&self, e: StageError) -> StageResult {
        match e {
            StageError::Unavailable(m) => Ok(Some(Halt::Wait(m))),
            other => Err(anyhow!("{other}")),
        }
    }

    pub async fn sb(self: &Arc<Self>, t: &Ticket, spec: ExecSpec, cancel: &CancellationToken) -> Result<acw_sandbox::ExecResult> {
        let mut spec = spec;
        for (k, v) in self.sandbox_env(&t.project) {
            if !spec.env.iter().any(|(x, _)| x == &k) {
                spec.env.push((k, v));
            }
        }
        let r = self.sandbox.exec(&sandbox_id(&t.id), spec, None, cancel.clone()).await?;
        if r.cancelled {
            return Err(anyhow!("已取消"));
        }
        Ok(r)
    }

    pub(crate) fn command_timeout(&self) -> Duration {
        Duration::from_secs(self.cfg.worker.command_minutes * 60)
    }

    // ------------------------------------------------------------ provisioning

    async fn provision(self: &Arc<Self>, t: &Ticket, cancel: &CancellationToken) -> StageResult {
        let p = self.project(&t.project)?;
        if !self.sandbox.isolated() && !self.cfg.sandbox.allow_unisolated {
            return Err(anyhow!("沙箱提供方 {} 没有隔离，配置里没有允许使用它（sandbox.allow_unisolated）", self.sandbox.name()));
        }
        self.stage(&t.id, Stage::Provisioning, "准备沙箱", &format!("提供方 {}", self.sandbox.name()))?;
        let remote = self.forge.remote(&p.repo);
        self.git.sync(&p.id, &remote).await?;
        let base_branch = self.base_of(t, &p)?;
        let base_now = self.git.base_tip(&p.id, &base_branch).await?.ok_or_else(|| anyhow!("仓库里没有分支 {}", base_branch))?;
        let branch = t.branch.clone().unwrap_or_else(|| branch_name(&t.id, &t.title));
        let sid = sandbox_id(&t.id);

        let mut egress = self.cfg.sandbox.egress.clone();
        if let Some(hp) = self.cfg.gateway_url.split("://").nth(1) {
            egress.push(hp.trim_end_matches('/').to_owned());
        }
        let created = self.sandbox.create(&SandboxSpec { id: sid.clone(), project: p.id.clone(), template: p.sandbox.template.clone(), egress }).await?;
        self.store.write(|tx| {
            let info = SandboxInfo { id: sid.clone(), ticket: t.id.clone(), project: p.id.clone(), provider: self.sandbox.name().into(), host: created.host.clone(), template: created.template.clone(), state: "running".into(), created: tx.now(), env_version: 0 };
            tx.emit("engine", Some(&t.id), Event::SandboxCreated { sandbox: info }).map(|_| ())
        })?;

        let bundle = self.git.seed_bundle(&p.id, &base_branch, Some(&branch)).await?;
        self.sandbox.put_file(&sid, "io/seed.bundle", &bundle).await?;
        let seeded = self.sb(t, ExecSpec::new(inside::seed(&base_branch, &branch)).cwd("io").timeout(Duration::from_secs(300)), cancel).await?;
        if !seeded.ok() {
            return Err(anyhow!("把代码放进沙箱失败：{}", seeded.tail(5)));
        }
        let head = seeded.output.lines().last().unwrap_or_default().trim().to_owned();
        self.store.write(|tx| {
            if t.branch.is_none() || t.base_sha.is_none() {
                tx.emit("engine", Some(&t.id), Event::BranchSet { branch: branch.clone(), base_sha: base_now.clone() })?;
            }
            if head != t.base_sha.clone().unwrap_or_else(|| base_now.clone()) && t.head_sha.as_deref() != Some(head.as_str()) {
                tx.emit("engine", Some(&t.id), Event::HeadMoved { sha: head.clone(), pushed: true, commits: 0 })?;
            }
            Ok(())
        })?;

        self.mount_siblings(&self.ticket(&t.id)?, cancel).await?;
        let env_version = self.prepare_env(t, &p, cancel).await?;
        if env_version > 0 {
            self.emit("engine", &t.id, Event::SandboxEnv { id: sid.clone(), version: env_version })?;
        }
        if self.restore_session(&t.id, &sid, cancel.clone()).await {
            self.step(&t.id, "box", "恢复了 Worker 上一次的会话", "");
        }
        // the base branch moved since this task branched off: bring the task branch onto it
        let t = self.ticket(&t.id)?;
        if t.head_sha.is_some() && t.base_sha.as_deref() != Some(base_now.as_str()) && !self.rebase(&t, &p, false, cancel).await? {
            return Ok(None);
        }
        let t = self.ticket(&t.id)?;
        if t.head_sha.is_some() && t.inputs.is_empty() {
            self.stage(&t.id, Stage::Checking, "沙箱已重建，重新校验", &format!("分支 {branch}"))?;
        } else {
            self.stage(&t.id, Stage::Working, "Worker 开工", &format!("分支 {branch}"))?;
        }
        Ok(None)
    }

    /// Commit what is in the sandbox, bring the commits out through the gateway and checkpoint them
    /// on the remote task branch. Returns the head when the branch has commits of its own.
    async fn sync_out(self: &Arc<Self>, t: &Ticket, cancel: &CancellationToken) -> Result<Option<String>> {
        let sid = sandbox_id(&t.id);
        let (branch, base_sha) = (t.branch.clone().ok_or_else(|| anyhow!("任务没有分支"))?, t.base_sha.clone().ok_or_else(|| anyhow!("任务没有基线提交"))?);
        let committed = self.sb(t, ExecSpec::new(inside::commit_all(&format!("{}: {}", t.id, t.title))).timeout(Duration::from_secs(120)), cancel).await?;
        if !committed.ok() {
            return Err(anyhow!("提交改动失败：{}", committed.tail(5)));
        }
        let head = committed.output.lines().last().unwrap_or_default().trim().to_owned();
        let exported = self.sb(t, ExecSpec::new(inside::export(&base_sha, &branch)).timeout(Duration::from_secs(120)), cancel).await?;
        let n: u32 = exported.output.lines().last().unwrap_or("0").trim().parse().unwrap_or(0);
        if n == 0 {
            return Ok(None);
        }
        if t.head_sha.as_deref() != Some(head.as_str()) {
            let p = self.project(&t.project)?;
            let bundle = self.sandbox.get_file(&sid, "io/out.bundle").await?;
            let acc = self.git.accept_bundle(&p.id, &t.id, &branch, &base_sha, &bundle).await?;
            let pushed = match self.git.push(&p.id, &t.id, &branch, &self.forge.remote(&p.repo)).await {
                Ok(()) => true,
                Err(e) => {
                    self.step(&t.id, "log", "把任务分支推到远端失败，开 PR 前会重试", &e.to_string());
                    false
                }
            };
            self.emit("worker", &t.id, Event::HeadMoved { sha: acc.head, pushed, commits: acc.commits })?;
            self.siblings_changed(&t.id)?;
        }
        Ok(Some(head))
    }

    /// Put the task branch on top of the current base. `fetch` brings the new base into an existing
    /// sandbox first. Returns false when there are conflicts: the Worker is then asked to resolve them.
    async fn rebase(self: &Arc<Self>, t: &Ticket, p: &Project, fetch: bool, cancel: &CancellationToken) -> Result<bool> {
        let sid = sandbox_id(&t.id);
        let base_branch = self.base_of(t, p)?;
        let base_tip = self.git.base_tip(&p.id, &base_branch).await?.ok_or_else(|| anyhow!("仓库里没有分支 {}", base_branch))?;
        let b = acw_sandbox::sh_quote(&base_branch);
        if fetch {
            let bundle = self.git.seed_bundle(&p.id, &base_branch, None).await?;
            self.sandbox.put_file(&sid, "io/base.bundle", &bundle).await?;
            let f = self.sb(t, ExecSpec::new(format!("git fetch -q ../io/base.bundle +refs/heads/{b}:refs/heads/{b}")).timeout(Duration::from_secs(300)), cancel).await?;
            if !f.ok() {
                return Err(anyhow!("把新的基线放进沙箱失败：{}", f.tail(5)));
            }
        }
        let r = self.sb(t, ExecSpec::new(format!("git rebase -q {b} 2>&1 || {{ git diff --name-only --diff-filter=U; git rebase --abort; exit 9; }}")).timeout(Duration::from_secs(300)), cancel).await?;
        if r.ok() {
            self.emit("engine", &t.id, Event::BranchSet { branch: t.branch.clone().unwrap_or_default(), base_sha: base_tip.clone() })?;
            let t2 = self.ticket(&t.id)?;
            self.sync_out(&t2, cancel).await?;
            self.step(&t.id, "box", &format!("{} 有新提交，任务分支已自动变基", base_branch), &format!("新的基线 {}", &base_tip[..base_tip.len().min(7)]));
            return Ok(true);
        }
        let files: Vec<&str> = r.output.lines().filter(|l| !l.contains(' ') && !l.is_empty()).collect();
        self.store.write(|tx| {
            let text = format!("{base} 有新提交，和任务分支冲突。运行 `git rebase {base}`，解决冲突后 `git rebase --continue`，再跑一遍测试。冲突的文件：\n{}", files.join("\n"), base = base_branch.as_str());
            tx.emit("engine", Some(&t.id), Event::InputQueued { input: Input { source: "rebase".into(), text, trusted: true } })?;
            advance(tx, &t.id, Stage::Working, "变基有冲突，Worker 在解决", "", None)
        })?;
        Ok(false)
    }

    /// Make sure the sandbox is there; a lost one is rebuilt from the template and the branch.
    pub(crate) async fn ensure_sandbox(self: &Arc<Self>, t: &Ticket, cancel: &CancellationToken) -> Result<bool> {
        if self.sandbox.exists(&sandbox_id(&t.id)).await {
            let paused = self.store.read(|v| v.sandboxes())?.iter().any(|sb| sb.ticket == t.id && sb.state == "paused");
            if paused {
                self.sandbox.resume(&sandbox_id(&t.id)).await?;
                self.store.write(|tx| tx.emit("engine", Some(&t.id), Event::SandboxStateChanged { id: sandbox_id(&t.id), state: "running".into() }).map(|_| ()))?;
            }
            return Ok(true);
        }
        let back_to = t.stage;
        self.step(&t.id, "box", "沙箱不在了，用模板和任务分支重建", "");
        if let Some(h) = self.provision(t, cancel).await? {
            let _ = h;
        }
        // provisioning ends at Working; checks and later stages need the stage they were in
        if back_to != Stage::Working {
            self.stage(&t.id, back_to, &t.state, "沙箱已重建")?;
        }
        Ok(false)
    }

    // ------------------------------------------------------------ pull-request groups

    /// Put the code of the sibling tasks (other repositories of the same plan) next to this task's
    /// repository, at `deps/<project>`: the sibling's branch while it is open, its base once merged.
    pub(crate) async fn mount_siblings(self: &Arc<Self>, t: &Ticket, cancel: &CancellationToken) -> Result<()> {
        if t.siblings.is_empty() {
            return Ok(());
        }
        let sid = sandbox_id(&t.id);
        let mut shas = std::collections::BTreeMap::new();
        for sib in &t.siblings {
            let Some(st) = self.store.read(|v| v.ticket(sib))? else { continue };
            let sp = self.project(&st.project)?;
            self.git.sync(&sp.id, &self.forge.remote(&sp.repo)).await?;
            let merged = st.merged_at.is_some() || st.stage == Stage::Done;
            let branch = if merged { None } else { st.branch.clone() };
            let bundle = self.git.seed_bundle(&sp.id, &sp.base_branch, branch.as_deref()).await?;
            let file = format!("dep-{}.bundle", sp.id);
            self.sandbox.put_file(&sid, &format!("io/{file}"), &bundle).await?;
            let checkout = branch.unwrap_or_else(|| sp.base_branch.clone());
            let cmd = format!(
                "set -e; mkdir -p ../deps; rm -rf ../deps/{p}; git clone -q -b {b} {f} ../deps/{p}; rm -f {f}; git -C ../deps/{p} rev-parse HEAD",
                p = acw_sandbox::sh_quote(&sp.id), b = acw_sandbox::sh_quote(&checkout), f = acw_sandbox::sh_quote(&file)
            );
            let r = self.sb(t, ExecSpec::new(cmd).cwd("io").timeout(Duration::from_secs(300)), cancel).await?;
            if !r.ok() {
                return Err(anyhow!("把同组仓库 {} 的代码放进沙箱失败：{}", sp.id, r.tail(5)));
            }
            shas.insert(sib.clone(), r.output.lines().last().unwrap_or_default().trim().to_owned());
        }
        if shas != t.siblings_sha {
            self.emit("engine", &t.id, Event::SiblingsPinned { shas })?;
        }
        Ok(())
    }

    /// A task's branch moved: tasks in other repositories that depend on it verified against the
    /// old commit. Those with an open pull request go back to work to check again.
    pub(crate) fn siblings_changed(&self, id: &str) -> Result<()> {
        let moved = self.ticket(id)?;
        let woke = self.store.write(|tx| {
            let mut woke = false;
            for d in tx.view().tickets()?.into_iter().filter(|d| d.siblings.iter().any(|s| s == id) && d.stage.is_open() && d.head_sha.is_some()) {
                if d.siblings_sha.get(id) == moved.head_sha.as_ref() {
                    continue;
                }
                let text = format!("同组的 {}（仓库 {}）有新提交，../deps/{} 已经更新。重新跑构建和测试，确认你的改动对着它仍然成立；需要改就改，不需要改就说明原因。", moved.id, moved.project, moved.project);
                tx.emit("engine", Some(&d.id), Event::InputQueued { input: Input { source: "sibling".into(), text, trusted: true } })?;
                if d.stage == Stage::PrOpen {
                    close_queue(tx, &d.id, "pr", "sibling_changed")?;
                    set_stage(tx, "engine", &d.id, Stage::Queued, "排队中", &format!("同组的 {} 有新提交，重新验证", moved.id), Some(Stage::Provisioning))?;
                    woke = true;
                }
            }
            Ok(woke)
        })?;
        if woke {
            self.kick();
        }
        Ok(())
    }

    // ------------------------------------------------------------ working

    async fn work(self: &Arc<Self>, t: &Ticket, cancel: &CancellationToken) -> StageResult {
        let had_sandbox = self.ensure_sandbox(t, cancel).await?;
        let t = &self.ticket(&t.id)?;
        let sid = sandbox_id(&t.id);
        let (branch, base_sha) = (t.branch.clone().ok_or_else(|| anyhow!("任务没有分支"))?, t.base_sha.clone().ok_or_else(|| anyhow!("任务没有基线提交"))?);
        let first = t.head_sha.is_none();
        let memory: Vec<String> = self.store.read(|v| v.memory(Some(&t.project)))?.into_iter().map(|m| m.text).collect();
        let p0 = self.project(&t.project)?;
        let map = if first { self.load_index(&t.project).map(|i| i.repo_map(&p0, 60)).unwrap_or_default() } else { String::new() };
        let mut prompt = compose_prompt(t, &branch, &t.inputs, first, &memory);
        if !map.is_empty() {
            prompt.push_str(&format!("\n# 仓库地图（来自代码索引，按模块列出文件、定义和访问的表与接口；以代码为准）\n{map}\n"));
        }
        if !t.siblings.is_empty() {
            if had_sandbox {
                self.mount_siblings(t, cancel).await?;
            }
            let mut lines = Vec::new();
            for sid in &t.siblings {
                if let Some(st) = self.store.read(|v| v.ticket(sid))? {
                    lines.push(format!("- ../deps/{}：{} {}（{}）", st.project, st.id, st.title, if st.merged_at.is_some() || st.stage == Stage::Done { "已合并，这里是它的主分支" } else { "还没合并，这里是它的任务分支" }));
                }
            }
            prompt.push_str(&format!("\n# 同组的其它仓库\n这个任务和别的仓库里的任务是一组，它们的代码放在下面的目录里，只读：改那里的文件不会被提交。你的改动要对着它们成立。\n{}\n", lines.join("\n")));
        }
        let consumed = t.inputs.len();
        self.stage(&t.id, Stage::Working, if first { "Worker 在改代码" } else { "Worker 在按反馈修改" }, "")?;

        // continue the agent's own conversation when its session is in this sandbox (kept, or restored after a rebuild)
        let _ = had_sandbox;
        let has_session = self.sandbox.exec(&sid, ExecSpec::new("test -d ../home/.codex/sessions").timeout(Duration::from_secs(20)), None, cancel.clone()).await.map(|r| r.ok()).unwrap_or(false);
        let out = self.run_agent(t, &sid, &prompt, has_session && !first, cancel.clone()).await?;
        if out.exec.cancelled {
            return Err(anyhow!("已取消"));
        }
        if let Ok(bytes) = self.sandbox.get_file(&sid, "io/progress.md").await {
            let items = parse_progress(&String::from_utf8_lossy(&bytes));
            if !items.is_empty() && items != t.progress {
                self.emit("worker", &t.id, Event::ProgressUpdated { items })?;
            }
        }
        if out.exec.timed_out || out.exec.idle {
            let n = t.restarts + 1;
            let reason = if out.exec.idle { format!("{} 分钟没有任何输出", self.cfg.worker.idle_minutes) } else { format!("一次运行超过 {} 分钟", self.cfg.worker.run_minutes) };
            self.emit("engine", &t.id, Event::WorkerRestarted { reason: reason.clone(), n })?;
            if n > 2 {
                return Err(anyhow!("Worker 卡住（{reason}），已重启 2 次仍然没有进展"));
            }
            return Ok(None);
        }
        if !out.exec.ok() {
            // a failed run right after the gateway saw the model down is a wait, not a failure
            if let Some(why) = crate::gateway::recent_outage(&t.id) {
                return Ok(Some(Halt::Wait(why)));
            }
            if over_budget(&self.ticket(&t.id)?, &self.settings()?) {
                return Ok(None);
            }
            return Err(anyhow!("Worker 异常退出（退出码 {}）：{}", out.exec.code, out.exec.tail(6)));
        }
        self.emit("engine", &t.id, Event::InputsConsumed { n: consumed })?;

        // the Worker may have rebased (it is asked to when there are conflicts): record the base it is on now
        let p = self.project(&t.project)?;
        let base_branch = self.base_of(t, &p)?;
        let mb = self.sb(t, ExecSpec::new(format!("git merge-base HEAD {}", acw_sandbox::sh_quote(&base_branch))).timeout(Duration::from_secs(60)), cancel).await?;
        let merge_base = mb.output.lines().last().unwrap_or_default().trim().to_owned();
        if mb.ok() && !merge_base.is_empty() && merge_base != base_sha {
            self.emit("engine", &t.id, Event::BranchSet { branch: branch.clone(), base_sha: merge_base })?;
        }
        let t = &self.ticket(&t.id)?;
        self.sync_out(t, cancel).await?;
        // asked to resolve a rebase conflict and still not on the current base: stop looping, a person decides
        let asked_to_rebase = prompt.contains("## 来源：rebase");
        let tip = self.git.base_tip(&p.id, &base_branch).await?;
        if asked_to_rebase && tip.is_some() && tip != t.base_sha {
            self.block(t, "ask", &format!("{} 有新提交，和任务分支冲突，Worker 没能解决。可以接手分支手工变基后交还，或者回答该怎么取舍。", base_branch), &[], Stage::Working, Role::Approver)?;
            return Ok(Some(Halt::Blocked));
        }

        if let Ok(bytes) = self.sandbox.get_file(&sid, "io/arch.json").await {
            match serde_json::from_slice::<ArchDelta>(&bytes).map_err(|e| e.to_string()).and_then(|d| d.validate().map(|_| d)) {
                Ok(delta) => {
                    let same = t.arch.as_ref().is_some_and(|a| a.nodes == delta.nodes && a.before == delta.before && a.after == delta.after);
                    if !same {
                        self.emit("worker", &t.id, Event::ArchDeltaProposed { delta })?;
                    }
                }
                Err(e) => self.step(&t.id, "log", "io/arch.json 不合规，忽略", &e),
            }
        }
        if let Ok(bytes) = self.sandbox.get_file(&sid, "io/env.json").await {
            let _ = self.sb(t, ExecSpec::new("rm -f ../io/env.json").timeout(Duration::from_secs(20)), cancel).await;
            let parsed = serde_json::from_slice::<serde_json::Value>(&bytes).ok().and_then(|v| Some((v.get("why")?.as_str()?.to_owned(), serde_json::from_value::<EnvPlan>(v.clone()).ok()?)));
            match parsed {
                Some((why, plan)) => match self.propose_env_change(t, &why, plan) {
                    Ok(true) => self.step(&t.id, "box", "Worker 提议的环境计划改动已自动采纳", &why),
                    Ok(false) => self.step(&t.id, "box", "Worker 提议改环境计划，等审批人确认", &why),
                    Err(e) => self.step(&t.id, "log", "Worker 提议的环境计划不合规，没有提交给人", &e.to_string()),
                },
                None => self.step(&t.id, "log", "io/env.json 不是约定的格式，忽略", ""),
            }
        }
        if t.plan.is_some() {
            if let Ok(bytes) = self.sandbox.get_file(&sid, "io/replan.json").await {
                let _ = self.sb(t, ExecSpec::new("rm -f ../io/replan.json").timeout(Duration::from_secs(20)), cancel).await;
                let parsed = serde_json::from_slice::<serde_json::Value>(&bytes).ok().and_then(|v| Some((v.get("why")?.as_str()?.to_owned(), serde_json::from_value::<Vec<PlanTask>>(v.get("tasks")?.clone()).ok()?)));
                match parsed {
                    Some((why, tasks)) => {
                        if let Err(e) = self.propose_plan_change(t, &why, tasks) {
                            self.step(&t.id, "log", "Worker 提议的计划改动不合规，没有提交给人", &e.to_string());
                        }
                    }
                    None => self.step(&t.id, "log", "io/replan.json 不是约定的格式，忽略", ""),
                }
            }
        }
        if let Ok(q) = self.sandbox.get_file(&sid, "io/question.md").await {
            let (question, _) = acw_core::scan::redact(String::from_utf8_lossy(&q).trim());
            if !question.is_empty() {
                self.block(t, "ask", &question, &[], Stage::Working, Role::Approver)?;
                return Ok(Some(Halt::Blocked));
            }
        }
        if self.ticket(&t.id)?.head_sha.is_none() {
            return Err(anyhow!("Worker 结束了，但没有改动任何代码{}", if out.summary.is_empty() { String::new() } else { format!("。它的说明：{}", out.summary) }));
        }
        self.stage(&t.id, Stage::Checking, "跑构建、lint 和单元测试", "")?;
        Ok(None)
    }

    // ------------------------------------------------------------ opening the PR

    async fn open_pr(self: &Arc<Self>, t: &Ticket, cancel: &CancellationToken) -> StageResult {
        if t.risks.iter().any(|r| r.approved_by.is_none()) {
            let text = format!("这些改动需要审批角色批准：{}", t.risks.iter().filter(|r| r.approved_by.is_none()).map(|r| r.what.as_str()).collect::<Vec<_>>().join("；"));
            self.block(t, "risk", &text, &["批准", "停止任务"], Stage::Opening, Role::Approver)?;
            return Ok(Some(Halt::Blocked));
        }
        // the Engine re-checks the whole contract against the commit it is about to publish
        if !t.contract_ok() {
            let missing: Vec<&str> = t.contract.iter().filter(|c| c.result != Verdict::Pass || (c.key != "confirmed" && c.sha != t.head_sha)).map(|c| c.key.as_str()).collect();
            self.stage(&t.id, Stage::Checking, "完成条件要在最新提交上重验", &format!("还没通过：{}", missing.join("、")))?;
            return Ok(None);
        }
        let p = self.project(&t.project)?;
        // back here after a rebase with a pull request already open: if that one merged meanwhile, the
        // task is finished, and opening a second pull request for the same change would be wrong
        if let Some(pr) = &t.pr {
            if matches!(self.forge.pr_status(&p.slug, pr.number).await, Ok(acw_git::forge::PrStatus::Merged)) {
                self.on_merged(&t.id, "forge")?;
                return Ok(Some(Halt::Blocked));
            }
        }
        let branch = t.branch.clone().ok_or_else(|| anyhow!("任务没有分支"))?;
        // never publish a branch that is behind its base: rebase, then every result is re-earned on the new commit
        self.git.sync(&p.id, &self.forge.remote(&p.repo)).await?;
        let base_branch = self.base_of(t, &p)?;
        let base_tip = self.git.base_tip(&p.id, &base_branch).await?;
        if base_tip.is_some() && base_tip != t.base_sha {
            self.ensure_sandbox(t, cancel).await?;
            let t = self.ticket(&t.id)?;
            if t.stage == Stage::Opening && self.rebase(&t, &p, true, cancel).await? {
                self.stage(&t.id, Stage::Checking, "变基后重新校验", "")?;
            }
            return Ok(None);
        }
        self.git.push(&p.id, &t.id, &branch, &self.forge.remote(&p.repo)).await?;
        let files: Vec<String> = self.git.changes(&p.id, t.base_sha.as_deref().unwrap_or_default(), t.head_sha.as_deref().unwrap_or_default()).await?.into_iter().map(|c| c.path).collect();
        let mut actual: Vec<String> = Vec::new();
        for f in &files {
            for m in p.modules_of_path(f) {
                if !actual.contains(&m.name) {
                    actual.push(m.name.clone());
                }
            }
        }
        self.emit("engine", &t.id, Event::ModulesScored { predicted: t.modules.clone(), actual })?;
        self.emit("engine", &t.id, Event::FilesChanged { files })?;
        let mut body = pr_body(t, &self.link(&t.id));
        if !t.siblings.is_empty() {
            body.push_str("\n## 同组的 PR\n这个 PR 依赖别的仓库里的改动。按下面的顺序合并，先合并它们：\n");
            for sid in &t.siblings {
                if let Some(st) = self.store.read(|v| v.ticket(sid))? {
                    let at = t.siblings_sha.get(sid).map(|s| format!("，对着 {} 验证过", &s[..s.len().min(7)])).unwrap_or_default();
                    body.push_str(&match &st.pr {
                        Some(pr) if st.merged_at.is_none() => format!("- {}：{}（{} {}）{at}\n", st.project, pr.url, st.id, st.title),
                        _ => format!("- {}：{} {}，已合并{at}\n", st.project, st.id, st.title),
                    });
                }
            }
        }
        let pr = self.forge.open_pr(&p.slug, &branch, &base_branch, &format!("{}: {}", t.id, t.title), &body).await?;
        // a stacked task whose parent merged now targets the project's base
        self.forge.set_base(&p.slug, pr.number, &base_branch).await?;
        let link = self.link(&t.id);
        self.store.write(|tx| {
            tx.emit("engine", Some(&t.id), Event::PrOpened { pr: PrRef { number: pr.number, url: pr.url.clone() } })?;
            advance(tx, &t.id, Stage::PrOpen, &format!("等你审批 PR #{}", pr.number), "完成条件 5 项全部通过，不会自动合并", None)?;
            open_queue(tx, t, "pr", &format!("PR #{} 等审批：完成条件全部通过", pr.number), Role::Approver, None, &link)
        })?;
        // keep the sandbox for follow-up changes, but stop paying for it
        if self.sandbox.pause(&sandbox_id(&t.id)).await.is_ok() {
            self.store.write(|tx| tx.emit("engine", Some(&t.id), Event::SandboxStateChanged { id: sandbox_id(&t.id), state: "paused".into() }).map(|_| ()))?;
        }
        // tasks stacked on this one may start now
        self.advance_plans()?;
        Ok(Some(Halt::Blocked))
    }
}

/// The PR description: the mandate, the contract and where the evidence is. No secrets, no raw logs.
pub fn pr_body(t: &Ticket, link: &str) -> String {
    let m = &t.mandate;
    let mut b = format!("## 目标\n{}\n\n## 验收标准\n", m.goal);
    for (i, a) in m.accept.iter().enumerate() {
        b.push_str(&format!("{}. {a}\n", i + 1));
    }
    b.push_str("\n## 完成条件\n");
    for c in &t.contract {
        let name = match c.key.as_str() {
            "checks" => "构建、lint、单元测试",
            "e2e" => "全量 E2E 与验收测试",
            "review" => "审查无已证实的 P0 或 P1",
            "tests_kept" => "测试未删除、未新增 skip",
            _ => "需人确认的事项已确认",
        };
        b.push_str(&format!("- [x] {name}{}\n", if c.note.is_empty() { String::new() } else { format!("：{}", c.note) }));
    }
    if !t.risks.is_empty() {
        b.push_str("\n## 经批准的改动\n");
        for r in &t.risks {
            b.push_str(&format!("- {}（{} 批准）\n", r.what, r.approved_by.as_deref().unwrap_or("-")));
        }
    }
    b.push_str(&format!("\n审查 {} 轮，花费 ¥{:.2}。时间线和证据：{link}\n\n由 Auto-CodWorker 提交，需要人审批后合并。\n", t.review.round, t.cost));
    b
}
