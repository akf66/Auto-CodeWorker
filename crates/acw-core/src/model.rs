//! Domain model. Everything here is a projection of the event log: no field is
//! written anywhere except by `projection::apply`.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// Unix time in milliseconds.
pub type Ms = i64;

pub fn now_ms() -> Ms {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------- people

/// Roles are ordered: a higher role can do everything a lower one can.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    /// Not registered, or registered without rights: gets answers, never opens a task.
    Visitor,
    Requester,
    Approver,
    /// Global only.
    Admin,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Delegate {
    pub to: String,
    /// Inclusive end of the delegation.
    pub until: Ms,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Member {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub feishu: Option<String>,
    #[serde(default)]
    pub github: Option<String>,
    /// `"*"` is the global role; other keys are project ids and override it.
    pub roles: BTreeMap<String, Role>,
    /// Personal limit on open items; falls back to the global setting.
    #[serde(default)]
    pub queue_limit: Option<u32>,
    #[serde(default)]
    pub delegate: Option<Delegate>,
}

impl Member {
    pub fn role_for(&self, project: Option<&str>) -> Role {
        let global = self.roles.get("*").copied().unwrap_or(Role::Visitor);
        if global == Role::Admin {
            return Role::Admin;
        }
        project.and_then(|p| self.roles.get(p).copied()).unwrap_or(global)
    }
}

/// The one permission check. `None` is an unregistered sender.
pub fn can(member: Option<&Member>, need: Role, project: Option<&str>) -> bool {
    member.map(|m| m.role_for(project)).unwrap_or(Role::Visitor) >= need
}

// ---------------------------------------------------------------- projects

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Module {
    pub name: String,
    /// Path prefixes inside the repository.
    #[serde(default)]
    pub paths: Vec<String>,
    /// When set, a mandate or a diff touching this module needs an approver. The text names the rule.
    #[serde(default)]
    pub confirm: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Commands {
    /// Run once after the workspace is seeded (install dependencies and so on).
    #[serde(default)]
    pub setup: Vec<String>,
    #[serde(default)]
    pub build: Option<String>,
    #[serde(default)]
    pub lint: Option<String>,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub e2e: Option<String>,
}

/// Where the independent Tester writes the tests it generates from the acceptance criteria.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct TestGen {
    pub dir: String,
    /// Command that runs one generated test file; `{file}` is replaced by its path.
    pub command: String,
    /// Framework and conventions, in a sentence, for the Tester prompt.
    #[serde(default)]
    pub hint: String,
}

/// How a project proves one kind of non-functional criterion.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct EvidenceCmd {
    pub command: String,
    /// How many times to run it. Performance compares base and head over this many runs each.
    #[serde(default)]
    pub runs: u32,
    /// Regex whose first capture group is the measured number. Default: the last number printed.
    #[serde(default)]
    pub metric: Option<String>,
    #[serde(default)]
    pub higher_is_better: bool,
    /// Absolute bound the head's median must meet, when the criterion has one.
    #[serde(default)]
    pub limit: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct SandboxPref {
    #[serde(default)]
    pub provider: Option<String>,
    /// "沙箱只用自建": never place this project's sandboxes on a cloud provider.
    #[serde(default)]
    pub self_hosted_only: bool,
    #[serde(default)]
    pub template: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    /// Chat channels bound to this project, for example a Feishu group id.
    #[serde(default)]
    pub channels: Vec<String>,
    /// Clone URL, or a path for the local forge.
    pub repo: String,
    /// `owner/name` on the forge.
    #[serde(default)]
    pub slug: String,
    #[serde(default = "default_branch")]
    pub base_branch: String,
    #[serde(default)]
    pub modules: Vec<Module>,
    #[serde(default)]
    pub commands: Commands,
    /// Path prefixes of tests the Worker may not delete or skip.
    #[serde(default)]
    pub protected_tests: Vec<String>,
    #[serde(default)]
    pub test_gen: Option<TestGen>,
    /// Keys: `perf`, `stress`, `data`.
    #[serde(default)]
    pub evidence: BTreeMap<String, EvidenceCmd>,
    #[serde(default)]
    pub sandbox: SandboxPref,
    /// Every mandate needs two approvers when set.
    #[serde(default)]
    pub two_person: bool,
}

fn default_branch() -> String {
    "main".into()
}

impl Project {
    /// Modules a text mentions, by module name.
    pub fn modules_in(&self, text: &str) -> Vec<&Module> {
        self.modules.iter().filter(|m| !m.name.is_empty() && text.contains(&m.name)).collect()
    }
    /// Modules a changed path belongs to.
    pub fn modules_of_path(&self, path: &str) -> Vec<&Module> {
        self.modules.iter().filter(|m| m.paths.iter().any(|p| path.starts_with(p.as_str()))).collect()
    }
}

// ---------------------------------------------------------------- settings

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct StageModel {
    pub endpoint: String,
    pub model: String,
    /// `endpoint|model`, used for a request when the primary fails after retries.
    #[serde(default)]
    pub fallback: Option<String>,
}

/// Context window and prices come from here, never from `/models`. Prices are per million tokens.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct ModelInfo {
    #[serde(default)]
    pub context: u64,
    #[serde(default)]
    pub input_price: f64,
    #[serde(default)]
    pub output_price: f64,
}

/// Fields added in a later version take their default when an older log is read.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Settings {
    pub version: u32,
    pub workers: u32,
    pub previews: u32,
    /// Per task.
    pub budget: f64,
    pub project_day: f64,
    pub project_month: f64,
    pub member_day: u32,
    pub queue_limit: u32,
    /// Review rounds before the task goes to a person.
    pub rounds: u32,
    pub repo_parallel: u32,
    pub idle_minutes: u32,
    /// `fair` or `fifo`.
    pub sched: String,
    pub weights: BTreeMap<String, u32>,
    /// Keys: router, worker, reviewer, tester, env.
    pub stages: BTreeMap<String, StageModel>,
    pub catalog: BTreeMap<String, ModelInfo>,
    /// Minutes a person has, per kind of queue item.
    pub sla: BTreeMap<String, u32>,
    pub notify: BTreeMap<String, bool>,
    pub artifacts_keep_days: u32,
    pub fail_keep_days: u32,
    /// Setup commands a Worker may add to a project's environment plan without a person: a new
    /// command is applied on its own only when it starts with one of these.
    pub env_auto: Vec<String>,
}

