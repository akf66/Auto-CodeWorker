//! Plans: a requirement too large for one pull request, split into tasks with dependencies.
//! An approver confirms the plan once; the Engine then starts each task when its dependencies allow,
//! and checks that every acceptance criterion is some task's job. A Worker that finds the plan
//! wrong proposes a change; it takes effect only when an approver agrees.

use crate::commands::create_ticket_tx;
use crate::engine::*;
use acw_core::*;
use anyhow::Result;

fn plan_queue(tx: &mut Tx, plan: &Plan, why: &str, link: &str) -> Result<()> {
    let id = format!("{}:plan", plan.id);
    if tx.view().queue_item(&id)?.is_some() {
        return Ok(());
    }
    let item = QueueItem { id, ticket: plan.id.clone(), project: plan.project.clone(), kind: "plan".into(), title: format!("计划 {} {}", plan.id, plan.goal.chars().take(24).collect::<String>()), why: why.to_owned(), since: tx.now(), need: Role::Approver, also: None, hand_to: None, reminded: false, escalated: false };
    let to = owners(&tx.view(), Role::Approver, &plan.project, None)?;
    tx.emit("engine", None, Event::QueueOpened { item })?;
    tx.effect(Effect::Notify { kind: "plan".into(), to, text: format!("计划 {}：{why}", plan.id), link: link.to_owned() })
}

fn close_plan_queue(tx: &mut Tx, plan: &str, how: &str) -> Result<()> {
    let id = format!("{plan}:plan");
    if tx.view().queue_item(&id)?.is_some() {
        tx.emit("engine", None, Event::QueueClosed { id, how: how.to_owned() })?;
    }
    Ok(())
}

/// Start every task whose turn has come. A task starts when all it depends on has merged; a stacked
/// task starts earlier, on top of the branch of a dependency that already has an open pull request.
pub fn advance_plans_tx(tx: &mut Tx, link: &dyn Fn(&str) -> String) -> Result<Vec<String>> {
    let mut started = Vec::new();
    for plan in tx.view().plans()?.into_iter().filter(|p| p.status == "confirmed") {
        let mut tasks = plan.tasks.clone();
        for i in 0..tasks.len() {
            if tasks[i].ticket.is_some() {
                continue;
            }
            let Some(project) = tx.view().project(&plan.project_of(&tasks[i]))? else { continue };
            let mut stack_on = None;
            let mut siblings = Vec::new();
            let mut ready = true;
            for d in &tasks[i].deps {
                let dep = tasks[*d - 1].ticket.as_ref().and_then(|id| tx.view().ticket(id).transpose()).transpose()?;
                let Some(t) = dep else {
                    ready = false;
                    continue;
                };
                // a dependency in another repository cannot be stacked on: its code is put next to
                // this task's repository instead, from its branch while open and from its base after
                let other_repo = t.project != project.id;
                if other_repo {
                    siblings.push(t.id.clone());
                }
                match t {
                    t if t.stage == Stage::Done || t.merged_at.is_some() => {}
                    t if tasks[i].stacked && t.stage == Stage::PrOpen && other_repo => {}
                    t if tasks[i].stacked && t.stage == Stage::PrOpen && stack_on.is_none() => stack_on = Some(t.id),
                    _ => ready = false,
                }
            }
            if !ready {
                continue;
            }
            let task = &tasks[i];
            let accept: Vec<String> = task.covers.iter().filter_map(|c| plan.accept.get(*c as usize - 1).cloned()).collect();
            let mandate = Mandate {
                goal: if task.goal.trim().is_empty() { task.title.clone() } else { task.goal.clone() },
                scope: vec![format!("计划 {} 的任务 {}：{}", plan.id, i + 1, task.title)],
                accept: if accept.is_empty() { vec!["现有测试通过".into()] } else { accept },
                ..Default::default()
            };
            let by = Actor { id: plan.by.clone(), member: None, system: true };
            let t = create_ticket_tx(tx, &by, &project, mandate, &format!("计划 {}", plan.id), &task.title, link)?;
            if t.stage == Stage::MandatePending {
                // the plan was confirmed by an approver: its tasks do not ask again
                let who = plan.confirmed_by.clone().unwrap_or_default();
                tx.emit(&who, Some(&t.id), Event::MandateConfirmed { by: who.clone(), answer: None, complete: true })?;
                tx.emit("engine", Some(&t.id), Event::ContractSet { key: "confirmed".into(), result: Verdict::Pass, note: format!("随计划 {} 确认", plan.id), sha: None })?;
                close_queue(tx, &t.id, "mandate", "confirmed")?;
                set_stage(tx, "engine", &t.id, Stage::Queued, "排队中", "", None)?;
            }
            tx.emit("engine", Some(&t.id), Event::PlanTaskStarted { plan: plan.id.clone(), index: i, stack_on, siblings })?;
            tasks[i].ticket = Some(t.id.clone());
            started.push(t.id);
        }
        let all_done = tasks.iter().all(|t| t.ticket.as_ref().is_some_and(|id| tx.view().ticket(id).ok().flatten().is_some_and(|t| t.stage == Stage::Done)));
        if all_done {
            tx.emit("engine", None, Event::PlanClosed { id: plan.id.clone(), status: "done".into() })?;
        }
    }
    Ok(started)
}

