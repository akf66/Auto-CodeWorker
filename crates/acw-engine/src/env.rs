//! Environment plans: how a project's sandbox is prepared (setup commands, services with health
//! checks, environment variables). A plan is versioned. Approvers change it directly; a Worker can
//! only propose, and the Engine applies a proposal on its own only when it is a plain dependency
//! install from the allow-list in the settings. Everything else waits for an approver.

use crate::engine::*;
use crate::pipeline::sandbox_id;
use acw_core::*;
use acw_git::git;
use acw_sandbox::{sh_quote, CancellationToken, ExecSpec};
use anyhow::{anyhow, Result};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

fn env_queue(tx: &mut Tx, p: &EnvProposal, link: &str) -> Result<()> {
    let item = QueueItem { id: format!("{}:env", p.id), ticket: p.id.clone(), project: p.project.clone(), kind: "env".into(), title: format!("环境计划 {}", p.project), why: format!("{} 的 Worker 提议改环境计划：{}（{}）", p.from, p.why, p.need), since: tx.now(), need: Role::Approver, also: None, hand_to: None, reminded: false, escalated: false };
    let to = owners(&tx.view(), Role::Approver, &p.project, None)?;
    tx.emit("engine", None, Event::QueueOpened { item })?;
    tx.effect(Effect::Notify { kind: "env".into(), to, text: format!("{} 的环境计划有一份改动等确认：{}", p.project, p.why), link: link.to_owned() })
}

impl Engine {
    /// The plan in force. Before anyone sets one it is the project's `commands.setup`, version 0.
    pub fn env_plan(&self, project: &Project) -> Result<EnvPlan> {
        Ok(self.store.read(|v| v.env_plan(&project.id))?.unwrap_or_else(|| EnvPlan { project: project.id.clone(), setup: project.commands.setup.clone(), ..Default::default() }))
    }

    fn env_link(&self, project: &str) -> String {
        format!("{}/#project-{project}", self.cfg.public_url.trim_end_matches('/'))
    }

    pub fn set_env_plan(&self, actor: &Actor, project: &str, mut plan: EnvPlan, note: &str) -> Result<EnvPlan> {
        let p = self.project(project)?;
        let old = self.env_plan(&p)?;
        self.store.write(|tx| {
            actor.require(Role::Approver, Some(project), "改环境计划")?;
            plan.validate().map_err(invalid)?;
            plan.project = project.to_owned();
            plan.version = old.version + 1;
            plan.by = actor.id.clone();
            plan.at = tx.now();
            plan.note = note.to_owned();
            tx.emit(&actor.id, None, Event::EnvPlanSet { plan: plan.clone() })?;
            Ok(plan)
        })
    }

    /// Put an earlier version back in force. It becomes a new version: history only grows.
    pub fn rollback_env_plan(&self, actor: &Actor, project: &str, version: u32) -> Result<EnvPlan> {
        let old = self.store.read(|v| v.env_history(project))?.into_iter().find(|p| p.version == version).ok_or_else(|| not_found(format!("环境计划没有第 {version} 版")))?;
        self.set_env_plan(actor, project, old, &format!("回滚到第 {version} 版"))
    }

    /// A Worker asks for a different environment. Returns true when it was applied without a person.
    pub fn propose_env_change(&self, from: &Ticket, why: &str, mut plan: EnvPlan) -> Result<bool> {
        let p = self.project(&from.project)?;
        let old = self.env_plan(&p)?;
        plan.validate().map_err(invalid)?;
        plan.project = p.id.clone();
        if old.diff(&plan).is_empty() {
            return Ok(true);
        }
        let auto = self.settings()?.env_auto;
        let link = self.env_link(&p.id);
        self.store.write(|tx| match old.needs_person(&plan, &auto) {
            None => {
                plan.version = old.version + 1;
                plan.by = "worker".into();
                plan.at = tx.now();
                plan.note = format!("{}：{why}", from.id);
                tx.emit("worker", Some(&from.id), Event::EnvPlanSet { plan: plan.clone() })?;
                Ok(true)
            }
            Some(need) => {
                if tx.view().env_proposals()?.iter().any(|x| x.from == from.id && x.plan.setup == plan.setup && x.plan.services == plan.services && x.plan.env == plan.env) {
                    return Ok(false);
                }
                let proposal = EnvProposal { id: format!("E-{}", tx.view().last_seq()? + 1), project: p.id.clone(), from: from.id.clone(), why: why.to_owned(), plan: plan.clone(), need, at: tx.now() };
                tx.emit("worker", Some(&from.id), Event::EnvChangeProposed { proposal: proposal.clone() })?;
                env_queue(tx, &proposal, &link)?;
                Ok(false)
            }
        })
    }