pub const STAGES: [&str; 5] = ["router", "worker", "reviewer", "tester", "env"];

impl Default for Settings {
    fn default() -> Self {
        let sla = [("ask", 30), ("mandate", 120), ("risk", 60), ("budget", 60), ("oscillation", 60), ("failed", 60), ("pr", 480)];
        let notify = ["ask", "mandate", "risk", "budget", "oscillation", "failed", "pr"];
        Settings {
            version: 1,
            workers: 6,
            previews: 8,
            budget: 80.0,
            project_day: 600.0,
            project_month: 8000.0,
            member_day: 10,
            queue_limit: 5,
            rounds: 4,
            repo_parallel: 3,
            idle_minutes: 30,
            sched: "fair".into(),
            weights: BTreeMap::new(),
            stages: BTreeMap::new(),
            catalog: BTreeMap::new(),
            sla: sla.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
            notify: notify.iter().map(|k| (k.to_string(), true)).collect(),
            artifacts_keep_days: 30,
            fail_keep_days: 90,
            env_auto: ["npm ci", "npm install", "pnpm install", "yarn install", "pip install -r ", "uv sync", "go mod download", "cargo fetch", "bundle install", "composer install"].iter().map(|s| s.to_string()).collect(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct SettingChange {
    /// Dotted path, for example `stages.worker.model`.
    pub key: String,
    pub from: serde_json::Value,
    pub to: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Endpoint {
    pub id: String,
    pub name: String,
    /// Ends with `/v1` by convention; requests go to `{base}/models`, `{base}/chat/completions`, `{base}/responses`.
    pub base: String,
    /// `chat` (Chat Completions only) or `responses` (also serves the Responses API, which codex needs).
    #[serde(default = "default_api")]
    pub api: String,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub pulled_at: Ms,
    /// Last four characters, for display. The key itself is only in the secret table.
    #[serde(default)]
    pub key_hint: String,
}

fn default_api() -> String {
    "chat".into()
}

// ---------------------------------------------------------------- tickets

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    /// The mandate needs an approver before the Worker starts.
    MandatePending,
    Queued,
    Provisioning,
    Working,
    Checking,
    Reviewing,
    Testing,
    Opening,
    /// The PR is open and waits for a person. Nothing merges by itself.
    PrOpen,
    /// A person has to decide something; `Ticket::ask` says what.
    Blocked,
    /// Not a failure: model unavailable, CI running, engine draining.
    Waiting,
    /// Merged; the rollout phases are in progress.
    RollingOut,
    Failed,
    Done,
    Dropped,
}

impl Stage {
    pub fn is_open(self) -> bool {
        !matches!(self, Stage::Done | Stage::Dropped)
    }
    /// Holds a Worker slot.
    pub fn is_active(self) -> bool {
        matches!(self, Stage::Provisioning | Stage::Working | Stage::Checking | Stage::Reviewing | Stage::Testing | Stage::Opening | Stage::Waiting)
    }
    pub fn kind(self) -> &'static str {
        match self {
            Stage::MandatePending | Stage::Blocked | Stage::PrOpen => "you",
            Stage::Queued | Stage::Waiting | Stage::RollingOut => "wait",
            Stage::Failed => "fail",
            Stage::Done => "done",
            Stage::Dropped => "dropped",
            _ => "run",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Priority {
    High,
    Normal,
    Low,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Mandate {
    pub goal: String,
    #[serde(default)]
    pub scope: Vec<String>,
    #[serde(default)]
    pub not: Vec<String>,
    #[serde(default)]
    pub accept: Vec<String>,
    /// Parallel to `accept`: `func`, `perf`, `stress`, `data`, `soak`, `manual`. Each kind has its own evidence.
    #[serde(default)]
    pub kinds: Vec<String>,
    #[serde(default)]
    pub assume: Vec<String>,
    /// Modules the code index says this text is about (by symbol or file name), on top of those it names.
    #[serde(default)]
    pub modules_hint: Vec<String>,
    /// Steps after the merge, each with a condition for moving on. Empty: the task ends at the merge.
    #[serde(default)]
    pub rollout: Vec<Phase>,
    /// Name of the rule that requires an approver, if any.
    #[serde(default)]
    pub need_confirm: Option<String>,
    #[serde(default)]
    pub open_question: Option<String>,
    #[serde(default)]
    pub confirmed_by: Vec<String>,
    #[serde(default)]
    pub answer: Option<String>,
}

/// One step of a staged rollout. The Engine never touches production: it watches the gate and
/// tells people when the step may move on; a person does the action and says so.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Phase {
    pub name: String,
    /// What a person does to enter this phase (merge a config PR, flip a flag).
    #[serde(default)]
    pub action: String,
    /// Condition for leaving it, in words.
    #[serde(default)]
    pub gate: String,
    /// A read-only URL that answers 2xx (and `"ok": true` if it returns JSON) when the gate holds. Empty: a person judges.
    #[serde(default)]
    pub gate_url: String,
    /// The gate must hold this long before the phase counts as ready.
    #[serde(default)]
    pub hold_minutes: u32,
    /// How to undo this phase.
    #[serde(default)]
    pub back: String,
    /// `todo`, `now`, `ready`, `done`, `rolled_back`.
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub since: Option<Ms>,
    /// Since when the gate has held without interruption.
    #[serde(default)]
    pub holding_since: Option<Ms>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct ArchNode {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub sub: String,
    /// `code`, `store`, `queue` or `external`.
    #[serde(default)]
    pub kind: String,
    /// Path prefixes in the repository that implement this component.
    #[serde(default)]
    pub paths: Vec<String>,
    /// `added` (exists only after the change), `removed` (only before), or empty for both.
    #[serde(default)]
    pub change: String,
}

/// How a task changes the architecture: the components, and who talks to whom before and after.
/// The Worker supplies this structure, never a picture; what was added or removed is derived here.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct ArchDelta {
    #[serde(default)]
    pub summary: String,
    pub nodes: Vec<ArchNode>,
    /// Edges as `[from, to]` or `[from, to, label]`.
    #[serde(default)]
    pub before: Vec<Vec<String>>,
    #[serde(default)]
    pub after: Vec<Vec<String>>,
    /// `proposed`, `verified` (the diff matches it) or `diverged`.
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub divergence: Vec<String>,
}

impl ArchDelta {
    fn in_edges(edges: &[Vec<String>], id: &str) -> bool {
        edges.iter().any(|e| e.iter().take(2).any(|x| x == id))
    }
    /// Components that exist only after the change.
    pub fn added(&self) -> Vec<&ArchNode> {
        self.nodes.iter().filter(|n| n.change == "added").collect()
    }
    pub fn removed(&self) -> Vec<&ArchNode> {
        self.nodes.iter().filter(|n| n.change == "removed").collect()
    }
    pub fn validate(&self) -> Result<(), String> {
        if self.nodes.is_empty() {
            return Err("没有组件".into());
        }
        let mut seen = std::collections::BTreeSet::new();
        for n in &self.nodes {
            if n.id.is_empty() || !seen.insert(n.id.as_str()) {
                return Err(format!("组件编号重复或为空：{}", n.id));
            }
        }
        for e in self.before.iter().chain(self.after.iter()) {
            if e.len() < 2 || e.len() > 3 || !e.iter().take(2).all(|x| seen.contains(x.as_str())) {
                return Err(format!("连线 {e:?} 不合规：要写成 [起点, 终点] 或 [起点, 终点, 说明]，两端都要是已列出的组件"));
            }
        }
        // what a node says about itself must agree with the edges
        for n in &self.nodes {
            if n.change == "added" && Self::in_edges(&self.before, &n.id) {
                return Err(format!("“{}”标为新增，却出现在改动前的连线里", n.name));
            }
            if n.change == "removed" && Self::in_edges(&self.after, &n.id) {
                return Err(format!("“{}”标为移除，却出现在改动后的连线里", n.name));
            }
            if !["", "added", "removed"].contains(&n.change.as_str()) {
                return Err(format!("“{}”的 change 只能是 added、removed 或不写", n.name));
            }
        }
        Ok(())
    }
}

/// Something that went wrong in production in code a merged task touched.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Issue {
    pub at: Ms,
    pub title: String,
    pub file: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub url: String,
    /// The task opened to fix it.
    #[serde(default)]
    pub fix: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    Wait,
    Pass,
    Fail,
}

/// One line of the completion contract. A result only counts for the commit it was produced on.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ContractItem {
    pub key: String,
    pub result: Verdict,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub sha: Option<String>,
}

pub const CONTRACT_KEYS: [&str; 5] = ["checks", "e2e", "review", "tests_kept", "confirmed"];

pub fn new_contract(confirmed: bool) -> Vec<ContractItem> {
    CONTRACT_KEYS
        .iter()
        .map(|k| ContractItem {
            key: k.to_string(),
            result: if *k == "confirmed" && confirmed { Verdict::Pass } else { Verdict::Wait },
            note: String::new(),
            sha: None,
        })
        .collect()
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Finding {
    /// Stable across rounds: hash of file and normalized title.
    pub fingerprint: String,
    /// `p0` to `p3`.
    pub severity: String,
    pub title: String,
    #[serde(default)]
    pub file: String,
    #[serde(default)]
    pub line: u32,
    #[serde(default)]
    pub evidence: String,
    /// Only confirmed P0/P1 block. Confirmation is a second, independent pass.
    #[serde(default)]
    pub confirmed: bool,
    /// `open`, `fixed`, `false_positive`.
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub round: u32,
}

impl Finding {
    pub fn blocks(&self) -> bool {
        self.confirmed && self.status == "open" && (self.severity == "p0" || self.severity == "p1")
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Review {
    pub round: u32,
    #[serde(default)]
    pub findings: Vec<Finding>,
    /// fingerprint -> how many times it came back after being marked fixed.
    #[serde(default)]
    pub returned: BTreeMap<String, u32>,
    /// Hash of the diff the last passing review looked at.
    #[serde(default)]
    pub passed_patch: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct CheckRun {
    pub name: String,
    pub ok: bool,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub sha: String,
    #[serde(default)]
    pub at: Ms,
}

/// A generated test, run on the base commit and on the head commit.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct PrTest {
    /// 1-based index of the acceptance criterion it covers.
    pub criterion: u32,
    pub name: String,
    pub base_pass: bool,
    pub head_pass: bool,
}

/// What was measured for one non-functional acceptance criterion.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Evidence {
    /// 1-based.
    pub criterion: u32,
    pub kind: String,
    pub ok: bool,
    /// Not provable before merge: a person confirms it, or the rollout phases watch it.
    #[serde(default)]
    pub deferred: bool,
    #[serde(default)]
    pub note: String,
    /// One value per run, on the base commit and on the head commit (performance only).
    #[serde(default)]
    pub base: Vec<f64>,
    #[serde(default)]
    pub head: Vec<f64>,
    #[serde(default)]
    pub waived_by: Option<String>,
    #[serde(default)]
    pub sha: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Ask {
    /// `ask` (the Worker has a question), `budget`, `oscillation`, `rounds`, `risk`. Also the kind of the queue item.
    pub kind: String,
    pub text: String,
    #[serde(default)]
    pub options: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Risk {
    /// What the diff does that needs a person: new dependency, CI change, guarded module.
    pub what: String,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub approved_by: Option<String>,
}

/// Something the Worker must take into account on its next run.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Input {
    /// `findings`, `check`, `member`, `pr_comment`, `answer`.
    pub source: String,
    pub text: String,
    /// Only member messages, confirmed mandates and Engine-produced text are instructions.
    /// Anything else is passed to the Worker as data, and marks the session tainted.
    pub trusted: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct PrRef {
    pub number: u64,
    pub url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Overlap {
    pub with: String,
    pub module: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Ticket {
    pub id: String,
    pub title: String,
    pub project: String,
    /// Member id of the requester.
    pub by: String,
    pub via: String,
    pub source_text: String,
    pub stage: Stage,
    /// Where to go back to after `Blocked`, `Waiting` or `Failed`.
    #[serde(default)]
    pub resume: Option<Stage>,
    pub state: String,
    #[serde(default)]
    pub why: String,
    pub created: Ms,
    pub updated: Ms,
    /// Since when a person has been waited on.
    #[serde(default)]
    pub since: Option<Ms>,
    pub priority: Priority,
    #[serde(default)]
    pub depends_on: Option<String>,
    /// The plan this task belongs to, and its 0-based position in it.
    #[serde(default)]
    pub plan: Option<String>,
    #[serde(default)]
    pub plan_task: usize,
    /// Stacked on another task: this task's branch starts from that task's branch until it merges.
    #[serde(default)]
    pub stack_on: Option<String>,
    /// Tasks in other repositories this one depends on. Their code is checked out next to this
    /// task's repository, read-only, at `deps/<project>`.
    #[serde(default)]
    pub siblings: Vec<String>,
    /// The commit of each sibling this task last saw (sibling task id -> sha).
    #[serde(default)]
    pub siblings_sha: BTreeMap<String, String>,
    pub mandate: Mandate,
    pub contract: Vec<ContractItem>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub base_sha: Option<String>,
    #[serde(default)]
    pub head_sha: Option<String>,
    #[serde(default)]
    pub pr: Option<PrRef>,
    #[serde(default)]
    pub sandbox: Option<String>,
    #[serde(default)]
    pub review: Review,
    #[serde(default)]
    pub checks: Vec<CheckRun>,
    #[serde(default)]
    pub pr_tests: Vec<PrTest>,
    #[serde(default)]
    pub evidence: Vec<Evidence>,
    #[serde(default)]
    pub cost: f64,
    /// Added to the per-task budget by an approver.
    #[serde(default)]
    pub budget_extra: f64,
    #[serde(default)]
    pub ask: Option<Ask>,
    #[serde(default)]
    pub risks: Vec<Risk>,
    #[serde(default)]
    pub inputs: Vec<Input>,
    #[serde(default)]
    pub overlap: Option<Overlap>,
    #[serde(default)]
    pub modules: Vec<String>,
    /// A person took the branch over; the Worker does nothing until it is handed back.
    #[serde(default)]
    pub handed: bool,
    /// The session has read untrusted content.
    #[serde(default)]
    pub tainted: bool,
    #[serde(default)]
    pub restarts: u32,
    /// Consecutive failed check rounds.
    #[serde(default)]
    pub check_fails: u32,
    #[serde(default)]
    pub progress: Vec<(String, String)>,
    /// Files the pull request changed, kept to match production issues to tasks.
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default)]
    pub merged_at: Option<Ms>,
    #[serde(default)]
    pub issues: Vec<Issue>,
    #[serde(default)]
    pub arch: Option<ArchDelta>,
}

impl Ticket {
    pub fn contract_ok(&self) -> bool {
        let head = self.head_sha.as_deref();
        self.contract.iter().all(|c| c.result == Verdict::Pass && (c.key == "confirmed" || c.sha.as_deref() == head))
    }
    pub fn verdict(&self, key: &str) -> Option<Verdict> {
        self.contract.iter().find(|c| c.key == key).map(|c| c.result)
    }
    pub fn item(&mut self, key: &str) -> Option<&mut ContractItem> {
        self.contract.iter_mut().find(|c| c.key == key)
    }
}

// ---------------------------------------------------------------- human queue

/// One thing a person has to do. Everyone with the needed role sees it; whoever acts first wins.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct QueueItem {
    /// `<ticket>:<kind>`.
    pub id: String,
    pub ticket: String,
    pub project: String,
    /// `mandate`, `ask`, `risk`, `budget`, `oscillation`, `failed`, `pr`.
    pub kind: String,
    pub title: String,
    pub why: String,
    pub since: Ms,
    pub need: Role,
    /// The requester may act on some kinds (retry a failed task) without the role.
    #[serde(default)]
    pub also: Option<String>,
    /// Handed to one person: only they (and admins) see it.
    #[serde(default)]
    pub hand_to: Option<String>,
    #[serde(default)]
    pub reminded: bool,
    #[serde(default)]
    pub escalated: bool,
}

// ---------------------------------------------------------------- sandboxes

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct SandboxInfo {
    pub id: String,
    pub ticket: String,
    pub project: String,
    pub provider: String,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub template: String,
    /// `running`, `paused`.
    pub state: String,
    pub created: Ms,
    /// Version of the environment plan this sandbox was prepared with.
    #[serde(default)]
    pub env_version: u32,
}

// ---------------------------------------------------------------- routing

/// What the Router saw and what it decided. The input is complete, so any record can be replayed
/// with another model or prompt and compared field by field.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct RouteRecord {
    pub id: String,
    pub at: Ms,
    pub input: RouteInput,
    pub output: RouteOutput,
    #[serde(default)]
    pub ticket: Option<String>,
    #[serde(default)]
    pub wrong: bool,
    #[serde(default)]
    pub moved: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct RouteInput {
    pub text: String,
    /// Member id, or the raw sender name for a visitor.
    pub sender: String,
    pub sender_role: Option<Role>,
    pub channel: String,
    /// Project bound to the channel, if any.
    #[serde(default)]
    pub bound_project: Option<String>,
    #[serde(default)]
    pub thread: String,
    #[serde(default)]
    pub thread_summary: String,
    #[serde(default)]
    pub recent: Vec<(String, String)>,
    #[serde(default)]
    pub open_tickets: Vec<(String, String)>,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub prompt_version: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct RouteOutput {
    /// `answer`, `new_ticket`, `route_to_ticket`, `ask`, `stop_ticket`.
    pub decision: String,
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default)]
    pub ticket: Option<String>,
    /// `high`, `medium`, `low`.
    #[serde(default)]
    pub confidence: String,
    #[serde(default)]
    pub reply: String,
    #[serde(default)]
    pub why: String,
    #[serde(default)]
    pub mandate: Option<Mandate>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Thread {
    pub id: String,
    #[serde(default)]
    pub summary: String,
    /// Last turns, oldest first: (who, text).
    #[serde(default)]
    pub recent: Vec<(String, String)>,
}

// ---------------------------------------------------------------- project memory

/// Something learned on one task that should hold for the next ones. Only an approver's
/// acceptance turns a proposal into memory; accepted memory is given to the Worker as instruction.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Memory {
    pub id: String,
    pub project: String,
    pub text: String,
    /// Ticket it came from.
    pub from: String,
    pub by: String,
    pub at: Ms,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct MemoryProposal {
    pub id: String,
    pub project: String,
    pub text: String,
    pub why: String,
    pub from: String,
    pub at: Ms,
}

// ---------------------------------------------------------------- plans

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct PlanTask {
    pub title: String,
    #[serde(default)]
    pub goal: String,
    /// 1-based positions of the tasks that must merge first. Only earlier tasks, so the graph cannot loop.
    #[serde(default)]
    pub deps: Vec<usize>,
    /// 1-based acceptance criteria of the plan this task is responsible for.
    #[serde(default)]
    pub covers: Vec<u32>,
    /// May start as soon as its dependencies have an open pull request, on top of their branch.
    #[serde(default)]
    pub stacked: bool,
    /// Estimated cost.
    #[serde(default)]
    pub est: f64,
    /// The repository (project) this task changes, when it is not the plan's own. A plan that
    /// spans repositories makes one pull request per repository: a pull-request group.
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default)]
    pub ticket: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct PlanChange {
    pub why: String,
    pub tasks: Vec<PlanTask>,
    /// The task whose Worker proposed it.
    pub from: String,
    pub at: Ms,
}

/// A requirement too large for one pull request: tasks with dependencies, confirmed once.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Plan {
    pub id: String,
    pub project: String,
    pub by: String,
    pub goal: String,
    pub accept: Vec<String>,
    pub tasks: Vec<PlanTask>,
    pub version: u32,
    /// `open` (waiting for an approver), `confirmed`, `done`, `dropped`.
    pub status: String,
    #[serde(default)]
    pub confirmed_by: Option<String>,
    #[serde(default)]
    pub change: Option<PlanChange>,
    pub created: Ms,
}

impl Plan {
    /// The whole plan may cost the sum of its estimates plus a fifth.
    pub fn budget(&self) -> f64 {
        self.tasks.iter().map(|t| t.est).sum::<f64>() * 1.2
    }
}

/// A plan is valid when every dependency points at an earlier task and every acceptance
/// criterion is some task's responsibility.
impl Plan {
    /// Every project a task of this plan touches, the plan's own first.
    pub fn projects(&self) -> Vec<String> {
        let mut out = vec![self.project.clone()];
        for t in &self.tasks {
            if let Some(p) = &t.project {
                if !out.contains(p) {
                    out.push(p.clone());
                }
            }
        }
        out
    }
    pub fn project_of(&self, task: &PlanTask) -> String {
        task.project.clone().unwrap_or_else(|| self.project.clone())
    }
}

pub fn validate_plan(accept: usize, tasks: &[PlanTask]) -> Result<(), String> {
    if tasks.len() < 2 {
        return Err("计划至少要有 2 个任务；只有一个就直接开任务".into());
    }
    for (i, t) in tasks.iter().enumerate() {
        if t.title.trim().is_empty() {
            return Err(format!("任务 {} 没有标题", i + 1));
        }
        if let Some(d) = t.deps.iter().find(|d| **d == 0 || **d > i) {
            return Err(format!("任务 {} 依赖了任务 {d}：只能依赖排在它前面的任务", i + 1));
        }
        if let Some(c) = t.covers.iter().find(|c| **c == 0 || **c as usize > accept) {
            return Err(format!("任务 {} 覆盖的验收标准 {c} 不存在", i + 1));
        }
    }
    let missing: Vec<String> = (1..=accept as u32).filter(|n| !tasks.iter().any(|t| t.covers.contains(n))).map(|n| n.to_string()).collect();
    if !missing.is_empty() {
        return Err(format!("验收标准 {} 没有任务覆盖", missing.join("、")));
    }
    Ok(())
}

// ---------------------------------------------------------------- code index

/// What the Engine knows about a project's code index. The index itself is a file outside the log.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct IndexInfo {
    pub project: String,
    pub commit: String,
    pub built: Ms,
    pub files: u32,
    pub symbols: u32,
    pub access: u32,
}

// ---------------------------------------------------------------- environment plan

/// A long-running process the project's commands need (a database, a cache, a stub server).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Service {
    pub name: String,
    /// Started in the background, in the repository directory.
    pub start: String,
    /// Exit code 0 means it is up. Polled once a second.
    pub health: String,
    /// How long to wait for `health` before giving up. 0 means 60.
    #[serde(default)]
    pub wait_s: u32,
}

/// How a sandbox of a project is prepared. Versioned: every change makes a new version and the
/// old ones are kept, so a bad change can be rolled back and a sandbox says which version built it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct EnvPlan {
    #[serde(default)]
    pub project: String,
    /// 0: nothing has been set, the project's `commands.setup` is used as is.
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub setup: Vec<String>,
    #[serde(default)]
    pub services: Vec<Service>,
    /// Environment variables for every command in the sandbox. Never credentials.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub by: String,
    #[serde(default)]
    pub at: Ms,
    #[serde(default)]
    pub note: String,
}

impl EnvPlan {
    pub fn validate(&self) -> Result<(), String> {
        if self.setup.iter().any(|c| c.trim().is_empty()) {
            return Err("环境准备命令不能是空的".into());
        }
        let mut names = BTreeSet::new();
        for s in &self.services {
            if s.name.is_empty() || !s.name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                return Err(format!("服务名“{}”只能用字母、数字、- 和 _", s.name));
            }
            if s.start.trim().is_empty() || s.health.trim().is_empty() {
                return Err(format!("服务 {} 要有启动命令和健康检查命令", s.name));
            }
            if !names.insert(&s.name) {
                return Err(format!("服务 {} 重复了", s.name));
            }
        }
        for (k, v) in &self.env {
            if k.is_empty() || !k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') || k.chars().next().is_some_and(|c| c.is_ascii_digit()) {
                return Err(format!("环境变量名“{k}”不合规"));
            }
            let lk = k.to_ascii_lowercase();
            if ["token", "secret", "password", "passwd", "api_key", "apikey", "credential"].iter().any(|w| lk.contains(w)) && !v.is_empty() {
                return Err(format!("环境变量 {k} 看起来是凭据。沙箱里不放凭据：模型走网关，代码走 git 网关"));
            }
        }
        Ok(())
    }

