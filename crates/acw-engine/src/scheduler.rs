//! Admission: which queued task gets the next free slot.
//!
//! Order: priority first; then, with `sched = fair`, the project that is using the smallest share
//! of slots relative to its weight; then age. A task is held back when its project is out of budget,
//! its repository already has enough tasks in flight, the task it depends on has not merged, or
//! every approver of its project already has a full queue (back-pressure: no point producing work
//! nobody can look at).

use crate::engine::*;
use acw_core::*;
use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;

/// Why a queued task is not starting, or `None` when it can.
fn held(v: &View, t: &Ticket, s: &Settings, tickets: &[Ticket], now: Ms) -> Result<Option<String>> {
    if let Some(dep) = &t.depends_on {
        if tickets.iter().find(|x| &x.id == dep).is_some_and(|d| d.stage.is_open() && d.merged_at.is_none()) {
            return Ok(Some(format!("等 {dep} 合并后开工")));
        }
    }
    let in_repo = tickets.iter().filter(|x| x.project == t.project && x.stage.is_active()).count() as u32;
    if in_repo >= s.repo_parallel {
        return Ok(Some(format!("这个仓库已有 {in_repo} 个任务在跑（上限 {}）", s.repo_parallel)));
    }
    let today = v.cost_sum(Some(&t.project), day_start(now))?;
    if today >= s.project_day {
        return Ok(Some(format!("项目今天的额度用完了（¥{today:.0} / ¥{:.0}）", s.project_day)));
    }
    let month = v.cost_sum(Some(&t.project), now - 30 * 86_400_000)?;
    if month >= s.project_month {
        return Ok(Some(format!("项目近 30 天的额度用完了（¥{month:.0} / ¥{:.0}）", s.project_month)));
    }
    let approvers: Vec<Member> = v.members()?.into_iter().filter(|m| can(Some(m), Role::Approver, Some(&t.project))).collect();
    if !approvers.is_empty() {
        let mut room = false;
        for m in &approvers {
            if (queue_of(v, m)?.len() as u32) < queue_limit(m, s) {
                room = true;
                break;
            }
        }
        if !room {
            return Ok(Some("这个项目的审批人待处理都到了上限，处理掉几件后自动开工".into()));
        }
    }
    Ok(None)
}

impl Engine {
    /// Give free slots to queued tasks. Returns the tasks that should have a pipeline running.
    pub fn admit(&self) -> Result<Vec<String>> {
        self.store.write(|tx| {
            if tx.view().draining()? {
                return Ok(vec![]);
            }
            let s = tx.view().settings()?;
            let tickets = tx.view().tickets()?;
            let now = tx.now();
            let mut running: HashMap<String, u32> = HashMap::new();
            for t in tickets.iter().filter(|t| t.stage.is_active()) {
                *running.entry(t.project.clone()).or_default() += 1;
            }
            let mut total: u32 = running.values().sum();
            let fair = |t: &Ticket, running: &HashMap<String, u32>| if s.sched == "fair" { *running.get(&t.project).unwrap_or(&0) as f64 / *s.weights.get(&t.project).unwrap_or(&1).max(&1) as f64 } else { 0.0 };

            let mut waiting: Vec<&Ticket> = tickets.iter().filter(|t| t.stage == Stage::Queued && !t.handed).collect();
            let mut noted: std::collections::HashSet<&str> = std::collections::HashSet::new();
            loop {
                waiting.sort_by(|a, b| a.priority.cmp(&b.priority).then(fair(a, &running).total_cmp(&fair(b, &running))).then(a.created.cmp(&b.created)).then(acw_core::store::ticket_no(&a.id).cmp(&acw_core::store::ticket_no(&b.id))));
                let mut started = None;
                for (i, t) in waiting.iter().enumerate() {
                    let why = if total >= s.workers { Some(format!("Worker 槽位满了（{} 个）", s.workers)) } else { held(&tx.view(), t, &s, &tickets, now)? };
                    match why {
                        None => {
                            let next = t.resume.unwrap_or(Stage::Provisioning);
                            set_stage(tx, "engine", &t.id, next, "开工", "", None)?;
                            started = Some(i);
                            break;
                        }
                        Some(why) if (why != t.why || t.state != "排队中") && noted.insert(t.id.as_str()) => {
                            // keep the reason people see up to date, without touching `resume`
                            set_stage(tx, "engine", &t.id, Stage::Queued, "排队中", &why, t.resume)?;
                        }
                        Some(_) => {}
                    }
                }
                match started {
                    Some(i) => {
                        let t = waiting.remove(i);
                        *running.entry(t.project.clone()).or_default() += 1;
                        total += 1;
                    }
                    None => break,
                }
            }
            Ok(tx.view().tickets()?.into_iter().filter(|t| t.stage.is_active() && !t.handed).map(|t| t.id).collect())
        })
    }

    /// The admission loop: runs whenever something changed, and every few seconds regardless.
    pub async fn scheduler(self: Arc<Self>) {
        loop {
            if !self.is_primary() {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                continue;
            }
            match self.admit() {
                Ok(ids) => {
                    for id in ids {
                        self.spawn_run(&id);
                    }
                }
                Err(e) => tracing::error!("调度出错：{e:#}"),
            }
            tokio::select! {
                _ = self.wake.notified() => {}
                _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {}
            }
        }
    }
}
