//! Projections: the read side, derived from events and nothing else.
//! `apply` runs inside the transaction that appends the event, and again on rebuild.

use crate::event::{Event, StoredEvent};
use crate::model::*;
use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};
use std::collections::BTreeSet;

pub fn get_doc<T: DeserializeOwned>(c: &Connection, kind: &str, id: &str) -> Result<Option<T>> {
    let body: Option<String> = c
        .query_row("SELECT body FROM doc WHERE kind=?1 AND id=?2", params![kind, id], |r| r.get(0))
        .optional()?;
    Ok(match body {
        Some(b) => Some(serde_json::from_str(&b)?),
        None => None,
    })
}

pub fn put_doc<T: Serialize>(c: &Connection, kind: &str, id: &str, v: &T) -> Result<()> {
    c.execute(
        "INSERT INTO doc(kind,id,body) VALUES(?1,?2,?3) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body",
        params![kind, id, serde_json::to_string(v)?],
    )?;
    Ok(())
}

pub fn del_doc(c: &Connection, kind: &str, id: &str) -> Result<()> {
    c.execute("DELETE FROM doc WHERE kind=?1 AND id=?2", params![kind, id])?;
    Ok(())
}

pub fn list_docs<T: DeserializeOwned>(c: &Connection, kind: &str) -> Result<Vec<T>> {
    let mut st = c.prepare("SELECT body FROM doc WHERE kind=?1 ORDER BY id")?;
    let rows = st.query_map(params![kind], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for b in rows {
        out.push(serde_json::from_str(&b?)?);
    }
    Ok(out)
}

fn with_ticket(c: &Connection, id: Option<&str>, ts: Ms, f: impl FnOnce(&mut Ticket)) -> Result<()> {
    let Some(id) = id else { return Ok(()) };
    if let Some(mut t) = get_doc::<Ticket>(c, "ticket", id)? {
        f(&mut t);
        t.updated = ts;
        put_doc(c, "ticket", id, &t)?;
    }
    Ok(())
}

fn with_plan(c: &Connection, id: &str, f: impl FnOnce(&mut Plan)) -> Result<()> {
    if let Some(mut p) = get_doc::<Plan>(c, "plan", id)? {
        f(&mut p);
        put_doc(c, "plan", id, &p)?;
    }
    Ok(())
}

fn with_queue(c: &Connection, id: &str, f: impl FnOnce(&mut QueueItem)) -> Result<()> {
    if let Some(mut q) = get_doc::<QueueItem>(c, "queue", id)? {
        f(&mut q);
        put_doc(c, "queue", id, &q)?;
    }
    Ok(())
}

pub fn apply(c: &Connection, e: &StoredEvent) -> Result<()> {
    let tid = e.ticket.as_deref();
    let ts = e.ts;
    match &e.event {
        Event::MemberUpserted { member } => put_doc(c, "member", &member.id, member)?,
        Event::MemberRemoved { id } => del_doc(c, "member", id)?,
        Event::ProjectUpserted { project } => put_doc(c, "project", &project.id, project)?,
        Event::SettingsChanged { snapshot, .. } => put_doc(c, "settings", "current", snapshot)?,
        Event::EndpointUpserted { endpoint } => put_doc(c, "endpoint", &endpoint.id, endpoint)?,
        Event::EndpointRemoved { id } => del_doc(c, "endpoint", id)?,
        Event::DrainSet { on } => put_doc(c, "ops", "drain", on)?,

        Event::MessageRouted { route } => put_doc(c, "route", &route.id, route)?,
        Event::RouteFeedback { id, wrong } => {
            if let Some(mut r) = get_doc::<RouteRecord>(c, "route", id)? {
                r.wrong = *wrong;
                put_doc(c, "route", id, &r)?;
            }
        }
        Event::ThreadUpdated { thread } => put_doc(c, "thread", &thread.id, thread)?,

        Event::TicketCreated { ticket } => put_doc(c, "ticket", &ticket.id, ticket.as_ref())?,
        Event::TicketMoved { project } => {
            with_ticket(c, tid, ts, |t| t.project = project.clone())?;
            if let Some(id) = tid {
                for mut r in list_docs::<RouteRecord>(c, "route")? {
                    if r.ticket.as_deref() == Some(id) {
                        r.moved = true;
                        r.output.project = Some(project.clone());
                        put_doc(c, "route", &r.id.clone(), &r)?;
                    }
                }
            }
        }
        Event::MandateUpdated { mandate } => with_ticket(c, tid, ts, |t| t.mandate = mandate.clone())?,
        Event::MandateConfirmed { by, answer, complete } => with_ticket(c, tid, ts, |t| {
            if !t.mandate.confirmed_by.contains(by) {
                t.mandate.confirmed_by.push(by.clone());
            }
            if answer.is_some() {
                t.mandate.answer = answer.clone();
            }
            if *complete {
                t.mandate.open_question = None;
            }
        })?,
        Event::StageChanged { stage, state, why, resume } => with_ticket(c, tid, ts, |t| {
            let waits_on_person = |s: Stage| s.kind() == "you" || s == Stage::Failed;
            if waits_on_person(*stage) {
                if !waits_on_person(t.stage) || t.since.is_none() {
                    t.since = Some(ts);
                }
            } else {
                t.since = None;
            }
            if t.stage == Stage::Failed && *stage == Stage::Queued {
                t.check_fails = 0;
                t.restarts = 0;
            }
            t.stage = *stage;
            t.state = state.clone();
            t.why = why.clone();
            t.resume = *resume;
        })?,
        Event::PriorityChanged { priority } => with_ticket(c, tid, ts, |t| t.priority = *priority)?,
        Event::DependencySet { on } => with_ticket(c, tid, ts, |t| t.depends_on = on.clone())?,
        Event::InputQueued { input } => with_ticket(c, tid, ts, |t| {
            if !input.trusted {
                t.tainted = true;
            }
            t.inputs.push(input.clone());
        })?,
        Event::InputsConsumed { n } => with_ticket(c, tid, ts, |t| {
            let n = (*n).min(t.inputs.len());
            t.inputs.drain(..n);
        })?,
        Event::BranchSet { branch, base_sha } => with_ticket(c, tid, ts, |t| {
            t.branch = Some(branch.clone());
            t.base_sha = Some(base_sha.clone());
        })?,
        Event::HeadMoved { sha, .. } => with_ticket(c, tid, ts, |t| {
            if t.head_sha.as_deref() != Some(sha.as_str()) {
                t.head_sha = Some(sha.clone());
                for item in t.contract.iter_mut().filter(|i| i.key != "confirmed") {
                    if item.sha.as_deref() != Some(sha.as_str()) {
                        item.result = Verdict::Wait;
                        item.note = "等新提交上的结果".into();
                        item.sha = None;
                    }
                }
            }
        })?,
        Event::WorkerStep { .. } => with_ticket(c, tid, ts, |_| {})?,
        Event::WorkerRestarted { n, .. } => with_ticket(c, tid, ts, |t| t.restarts = *n)?,
        Event::ProgressUpdated { items } => with_ticket(c, tid, ts, |t| t.progress = items.clone())?,
        Event::CheckFinished { run } => with_ticket(c, tid, ts, |t| {
            // counts failed rounds in a row; it starts over only when every gate has passed
            if !run.ok {
                t.check_fails += 1;
            }
            match t.checks.iter_mut().find(|r| r.name == run.name) {
                Some(r) => *r = run.clone(),
                None => t.checks.push(run.clone()),
            }
        })?,
        Event::ContractSet { key, result, note, sha } => with_ticket(c, tid, ts, |t| {
            if key == "e2e" && *result == Verdict::Pass {
                t.check_fails = 0;
            }
            if let Some(item) = t.item(key) {
                item.result = *result;
                item.note = note.clone();
                item.sha = sha.clone();
            }
        })?,
        Event::ReviewFinished { round, findings } => with_ticket(c, tid, ts, |t| {
            let fresh: BTreeSet<&str> = findings.iter().map(|f| f.fingerprint.as_str()).collect();
            for old in t.review.findings.iter_mut() {
                if old.status == "open" && !fresh.contains(old.fingerprint.as_str()) {
                    old.status = "fixed".into();
                }
            }
            for f in findings {
                match t.review.findings.iter_mut().find(|o| o.fingerprint == f.fingerprint) {
                    Some(old) if old.status == "false_positive" => {}
                    Some(old) => {
                        if old.status == "fixed" {
                            *t.review.returned.entry(f.fingerprint.clone()).or_insert(0) += 1;
                        }
                        *old = f.clone();
                    }
                    None => t.review.findings.push(f.clone()),
                }
            }
            t.review.round = *round;
        })?,
        Event::ReviewPassed { patch } => with_ticket(c, tid, ts, |t| t.review.passed_patch = Some(patch.clone()))?,
        Event::FindingMarked { fingerprint, status } => with_ticket(c, tid, ts, |t| {
            if let Some(f) = t.review.findings.iter_mut().find(|f| &f.fingerprint == fingerprint) {
                f.status = status.clone();
            }
            if status == "open" {
                // a person chose to keep fixing: the come-back counter starts over
                t.review.returned.remove(fingerprint);
            }
        })?,
        Event::PrTestsFinished { tests } => with_ticket(c, tid, ts, |t| t.pr_tests = tests.clone())?,
        Event::EvidenceRecorded { evidence } => with_ticket(c, tid, ts, |t| {
            let waived: Vec<Evidence> = t.evidence.iter().filter(|e| e.waived_by.is_some() && !evidence.iter().any(|n| n.criterion == e.criterion)).cloned().collect();
            t.evidence = evidence.clone();
            t.evidence.extend(waived);
            t.evidence.sort_by_key(|e| e.criterion);
        })?,
        Event::EvidenceWaived { criteria, by } => with_ticket(c, tid, ts, |t| {
            for n in criteria {
                let kind = t.mandate.kinds.get(*n as usize - 1).cloned().unwrap_or_default();
                t.evidence.retain(|e| e.criterion != *n);
                t.evidence.push(Evidence { criterion: *n, kind, ok: true, deferred: true, note: "没有自动取证，按人工确认处理".into(), waived_by: Some(by.clone()), ..Default::default() });
            }
            t.evidence.sort_by_key(|e| e.criterion);
        })?,
        Event::RisksFlagged { risks } => with_ticket(c, tid, ts, |t| {
            let old = std::mem::take(&mut t.risks);
            t.risks = risks
                .iter()
                .map(|r| {
                    let mut r = r.clone();
                    if let Some(prev) = old.iter().find(|o| o.what == r.what && o.paths == r.paths) {
                        r.approved_by = prev.approved_by.clone();
                    }
                    r
                })
                .collect();
        })?,
        Event::RisksApproved { by } => with_ticket(c, tid, ts, |t| {
            for r in t.risks.iter_mut() {
                r.approved_by.get_or_insert_with(|| by.clone());
            }
        })?,
        Event::AskRaised { ask } => with_ticket(c, tid, ts, |t| t.ask = Some(ask.clone()))?,
        Event::AskAnswered { .. } => with_ticket(c, tid, ts, |t| t.ask = None)?,
        Event::BudgetRaised { extra, .. } => with_ticket(c, tid, ts, |t| t.budget_extra += extra)?,
        Event::CostIncurred { stage, model, input, output, amount, .. } => {
            let project = match tid {
                Some(id) => get_doc::<Ticket>(c, "ticket", id)?.map(|t| t.project),
                None => None,
            };
            c.execute(
                "INSERT OR REPLACE INTO cost(seq,ts,ticket,project,stage,model,input,output,amount) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![e.seq, ts, tid, project, stage, model, *input as i64, *output as i64, amount],
            )?;
            with_ticket(c, tid, ts, |t| t.cost += amount)?;
        }
        Event::PrOpened { pr } => with_ticket(c, tid, ts, |t| t.pr = Some(pr.clone()))?,
        Event::PrMerged { .. } => with_ticket(c, tid, ts, |t| t.merged_at = Some(ts))?,
        Event::PrChangesRequested { .. } | Event::TicketStopped { .. } => with_ticket(c, tid, ts, |_| {})?,
        Event::ArchDeltaProposed { delta } => with_ticket(c, tid, ts, |t| {
            let mut d = delta.clone();
            d.status = "proposed".into();
            d.divergence.clear();
            t.arch = Some(d);
        })?,
        Event::ArchDeltaChecked { divergence } => with_ticket(c, tid, ts, |t| {
            if let Some(a) = t.arch.as_mut() {
                a.status = if divergence.is_empty() { "verified".into() } else { "diverged".into() };
                a.divergence = divergence.clone();
            }
        })?,
        Event::FilesChanged { files } => with_ticket(c, tid, ts, |t| t.files = files.clone())?,
        Event::RolloutPhase { index, state, .. } => with_ticket(c, tid, ts, |t| {
            if let Some(ph) = t.mandate.rollout.get_mut(*index) {
                match state.as_str() {
                    "holding" => ph.holding_since = Some(ts),
                    "not_holding" => ph.holding_since = None,
                    other => {
                        if other == "now" {
                            ph.since = Some(ts);
                            ph.holding_since = None;
                        }
                        ph.state = other.to_owned();
                    }
                }
            }
        })?,
        Event::IssueReported { issue } => with_ticket(c, tid, ts, |t| t.issues.push(issue.clone()))?,
        Event::IssueLinked { index, fix } => with_ticket(c, tid, ts, |t| {
            if let Some(i) = t.issues.get_mut(*index) {
                i.fix = Some(fix.clone());
            }
        })?,
        Event::HandedOver { .. } => with_ticket(c, tid, ts, |t| t.handed = true)?,
        Event::HandedBack { .. } => with_ticket(c, tid, ts, |t| t.handed = false)?,
        Event::OverlapFound { overlap } => with_ticket(c, tid, ts, |t| t.overlap = Some(overlap.clone()))?,

        Event::QueueOpened { item } => put_doc(c, "queue", &item.id, item)?,
        Event::QueueClosed { id, .. } => del_doc(c, "queue", id)?,
        Event::QueueReminded { id, .. } => with_queue(c, id, |q| q.reminded = true)?,
        Event::QueueEscalated { id, .. } => with_queue(c, id, |q| q.escalated = true)?,
        Event::QueueHanded { id, to } => with_queue(c, id, |q| {
            q.hand_to = Some(to.clone());
            q.since = ts;
            q.reminded = false;
            q.escalated = false;
        })?,

        Event::SandboxCreated { sandbox } => {
            put_doc(c, "sandbox", &sandbox.id, sandbox)?;
            with_ticket(c, Some(&sandbox.ticket), ts, |t| t.sandbox = Some(sandbox.id.clone()))?;
        }
        Event::SandboxEnv { id, version } => {
            if let Some(mut s) = get_doc::<SandboxInfo>(c, "sandbox", id)? {
                s.env_version = *version;
                put_doc(c, "sandbox", id, &s)?;
            }
        }
        Event::SandboxStateChanged { id, state } => {
            if let Some(mut s) = get_doc::<SandboxInfo>(c, "sandbox", id)? {
                s.state = state.clone();
                put_doc(c, "sandbox", id, &s)?;
            }
        }
        Event::SandboxDestroyed { id } => {
            if let Some(s) = get_doc::<SandboxInfo>(c, "sandbox", id)? {
                with_ticket(c, Some(&s.ticket), ts, |t| {
                    if t.sandbox.as_deref() == Some(id.as_str()) {
                        t.sandbox = None;
                    }
                })?;
            }
            del_doc(c, "sandbox", id)?;
        }

        Event::Promoted { .. } => {}
        Event::InboundSeen { source, id } => {
            // platforms redeliver for a few hours at most: forget ids older than two days
            c.execute("DELETE FROM doc WHERE kind='inbound' AND CAST(body AS INTEGER) < ?1", params![ts - 2 * 86_400_000])?;
            put_doc(c, "inbound", &format!("{source}:{id}"), &ts)?;
        }
        Event::EvalCaseSaved { case } => put_doc(c, "eval_case", &case.id, case)?,
        Event::EvalCaseRemoved { id } => del_doc(c, "eval_case", id)?,
        Event::EvalRan { run } => put_doc(c, "eval_run", &run.id, run)?,
        Event::EnvPlanSet { plan } => {
            put_doc(c, "env", &plan.project, plan)?;
            put_doc(c, "env_history", &format!("{}:{:06}", plan.project, plan.version), plan)?;
        }
        Event::EnvChangeProposed { proposal } => put_doc(c, "env_proposal", &proposal.id, proposal)?,
        Event::EnvChangeDecided { id, .. } => del_doc(c, "env_proposal", id)?,
        Event::IndexBuilt { info } => put_doc(c, "index", &info.project, info)?,
        Event::ModulesScored { .. } => {}
        Event::PlanCreated { plan } => put_doc(c, "plan", &plan.id, plan)?,
        Event::PlanConfirmed { id, by } => with_plan(c, id, |p| {
            p.status = "confirmed".into();
            p.confirmed_by = Some(by.clone());
        })?,
        Event::SiblingsPinned { shas } => with_ticket(c, tid, ts, |t| t.siblings_sha = shas.clone())?,
        Event::PlanTaskStarted { plan, index, stack_on, siblings } => {
            with_plan(c, plan, |p| {
                if let Some(task) = p.tasks.get_mut(*index) {
                    task.ticket = tid.map(str::to_owned);
                }
            })?;
            with_ticket(c, tid, ts, |t| {
                t.plan = Some(plan.clone());
                t.plan_task = *index;
                t.siblings = siblings.clone();
                t.stack_on = stack_on.clone();
            })?;
        }
        Event::PlanChangeProposed { id, change } => with_plan(c, id, |p| p.change = Some(change.clone()))?,
        Event::PlanChanged { id, tasks, .. } => with_plan(c, id, |p| {
            p.tasks = tasks.clone();
            p.version += 1;
            p.change = None;
        })?,
        Event::PlanChangeRejected { id, .. } => with_plan(c, id, |p| p.change = None)?,
        Event::PlanClosed { id, status } => with_plan(c, id, |p| p.status = status.clone())?,
        Event::MemoryProposed { proposal } => put_doc(c, "memory_proposal", &proposal.id, proposal)?,
        Event::MemoryAccepted { proposal, memory } => {
            del_doc(c, "memory_proposal", proposal)?;
            put_doc(c, "memory", &memory.id, memory)?;
        }
        Event::MemoryRejected { proposal, .. } => del_doc(c, "memory_proposal", proposal)?,
        Event::MemoryRemoved { id } => del_doc(c, "memory", id)?,
        Event::AlertRaised { key, text } => put_doc(c, "alert", key, &(ts, text.clone()))?,
        Event::AlertCleared { key } => del_doc(c, "alert", key)?,
        Event::Notified { .. } | Event::SecurityLogged { .. } => {}
    }
    Ok(())
}