    /// What changes from `self` to `new`, in words.
    pub fn diff(&self, new: &EnvPlan) -> Vec<String> {
        let mut out = Vec::new();
        for c in new.setup.iter().filter(|c| !self.setup.contains(c)) {
            out.push(format!("加准备命令：{c}"));
        }
        for c in self.setup.iter().filter(|c| !new.setup.contains(c)) {
            out.push(format!("去掉准备命令：{c}"));
        }
        if out.is_empty() && self.setup != new.setup {
            out.push("调整准备命令的顺序".into());
        }
        for s in &new.services {
            match self.services.iter().find(|o| o.name == s.name) {
                None => out.push(format!("加服务 {}：{}", s.name, s.start)),
                Some(o) if o != s => out.push(format!("改服务 {}：{}", s.name, s.start)),
                _ => {}
            }
        }
        for s in self.services.iter().filter(|o| !new.services.iter().any(|s| s.name == o.name)) {
            out.push(format!("去掉服务 {}", s.name));
        }
        for (k, v) in &new.env {
            if self.env.get(k) != Some(v) {
                out.push(format!("环境变量 {k}={v}"));
            }
        }
        for k in self.env.keys().filter(|k| !new.env.contains_key(*k)) {
            out.push(format!("去掉环境变量 {k}"));
        }
        out
    }

