//! The Engine: the one place that decides. It holds no state of its own beyond what is running
//! right now; everything durable is in the event log.

use crate::config::Config;
use acw_core::*;
use acw_git::{Forge, GitGateway, LocalForge};
use acw_llm::LlmClient;
use acw_sandbox::{CancellationToken, SandboxProvider};
use anyhow::Result;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;

/// Errors a caller can do something about. Everything else is an internal error.
#[derive(Debug)]
pub enum CmdError {
    Forbidden(String),
    NotFound(String),
    Invalid(String),
    Conflict(String),
}

impl std::fmt::Display for CmdError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CmdError::Forbidden(s) | CmdError::NotFound(s) | CmdError::Invalid(s) | CmdError::Conflict(s) => f.write_str(s),
        }
    }
}
impl std::error::Error for CmdError {}

pub fn forbidden(s: impl Into<String>) -> anyhow::Error {
    CmdError::Forbidden(s.into()).into()
}
pub fn not_found(s: impl Into<String>) -> anyhow::Error {
    CmdError::NotFound(s.into()).into()
}
pub fn invalid(s: impl Into<String>) -> anyhow::Error {
    CmdError::Invalid(s.into()).into()
}
pub fn conflict(s: impl Into<String>) -> anyhow::Error {
    CmdError::Conflict(s.into()).into()
}

/// Who is acting. System actors (`engine`, `router`, `github`…) pass every check; they only
/// run code paths the Engine itself chose.
#[derive(Clone, Debug)]
pub struct Actor {
    pub id: String,
    pub member: Option<Member>,
    pub system: bool,
}

impl Actor {
    pub fn system(id: &str) -> Self {
        Actor { id: id.to_owned(), member: None, system: true }
    }
    pub fn member(m: Member) -> Self {
        Actor { id: m.id.clone(), member: Some(m), system: false }
    }
    pub fn visitor(name: &str) -> Self {
        Actor { id: name.to_owned(), member: None, system: false }
    }
    pub fn can(&self, need: Role, project: Option<&str>) -> bool {
        self.system || can(self.member.as_ref(), need, project)
    }
    /// The check every command starts with. A refusal is recorded by the caller.
    pub fn require(&self, need: Role, project: Option<&str>, what: &str) -> Result<()> {
        if self.can(need, project) {
            Ok(())
        } else {
            Err(forbidden(format!("{what}需要{}角色", role_name(need))))
        }
    }
}

pub fn role_name(r: Role) -> &'static str {
    match r {
        Role::Visitor => "访客",
        Role::Requester => "提需求",
        Role::Approver => "审批",
        Role::Admin => "管理",
    }
}

pub struct Run {
    pub cancel: CancellationToken,
    /// Tells this run apart from a later one for the same ticket.
    pub gen: u64,
}

pub struct Engine {
    pub store: Store,
    pub cfg: Config,
    pub llm: LlmClient,
    pub http: reqwest::Client,
    pub sandbox: Arc<dyn SandboxProvider>,
    pub git: GitGateway,
    pub forge: Arc<dyn Forge>,
    /// Set when the forge is the local one, so the console can "merge" in demos.
    pub local_forge: Option<Arc<LocalForge>>,
    /// Pipelines running right now, by ticket.
    pub runs: Mutex<HashMap<String, Run>>,
    /// Poked whenever admission should be reconsidered.
    pub wake: Notify,
    /// Tasks that just merged and have not been mined for project memory yet.
    pub merged: Mutex<Vec<String>>,
    pub standby: crate::standby::State,
    /// Feishu tenant access token and when it stops being usable.
    pub feishu_token: Mutex<Option<(String, std::time::Instant)>>,
}

impl Engine {
    pub fn ticket(&self, id: &str) -> Result<Ticket> {
        self.store.read(|v| v.ticket(id))?.ok_or_else(|| not_found(format!("找不到任务 {id}")))
    }
    pub fn project(&self, id: &str) -> Result<Project> {
        self.store.read(|v| v.project(id))?.ok_or_else(|| not_found(format!("找不到项目 {id}")))
    }
    pub fn settings(&self) -> Result<Settings> {
        self.store.read(|v| v.settings())
    }
    pub fn link(&self, ticket: &str) -> String {
        format!("{}/#ticket-{ticket}", self.cfg.public_url.trim_end_matches('/'))
    }
    pub fn artifacts(&self, ticket: &str) -> std::path::PathBuf {
        self.cfg.data_dir.join("artifacts").join(ticket)
    }
    pub fn is_running(&self, ticket: &str) -> bool {
        self.runs.lock().map(|r| r.contains_key(ticket)).unwrap_or(false)
    }
    /// Stop the pipeline of a ticket, if one is running. The current command is killed.
    pub fn cancel_run(&self, ticket: &str) {
        if let Ok(mut runs) = self.runs.lock() {
            if let Some(run) = runs.remove(ticket) {
                run.cancel.cancel();
            }
        }
    }
    pub fn kick(&self) {
        self.wake.notify_one();
    }
}

