//! Auto-CodWorker core: the domain model, the event log and its projections.

pub mod event;
pub mod model;
pub mod projection;
pub mod scan;
pub mod store;

pub use event::{Effect, Event, StoredEvent};
pub use model::*;
pub use store::{RawEvent, ReadOnly, Store, Tx, View};

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn ticket(id: &str) -> Ticket {
        Ticket {
            id: id.into(), title: "t".into(), project: "p".into(), by: "kai".into(), via: "console".into(), source_text: "s".into(),
            stage: Stage::Queued, resume: None, state: "排队中".into(), why: String::new(), created: 1, updated: 1, since: None,
            priority: Priority::Normal, depends_on: None, plan: None, plan_task: 0, stack_on: None, siblings: vec![], siblings_sha: Default::default(), mandate: Mandate { goal: "g".into(), ..Default::default() },
            contract: new_contract(true), branch: None, base_sha: None, head_sha: None, pr: None, sandbox: None,
            review: Review::default(), checks: vec![], pr_tests: vec![], evidence: vec![], cost: 0.0, budget_extra: 0.0, ask: None, risks: vec![],
            inputs: vec![], overlap: None, modules: vec![], handed: false, tainted: false, restarts: 0, check_fails: 0, progress: vec![], files: vec![], merged_at: None, issues: vec![], arch: None,
        }
    }

    fn finding(fp: &str) -> Finding {
        Finding { fingerprint: fp.into(), severity: "p1".into(), title: "x".into(), confirmed: true, status: "open".into(), ..Default::default() }
    }

    #[test]
    fn roles_are_per_project_with_a_global_default() {
        let m = Member { id: "lin".into(), name: "林舟".into(), feishu: None, github: None,
            roles: BTreeMap::from([("*".into(), Role::Requester), ("orca".into(), Role::Approver)]), queue_limit: None, delegate: None };
        assert!(can(Some(&m), Role::Approver, Some("orca")));
        assert!(!can(Some(&m), Role::Approver, Some("dub")));
        assert!(can(Some(&m), Role::Requester, None));
        assert!(!can(None, Role::Requester, None), "an unregistered sender is a visitor");
    }

    #[test]
    fn a_plan_must_cover_every_criterion_and_cannot_loop() {
        let task = |deps: &[usize], covers: &[u32]| PlanTask { title: "t".into(), deps: deps.to_vec(), covers: covers.to_vec(), ..Default::default() };
        assert!(validate_plan(2, &[task(&[], &[1]), task(&[1], &[2])]).is_ok());
        assert!(validate_plan(2, &[task(&[], &[1]), task(&[1], &[])]).unwrap_err().contains("验收标准 2"));
        assert!(validate_plan(1, &[task(&[2], &[1]), task(&[], &[])]).unwrap_err().contains("前面的任务"));
        assert!(validate_plan(1, &[task(&[], &[1])]).is_err(), "one task is not a plan");
        assert!(validate_plan(1, &[task(&[], &[1]), task(&[], &[3])]).unwrap_err().contains("不存在"));
    }

    #[test]
    fn a_failed_command_writes_nothing() {
        let s = Store::memory().unwrap();
        let r: anyhow::Result<()> = s.write(|tx| {
            tx.emit("kai", Some("T-1"), Event::TicketCreated { ticket: Box::new(ticket("T-1")) })?;
            anyhow::bail!("validation failed after emitting")
        });
        assert!(r.is_err());
        assert!(s.read(|v| v.ticket("T-1")).unwrap().is_none());
        assert_eq!(s.read(|v| v.last_seq()).unwrap(), 0);
    }

    #[test]
    fn a_new_commit_invalidates_results_from_older_commits() {
        let s = Store::memory().unwrap();
        s.write(|tx| {
            tx.emit("kai", Some("T-1"), Event::TicketCreated { ticket: Box::new(ticket("T-1")) })?;
            tx.emit("worker", Some("T-1"), Event::HeadMoved { sha: "aaa".into(), pushed: true, commits: 1 })?;
            for k in ["checks", "e2e", "review", "tests_kept"] {
                tx.emit("engine", Some("T-1"), Event::ContractSet { key: k.into(), result: Verdict::Pass, note: String::new(), sha: Some("aaa".into()) })?;
            }
            Ok(())
        }).unwrap();
        assert!(s.read(|v| v.ticket("T-1")).unwrap().unwrap().contract_ok());
        s.write(|tx| tx.emit("worker", Some("T-1"), Event::HeadMoved { sha: "bbb".into(), pushed: true, commits: 1 })).unwrap();
        let mut t = s.read(|v| v.ticket("T-1")).unwrap().unwrap();
        assert!(!t.contract_ok());
        assert_eq!(t.contract.iter().filter(|c| c.result == Verdict::Wait).count(), 4);
        assert_eq!(t.item("confirmed").unwrap().result, Verdict::Pass, "human confirmation does not depend on the commit");
    }

    #[test]
    fn a_finding_that_returns_after_being_fixed_is_counted() {
        let s = Store::memory().unwrap();
        s.write(|tx| {
            tx.emit("kai", Some("T-1"), Event::TicketCreated { ticket: Box::new(ticket("T-1")) })?;
            tx.emit("reviewer", Some("T-1"), Event::ReviewFinished { round: 1, findings: vec![finding("f1")] })?;
            tx.emit("reviewer", Some("T-1"), Event::ReviewFinished { round: 2, findings: vec![] })?;
            tx.emit("reviewer", Some("T-1"), Event::ReviewFinished { round: 3, findings: vec![finding("f1")] })?;
            tx.emit("reviewer", Some("T-1"), Event::ReviewFinished { round: 4, findings: vec![] })?;
            tx.emit("reviewer", Some("T-1"), Event::ReviewFinished { round: 5, findings: vec![finding("f1")] })?;
            Ok(())
        }).unwrap();
        let t = s.read(|v| v.ticket("T-1")).unwrap().unwrap();
        assert_eq!(t.review.returned.get("f1"), Some(&2));
        assert!(t.review.findings[0].blocks());
    }

    #[test]
    fn rebuild_reproduces_every_projection_and_replays_no_side_effect() {
        let s = Store::memory().unwrap();
        s.write(|tx| {
            tx.emit("engine", None, Event::SettingsChanged { changes: vec![], note: "init".into(), snapshot: Settings::default() })?;
            tx.emit("kai", Some("T-1"), Event::TicketCreated { ticket: Box::new(ticket("T-1")) })?;
            tx.emit("engine", Some("T-1"), Event::StageChanged { stage: Stage::Blocked, state: "等你回答".into(), why: String::new(), resume: Some(Stage::Working) })?;
            tx.emit("engine", Some("T-1"), Event::QueueOpened { item: QueueItem { id: "T-1:ask".into(), ticket: "T-1".into(), project: "p".into(), kind: "ask".into(),
                title: "t".into(), why: String::new(), since: tx.now(), need: Role::Approver, also: None, hand_to: None, reminded: false, escalated: false } })?;
            tx.emit("worker", Some("T-1"), Event::CostIncurred { stage: "worker".into(), endpoint: "e".into(), model: "m".into(), input: 1000, output: 200, amount: 1.5, priced: true })?;
            tx.effect(Effect::Notify { kind: "ask".into(), to: vec!["kai".into()], text: "x".into(), link: String::new() })?;
            Ok(())
        }).unwrap();
        let before = s.read(|v| v.snapshot()).unwrap();
        let cost_before = s.read(|v| v.cost_sum(Some("p"), 0)).unwrap();
        assert_eq!(s.due_effects(10).unwrap().len(), 1);
        let n = s.rebuild().unwrap();
        assert_eq!(n, 5);
        assert_eq!(s.read(|v| v.snapshot()).unwrap(), before);
        assert_eq!(s.read(|v| v.cost_sum(Some("p"), 0)).unwrap(), cost_before);
        assert_eq!(s.due_effects(10).unwrap().len(), 1, "rebuild must not enqueue effects again");
        let t = s.read(|v| v.ticket("T-1")).unwrap().unwrap();
        assert_eq!((t.cost, t.stage.kind()), (1.5, "you"));
    }

    #[test]
    fn subscribers_see_events_only_after_commit() {
        let s = Store::memory().unwrap();
        let mut rx = s.subscribe();
        s.write(|tx| tx.emit("engine", None, Event::DrainSet { on: true })).unwrap();
        let e = rx.try_recv().unwrap();
        assert_eq!((e.seq, e.event.kind().as_str()), (1, "drain_set"));
        assert!(s.read(|v| v.draining()).unwrap());
    }
}