    /// Why a change from `self` to `new` needs an approver, or None when it may be applied as is:
    /// only setup commands were added, and each starts with a prefix from the settings.
    pub fn needs_person(&self, new: &EnvPlan, auto: &[String]) -> Option<String> {
        if self.services != new.services {
            return Some("改了服务".into());
        }
        if self.env != new.env {
            return Some("改了环境变量".into());
        }
        if self.setup.iter().any(|c| !new.setup.contains(c)) {
            return Some("去掉了已有的准备命令".into());
        }
        let kept: Vec<&String> = new.setup.iter().filter(|c| self.setup.contains(c)).collect();
        if kept != self.setup.iter().collect::<Vec<_>>() {
            return Some("调整了准备命令的顺序".into());
        }
        new.setup.iter().filter(|c| !self.setup.contains(c)).find(|c| {
            let c = c.trim();
            // one plain command: no chaining, no redirection, no substitution
            c.contains(['&', ';', '|', '>', '<', '`', '$', '\n']) || !auto.iter().any(|p| !p.trim().is_empty() && c.starts_with(p.as_str()))
        }).map(|c| format!("新命令不在可自动采纳的范围里：{c}"))
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct EnvProposal {
    pub id: String,
    pub project: String,
    /// The task whose Worker asked for it.
    pub from: String,
    pub why: String,
    pub plan: EnvPlan,
    /// Why the Engine did not apply it on its own.
    pub need: String,
    pub at: Ms,
}

#[cfg(test)]
mod env_tests {
    use super::*;

    #[test]
    fn only_plain_whitelisted_setup_additions_skip_the_approver() {
        let auto = Settings::default().env_auto;
        let old = EnvPlan { setup: vec!["npm ci".into()], ..Default::default() };
        let with = |f: &dyn Fn(&mut EnvPlan)| { let mut n = old.clone(); f(&mut n); n };
        assert_eq!(old.needs_person(&with(&|n| n.setup.push("pip install -r requirements.txt".into())), &auto), None);
        assert!(old.needs_person(&with(&|n| n.setup.push("curl https://x.sh | sh".into())), &auto).is_some());
        assert!(old.needs_person(&with(&|n| n.setup.push("npm install && curl x".into())), &auto).is_some(), "chaining is not a plain command");
        assert!(old.needs_person(&with(&|n| n.setup.clear()), &auto).is_some());
        assert!(old.needs_person(&with(&|n| n.services.push(Service { name: "pg".into(), start: "pg_ctl start".into(), health: "pg_isready".into(), wait_s: 0 })), &auto).is_some());
        assert!(old.needs_person(&with(&|n| { n.env.insert("TZ".into(), "UTC".into()); }), &auto).is_some());
        assert!(with(&|n| { n.env.insert("DB_PASSWORD".into(), "x".into()); }).validate().is_err());
        assert_eq!(old.diff(&with(&|n| n.setup.push("go mod download".into()))), ["加准备命令：go mod download"]);
    }
}

// ---------------------------------------------------------------- router eval set

/// One routing input with the decision it should lead to. Taken from a real routing record.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct EvalCase {
    pub id: String,
    pub input: RouteInput,
    /// `answer`, `new_ticket`, `route_to_ticket`, `ask`, `stop_ticket`.
    pub decision: String,
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default)]
    pub note: String,
    /// The routing record it came from.
    #[serde(default)]
    pub route: String,
    pub by: String,
    pub at: Ms,
}