// ---------------------------------------------------------------- helpers used inside commands

/// Members who can act on an item that needs `need` on `project`.
pub fn owners(v: &View, need: Role, project: &str, also: Option<&str>) -> Result<Vec<String>> {
    Ok(v.members()?.into_iter().filter(|m| can(Some(m), need, Some(project)) || also == Some(m.id.as_str())).map(|m| m.id).collect())
}

pub fn can_act(m: &Member, q: &QueueItem, delegators: &[Member]) -> bool {
    let direct = |m: &Member| match &q.hand_to {
        Some(to) => to == &m.id || m.role_for(None) == Role::Admin,
        None => can(Some(m), q.need, Some(&q.project)) || q.also.as_deref() == Some(m.id.as_str()),
    };
    // someone who delegated to `m` lends their rights until the date they set
    direct(m) || delegators.iter().any(|d| d.delegate.as_ref().is_some_and(|x| x.to == m.id && x.until >= now_ms()) && direct(d))
}

/// Open items a member can act on, oldest first.
pub fn queue_of(v: &View, member: &Member) -> Result<Vec<QueueItem>> {
    let members = v.members()?;
    Ok(v.queue()?.into_iter().filter(|q| can_act(member, q, &members)).collect())
}

pub fn queue_limit(m: &Member, s: &Settings) -> u32 {
    m.queue_limit.unwrap_or(s.queue_limit)
}

pub fn set_stage(tx: &mut Tx, actor: &str, id: &str, stage: Stage, state: &str, why: &str, resume: Option<Stage>) -> Result<()> {
    tx.emit(actor, Some(id), Event::StageChanged { stage, state: state.to_owned(), why: why.to_owned(), resume })?;
    Ok(())
}

/// Put something in front of people and tell them. One open item per ticket and kind.
#[allow(clippy::too_many_arguments)]
pub fn open_queue(tx: &mut Tx, t: &Ticket, kind: &str, why: &str, need: Role, also: Option<&str>, link: &str) -> Result<()> {
    let id = format!("{}:{kind}", t.id);
    if tx.view().queue_item(&id)?.is_some() {
        return Ok(());
    }
    let item = QueueItem {
        id,
        ticket: t.id.clone(),
        project: t.project.clone(),
        kind: kind.to_owned(),
        title: format!("{} {}", t.id, t.title),
        why: why.to_owned(),
        since: tx.now(),
        need,
        also: also.map(str::to_owned),
        hand_to: None,
        reminded: false,
        escalated: false,
    };
    let to = owners(&tx.view(), need, &t.project, also)?;
    tx.emit("engine", Some(&t.id), Event::QueueOpened { item })?;
    if tx.view().settings()?.notify.get(kind).copied().unwrap_or(true) {
        tx.effect(Effect::Notify { kind: kind.to_owned(), to, text: format!("{} {}：{why}", t.id, t.title), link: link.to_owned() })?;
    }
    Ok(())
}

pub fn close_queue(tx: &mut Tx, ticket: &str, kind: &str, how: &str) -> Result<()> {
    let id = format!("{ticket}:{kind}");
    if tx.view().queue_item(&id)?.is_some() {
        tx.emit("engine", Some(ticket), Event::QueueClosed { id, how: how.to_owned() })?;
    }
    Ok(())
}

pub fn close_all_queue(tx: &mut Tx, ticket: &str, how: &str) -> Result<()> {
    for q in tx.view().queue()?.into_iter().filter(|q| q.ticket == ticket) {
        tx.emit("engine", Some(ticket), Event::QueueClosed { id: q.id, how: how.to_owned() })?;
    }
    Ok(())
}

pub fn security(tx: &mut Tx, ticket: Option<&str>, kind: &str, who: &str, what: &str, result: &str) -> Result<()> {
    tx.emit("engine", ticket, Event::SecurityLogged { kind: kind.to_owned(), who: who.to_owned(), what: what.to_owned(), result: result.to_owned() })?;
    Ok(())
}

pub fn over_budget(t: &Ticket, s: &Settings) -> bool {
    t.cost >= s.budget + t.budget_extra
}

pub fn day_start(now: Ms) -> Ms {
    // days are cut at UTC+8 midnight: the team works in one timezone
    const DAY: Ms = 86_400_000;
    const TZ: Ms = 8 * 3_600_000;
    (now + TZ) / DAY * DAY - TZ
}