impl Engine {
    pub fn advance_plans(&self) -> Result<Vec<String>> {
        let started = self.store.write(|tx| advance_plans_tx(tx, &|id| self.link(id)))?;
        if !started.is_empty() {
            self.kick();
        }
        Ok(started)
    }

    fn plan_link(&self, id: &str) -> String {
        format!("{}/#plan-{id}", self.cfg.public_url.trim_end_matches('/'))
    }

    pub fn create_plan(&self, actor: &Actor, project: &str, goal: &str, accept: Vec<String>, tasks: Vec<PlanTask>) -> Result<Plan> {
        self.store.write(|tx| {
            actor.require(Role::Requester, Some(project), "提计划")?;
            tx.view().project(project)?.ok_or_else(|| not_found(format!("找不到项目 {project}")))?;
            for other in tasks.iter().filter_map(|t| t.project.as_deref()).filter(|p| *p != project) {
                tx.view().project(other)?.ok_or_else(|| not_found(format!("找不到项目 {other}")))?;
                actor.require(Role::Requester, Some(other), &format!("在项目 {other} 里提任务"))?;
            }
            if goal.trim().is_empty() || accept.is_empty() {
                return Err(invalid("计划要有目标和验收标准"));
            }
            validate_plan(accept.len(), &tasks).map_err(invalid)?;
            let tasks = tasks.into_iter().map(|mut t| { t.ticket = None; t }).collect();
            let plan = Plan { id: tx.view().next_id("plan", "P-")?, project: project.to_owned(), by: actor.id.clone(), goal: goal.trim().to_owned(), accept, tasks, version: 1, status: "open".into(), confirmed_by: None, change: None, created: tx.now() };
            tx.emit(&actor.id, None, Event::PlanCreated { plan: plan.clone() })?;
            plan_queue(tx, &plan, "计划等审批人确认：确认一次，任务按依赖自动开工", &self.plan_link(&plan.id))?;
            Ok(plan)
        })
    }

    pub fn confirm_plan(&self, actor: &Actor, id: &str) -> Result<Vec<String>> {
        self.store.write(|tx| {
            let plan = tx.view().plan(id)?.ok_or_else(|| not_found(format!("找不到计划 {id}")))?;
            // a plan over several repositories needs an approver of each
            for p in plan.projects() {
                actor.require(Role::Approver, Some(&p), &format!("确认计划（涉及项目 {p}）"))?;
            }
            if plan.status != "open" {
                return Err(conflict("这份计划现在不需要确认"));
            }
            tx.emit(&actor.id, None, Event::PlanConfirmed { id: id.to_owned(), by: actor.id.clone() })?;
            close_plan_queue(tx, id, "confirmed")?;
            Ok(())
        })?;
        self.advance_plans()
    }

    pub fn drop_plan(&self, actor: &Actor, id: &str) -> Result<()> {
        self.store.write(|tx| {
            let plan = tx.view().plan(id)?.ok_or_else(|| not_found(format!("找不到计划 {id}")))?;
            actor.require(Role::Approver, Some(&plan.project), "放弃计划")?;
            close_plan_queue(tx, id, "dropped")?;
            tx.emit(&actor.id, None, Event::PlanClosed { id: id.to_owned(), status: "dropped".into() }).map(|_| ())
        })
    }