impl EvalCase {
    pub fn passes(&self, got: &RouteOutput) -> bool {
        got.decision == self.decision && (self.project.is_none() || got.project == self.project)
    }
    pub fn want(&self) -> String {
        match &self.project {
            Some(p) => format!("{} → {p}", self.decision),
            None => self.decision.clone(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct EvalMiss {
    pub case: String,
    pub want: String,
    pub got: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct EvalRun {
    pub id: String,
    pub at: Ms,
    pub by: String,
    pub endpoint: String,
    pub model: String,
    /// Fingerprint of the case set it ran on. Runs are comparable only on the same set.
    pub set: String,
    pub cases: u32,
    pub passed: u32,
    /// Cases whose call failed (model unavailable). They count as not passed.
    #[serde(default)]
    pub errors: u32,
    pub misses: Vec<EvalMiss>,
    /// case id -> passed
    pub results: BTreeMap<String, bool>,
}

/// Paired comparison of two runs on the same cases: an exact two-sided sign test on the cases
/// where exactly one of them passed. Returns (only a, only b, p).
pub fn paired(a: &EvalRun, b: &EvalRun) -> (u32, u32, f64) {
    let (mut only_a, mut only_b) = (0u32, 0u32);
    for (case, pa) in &a.results {
        match (pa, b.results.get(case)) {
            (true, Some(false)) => only_a += 1,
            (false, Some(true)) => only_b += 1,
            _ => {}
        }
    }
    let n = only_a + only_b;
    if n == 0 {
        return (0, 0, 1.0);
    }
    // P(X <= min) * 2 under Binomial(n, 1/2), capped at 1
    let k = only_a.min(only_b);
    let mut c = 1.0f64; // C(n, 0)
    let mut tail = 0.0f64;
    for i in 0..=k {
        if i > 0 {
            c = c * (n - i + 1) as f64 / i as f64;
        }
        tail += c;
    }
    (only_a, only_b, (2.0 * tail / 2f64.powi(n as i32)).min(1.0))
}

#[cfg(test)]
mod eval_tests {
    use super::*;

    #[test]
    fn the_sign_test_counts_only_the_cases_that_differ() {
        let run = |bits: &[bool]| EvalRun { results: bits.iter().enumerate().map(|(i, b)| (format!("c{i}"), *b)).collect(), ..Default::default() };
        let a = run(&[true, true, true, true, true, true, false, true]);
        let b = run(&[false, false, false, false, false, false, true, true]);
        let (oa, ob, p) = paired(&a, &b);
        assert_eq!((oa, ob), (6, 1));
        assert!((p - 0.125).abs() < 1e-9, "{p}"); // 2 * (C(7,0)+C(7,1)) / 2^7
        assert_eq!(paired(&a, &a), (0, 0, 1.0));
    }
}
