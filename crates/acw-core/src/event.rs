//! The event log is the only source of truth. Events carry facts, never code:
//! diffs, full command output and artifacts live outside the log.

use crate::model::*;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
// Events are written once and read rarely; boxing the large variants would only add noise.
#[allow(clippy::large_enum_variant)]
pub enum Event {
    // ---- configuration
    MemberUpserted { member: Member },
    MemberRemoved { id: String },
    ProjectUpserted { project: Project },
    SettingsChanged { changes: Vec<SettingChange>, note: String, snapshot: Settings },
    EndpointUpserted { endpoint: Endpoint },
    EndpointRemoved { id: String },
    DrainSet { on: bool },

    // ---- routing
    MessageRouted { route: RouteRecord },
    RouteFeedback { id: String, wrong: bool },
    ThreadUpdated { thread: Thread },

    // ---- ticket lifecycle
    TicketCreated { ticket: Box<Ticket> },
    TicketMoved { project: String },
    MandateUpdated { mandate: Mandate },
    MandateConfirmed { by: String, answer: Option<String>, complete: bool },
    StageChanged { stage: Stage, state: String, why: String, resume: Option<Stage> },
    PriorityChanged { priority: Priority },
    /// Start only after another task has merged.
    DependencySet { on: Option<String> },
    InputQueued { input: Input },
    InputsConsumed { n: usize },
    BranchSet { branch: String, base_sha: String },
    /// The task branch moved. Every contract result produced on an older commit stops counting.
    HeadMoved { sha: String, pushed: bool, commits: u32 },
    WorkerStep { kind: String, what: String, detail: String },
    WorkerRestarted { reason: String, n: u32 },
    ProgressUpdated { items: Vec<(String, String)> },
    CheckFinished { run: CheckRun },
    ContractSet { key: String, result: Verdict, note: String, sha: Option<String> },
    ReviewFinished { round: u32, findings: Vec<Finding> },
    /// The review passed for a diff with this hash. The same diff on another base needs no second review.
    ReviewPassed { patch: String },
    FindingMarked { fingerprint: String, status: String },
    PrTestsFinished { tests: Vec<PrTest> },
    EvidenceRecorded { evidence: Vec<Evidence> },
    /// An approver accepts a criterion without automated evidence.
    EvidenceWaived { criteria: Vec<u32>, by: String },
    RisksFlagged { risks: Vec<Risk> },
    RisksApproved { by: String },
    AskRaised { ask: Ask },
    AskAnswered { by: String, answer: String },
    BudgetRaised { by: String, extra: f64 },
    CostIncurred { stage: String, endpoint: String, model: String, input: u64, output: u64, amount: f64, priced: bool },
    PrOpened { pr: PrRef },
    ArchDeltaProposed { delta: ArchDelta },
    /// The Engine compared the delta with the diff. Empty divergence: verified.
    ArchDeltaChecked { divergence: Vec<String> },
    FilesChanged { files: Vec<String> },
    PrMerged { by: String },
    /// `state` is the phase's new state: `now`, `ready`, `done`, `rolled_back`, or `holding` / `not_holding` for the gate.
    RolloutPhase { index: usize, state: String, by: String, note: String },
    IssueReported { issue: Issue },
    IssueLinked { index: usize, fix: String },
    PrChangesRequested { by: String, member: bool },
    TicketStopped { by: String, reason: String },
    HandedOver { by: String },
    HandedBack { by: String },
    OverlapFound { overlap: Overlap },

    // ---- human queue
    QueueOpened { item: QueueItem },
    QueueClosed { id: String, how: String },
    QueueReminded { id: String, to: Vec<String> },
    QueueEscalated { id: String, to: Vec<String> },
    QueueHanded { id: String, to: String },

    // ---- sandboxes
    SandboxCreated { sandbox: SandboxInfo },
    SandboxStateChanged { id: String, state: String },
    SandboxDestroyed { id: String },

    /// A standby took over as the primary. Everything before this was written under an older epoch.
    Promoted { epoch: u64, by: String },

    /// A chat platform delivered this event id; a redelivery of the same id is ignored.
    InboundSeen { source: String, id: String },

    // ---- router eval set
    EvalCaseSaved { case: EvalCase },
    EvalCaseRemoved { id: String },
    EvalRan { run: EvalRun },

    // ---- environment plans
    EnvPlanSet { plan: EnvPlan },
    /// Which version of the plan a sandbox was prepared with.
    SandboxEnv { id: String, version: u32 },
    EnvChangeProposed { proposal: EnvProposal },
    EnvChangeDecided { id: String, accepted: bool, by: String, reason: String },

    // ---- code index
    IndexBuilt { info: IndexInfo },
    /// How well the modules predicted at creation matched the modules the pull request touched.
    ModulesScored { predicted: Vec<String>, actual: Vec<String> },

    // ---- plans
    PlanCreated { plan: Plan },
    PlanConfirmed { id: String, by: String },
    PlanTaskStarted {
        plan: String,
        index: usize,
        stack_on: Option<String>,
        #[serde(default)]
        siblings: Vec<String>,
    },
    /// The commits of the sibling repositories a task was last given.
    SiblingsPinned { shas: std::collections::BTreeMap<String, String> },
    PlanChangeProposed { id: String, change: PlanChange },
    PlanChanged { id: String, by: String, tasks: Vec<PlanTask> },
    PlanChangeRejected { id: String, by: String, reason: String },
    PlanClosed { id: String, status: String },

    // ---- project memory
    MemoryProposed { proposal: MemoryProposal },
    MemoryAccepted { proposal: String, memory: Memory },
    MemoryRejected { proposal: String, by: String, reason: String },
    MemoryRemoved { id: String },

    // ---- operations
    AlertRaised { key: String, text: String },
    AlertCleared { key: String },

    // ---- logs with no projection of their own
    Notified { kind: String, to: String, text: String, sent: bool },
    SecurityLogged { kind: String, who: String, what: String, result: String },
}

impl Event {
    /// The serde tag, stored in its own column so logs can be read by kind.
    pub fn kind(&self) -> String {
        serde_json::to_value(self)
            .ok()
            .and_then(|v| v.get("type").and_then(|t| t.as_str()).map(str::to_owned))
            .unwrap_or_default()
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct StoredEvent {
    pub seq: i64,
    pub ts: Ms,
    pub ticket: Option<String>,
    /// Member id, or a system actor: `engine`, `router`, `worker`, `reviewer`, `tester`, `github`.
    pub actor: String,
    #[serde(flatten)]
    pub event: Event,
}

/// A side effect, written in the same transaction as the events that cause it and executed
/// after commit. Delivery is at-least-once; rebuilding projections never replays these.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Effect {
    Notify { kind: String, to: Vec<String>, text: String, link: String },
    DestroySandbox { id: String },
}