    /// A Worker's proposal to change the plan. Tasks that already started keep their ticket.
    pub fn propose_plan_change(&self, from: &Ticket, why: &str, tasks: Vec<PlanTask>) -> Result<()> {
        let Some(plan_id) = &from.plan else { return Ok(()) };
        self.store.write(|tx| {
            let plan = tx.view().plan(plan_id)?.ok_or_else(|| not_found("计划不存在"))?;
            validate_plan(plan.accept.len(), &tasks).map_err(invalid)?;
            for other in tasks.iter().filter_map(|t| t.project.as_deref()) {
                tx.view().project(other)?.ok_or_else(|| invalid(format!("找不到项目 {other}")))?;
            }
            let tasks: Vec<PlanTask> = tasks.into_iter().map(|mut t| { t.ticket = plan.tasks.iter().find(|o| o.title == t.title).and_then(|o| o.ticket.clone()); t }).collect();
            tx.emit("worker", Some(&from.id), Event::PlanChangeProposed { id: plan.id.clone(), change: PlanChange { why: why.to_owned(), tasks, from: from.id.clone(), at: tx.now() } })?;
            plan_queue(tx, &plan, &format!("{} 的 Worker 提议改计划：{why}", from.id), &self.plan_link(&plan.id))
        })
    }

    pub fn decide_plan_change(&self, actor: &Actor, id: &str, accept: bool, reason: &str) -> Result<Vec<String>> {
        self.store.write(|tx| {
            let plan = tx.view().plan(id)?.ok_or_else(|| not_found(format!("找不到计划 {id}")))?;
            actor.require(Role::Approver, Some(&plan.project), "决定计划的改动")?;
            let change = plan.change.clone().ok_or_else(|| conflict("这份计划现在没有等确认的改动"))?;
            if accept {
                for p in change.tasks.iter().filter_map(|t| t.project.as_deref()) {
                    actor.require(Role::Approver, Some(p), &format!("确认计划的改动（涉及项目 {p}）"))?;
                }
            }
            close_plan_queue(tx, id, if accept { "changed" } else { "kept" })?;
            if accept {
                tx.emit(&actor.id, None, Event::PlanChanged { id: id.to_owned(), by: actor.id.clone(), tasks: change.tasks })?;
            } else {
                tx.emit(&actor.id, None, Event::PlanChangeRejected { id: id.to_owned(), by: actor.id.clone(), reason: reason.to_owned() })?;
                let text = format!("你提议的计划改动没有被同意{}。按原计划继续做你这个任务的部分。", if reason.trim().is_empty() { String::new() } else { format!("：{reason}") });
                tx.emit(&actor.id, Some(&change.from), Event::InputQueued { input: Input { source: "member".into(), text, trusted: true } })?;
            }
            Ok(())
        })?;
        self.advance_plans()
    }

    /// Has the plan this task belongs to spent its allowance?
    pub fn plan_over_budget(&self, t: &Ticket) -> Result<Option<(f64, f64)>> {
        let Some(id) = &t.plan else { return Ok(None) };
        self.store.read(|v| {
            let Some(plan) = v.plan(id)? else { return Ok(None) };
            let cap = plan.budget();
            if cap <= 0.0 {
                return Ok(None);
            }
            let mut spent = 0.0;
            for task in &plan.tasks {
                if let Some(tid) = &task.ticket {
                    spent += v.ticket(tid)?.map(|t| t.cost).unwrap_or(0.0);
                }
            }
            Ok((spent >= cap).then_some((spent, cap)))
        })
    }

    /// The branch a task builds on: the project's base, or the branch of the task it is stacked on
    /// for as long as that task is still open.
    pub fn base_of(&self, t: &Ticket, p: &Project) -> Result<String> {
        if let Some(parent) = &t.stack_on {
            if let Some(pt) = self.store.read(|v| v.ticket(parent))? {
                if pt.stage.is_open() && pt.merged_at.is_none() {
                    if let Some(b) = pt.branch {
                        return Ok(b);
                    }
                }
            }
        }
        Ok(p.base_branch.clone())
    }
}