    pub fn decide_env_change(&self, actor: &Actor, id: &str, accept: bool, reason: &str) -> Result<()> {
        self.store.write(|tx| {
            let pr = tx.view().env_proposal(id)?.ok_or_else(|| not_found(format!("找不到环境计划的改动 {id}")))?;
            actor.require(Role::Approver, Some(&pr.project), "决定环境计划的改动")?;
            tx.emit(&actor.id, None, Event::EnvChangeDecided { id: id.to_owned(), accepted: accept, by: actor.id.clone(), reason: reason.to_owned() })?;
            if tx.view().queue_item(&format!("{id}:env"))?.is_some() {
                tx.emit("engine", None, Event::QueueClosed { id: format!("{id}:env"), how: if accept { "accepted" } else { "rejected" }.into() })?;
            }
            let text = if accept {
                let current = tx.view().env_plan(&pr.project)?.map(|p| p.version).unwrap_or(0);
                let mut plan = pr.plan.clone();
                plan.version = current + 1;
                plan.by = actor.id.clone();
                plan.at = tx.now();
                plan.note = format!("{}：{}", pr.from, pr.why);
                tx.emit(&actor.id, None, Event::EnvPlanSet { plan })?;
                "你提议的环境计划改动已经被同意，之后新建的沙箱会按它准备。".to_owned()
            } else {
                format!("你提议的环境计划改动没有被同意{}。不要依赖它。", if reason.trim().is_empty() { String::new() } else { format!("：{reason}") })
            };
            if tx.view().ticket(&pr.from)?.is_some_and(|t| !matches!(t.stage, Stage::Done | Stage::Dropped | Stage::Failed)) {
                tx.emit(&actor.id, Some(&pr.from), Event::InputQueued { input: Input { source: "member".into(), text, trusted: true } })?;
            }
            Ok(())
        })?;
        self.kick();
        Ok(())
    }

    /// A first draft from the files in the repository. Rule-based; nothing is applied.
    pub async fn detect_env(&self, project: &str) -> Result<EnvPlan> {
        let p = self.project(project)?;
        self.git.sync(&p.id, &self.forge.remote(&p.repo)).await?;
        let tip = self.git.base_tip(&p.id, &p.base_branch).await?.ok_or_else(|| not_found(format!("仓库里没有分支 {}", p.base_branch)))?;
        let files = git(&self.git.mirror(&p.id), &["ls-tree", "--name-only", &tip]).await?;
        let has = |f: &str| files.lines().any(|l| l == f);
        let mut setup = Vec::new();
        let mut note = Vec::new();
        if has("pnpm-lock.yaml") {
            setup.push("pnpm install --frozen-lockfile".to_owned());
        } else if has("yarn.lock") {
            setup.push("yarn install --frozen-lockfile".to_owned());
        } else if has("package-lock.json") {
            setup.push("npm ci".to_owned());
        } else if has("package.json") {
            setup.push("npm install".to_owned());
        }
        if has("go.mod") {
            setup.push("go mod download".to_owned());
        }
        if has("Cargo.toml") {
            setup.push("cargo fetch".to_owned());
        }
        if has("uv.lock") {
            setup.push("uv sync".to_owned());
        } else if has("requirements.txt") {
            setup.push("pip install -r requirements.txt".to_owned());
        }
        if has("Gemfile") {
            setup.push("bundle install".to_owned());
        }
        if has("composer.json") {
            setup.push("composer install".to_owned());
        }
        if ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"].iter().any(|f| has(f)) {
            note.push("仓库里有 compose 文件：它列的服务要人工写成服务项（启动命令和健康检查），这里不猜");
        }
        if setup.is_empty() {
            note.push("没有认出依赖清单");
        }
        Ok(EnvPlan { project: p.id, setup, note: note.join("；"), ..Default::default() })
    }

    /// Variables of the plan, for every command run in a sandbox of this project.
    pub fn sandbox_env(&self, project: &str) -> BTreeMap<String, String> {
        self.store.read(|v| v.env_plan(project)).ok().flatten().map(|p| p.env).unwrap_or_default()
    }

    /// Run the plan in a fresh sandbox: setup commands, then services, each waited for.
    pub(crate) async fn prepare_env(self: &Arc<Self>, t: &Ticket, p: &Project, cancel: &CancellationToken) -> Result<u32> {
        let plan = self.env_plan(p)?;
        let sid = sandbox_id(&t.id);
        let _ = self.sandbox.put_file(&sid, "io/env.current.json", &serde_json::to_vec_pretty(&serde_json::json!({ "version": plan.version, "setup": plan.setup, "services": plan.services, "env": plan.env }))?).await;
        for cmd in &plan.setup {
            let r = self.sb(t, ExecSpec::new(cmd.clone()).timeout(self.command_timeout()), cancel).await?;
            self.step(&t.id, "cmd", cmd, &format!("退出码 {}\n{}", r.code, r.tail(20)));
            if !r.ok() {
                return Err(anyhow!("环境准备命令失败（环境计划第 {} 版，{cmd}）：{}", plan.version, r.tail(8)));
            }
        }
        for s in &plan.services {
            let start = format!("nohup sh -c {} > ../io/svc-{n}.log 2>&1 & echo $! > ../io/svc-{n}.pid", sh_quote(&s.start), n = s.name);
            let r = self.sb(t, ExecSpec::new(start).timeout(Duration::from_secs(60)), cancel).await?;
            if !r.ok() {
                return Err(anyhow!("服务 {} 启动失败：{}", s.name, r.tail(5)));
            }
            let wait = if s.wait_s == 0 { 60 } else { s.wait_s };
            let began = std::time::Instant::now();
            loop {
                let h = self.sb(t, ExecSpec::new(s.health.clone()).timeout(Duration::from_secs(20)), cancel).await?;
                if h.ok() {
                    self.step(&t.id, "box", &format!("服务 {} 起来了", s.name), &format!("{} 秒", began.elapsed().as_secs()));
                    break;
                }
                if began.elapsed() > Duration::from_secs(wait as u64) {
                    let log = self.sandbox.get_file(&sid, &format!("io/svc-{}.log", s.name)).await.map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
                    let tail: Vec<&str> = log.lines().rev().take(8).collect();
                    return Err(anyhow!("服务 {} 在 {wait} 秒内没有通过健康检查（{}）。它的输出：\n{}", s.name, s.health, tail.into_iter().rev().collect::<Vec<_>>().join("\n")));
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        }
        Ok(plan.version)
    }
}
