//! After the merge: staged rollout and what production says back.
//! The Engine has no write access to production. It records which phase a task is in, checks each
//! phase's gate through a read-only URL, and tells the approvers when a phase may move on.

use crate::commands::create_ticket_tx;
use crate::engine::*;
use acw_core::*;
use anyhow::Result;
use std::time::Duration;

fn current(t: &Ticket) -> Option<(usize, &Phase)> {
    t.mandate.rollout.iter().enumerate().find(|(_, p)| p.state == "now" || p.state == "ready")
}

fn phase_state(t: &Ticket, i: usize) -> String {
    format!("上线中（第 {} / {} 阶段：{}）", i + 1, t.mandate.rollout.len(), t.mandate.rollout[i].name)
}

/// Called inside the merge transaction when the mandate has phases. Returns false when there are none.
pub fn start_rollout(tx: &mut Tx, t: &Ticket, link: &str) -> Result<bool> {
    if t.mandate.rollout.is_empty() {
        return Ok(false);
    }
    tx.emit("engine", Some(&t.id), Event::RolloutPhase { index: 0, state: "now".into(), by: "engine".into(), note: "PR 已合并".into() })?;
    set_stage(tx, "engine", &t.id, Stage::RollingOut, &phase_state(t, 0), &t.mandate.rollout[0].gate, None)?;
    if t.mandate.rollout[0].gate_url.is_empty() {
        ready(tx, t, 0, link)?;
    }
    Ok(true)
}

fn ready(tx: &mut Tx, t: &Ticket, i: usize, link: &str) -> Result<()> {
    let ph = &t.mandate.rollout[i];
    tx.emit("engine", Some(&t.id), Event::RolloutPhase { index: i, state: "ready".into(), by: "engine".into(), note: if ph.gate_url.is_empty() { "这一阶段的条件由人判断".into() } else { format!("条件已连续成立 {} 分钟", ph.hold_minutes) } })?;
    open_queue(tx, t, "rollout", &format!("第 {} 阶段“{}”可以推进：{}", i + 1, ph.name, ph.gate), Role::Approver, None, link)
}

impl Engine {
    /// Look at the gate of every phase in progress. Runs on the clock.
    pub async fn check_rollouts(&self) -> Result<()> {
        let rolling: Vec<Ticket> = self.store.read(|v| v.tickets())?.into_iter().filter(|t| t.stage == Stage::RollingOut).collect();
        for t in rolling {
            let Some((i, ph)) = current(&t) else { continue };
            if ph.state != "now" || ph.gate_url.is_empty() {
                continue;
            }
            let holds = match self.http.get(&ph.gate_url).timeout(Duration::from_secs(10)).send().await {
                Ok(r) if r.status().is_success() => {
                    let body = r.text().await.unwrap_or_default();
                    serde_json::from_str::<serde_json::Value>(&body).ok().and_then(|v| v.get("ok").and_then(|o| o.as_bool())).unwrap_or(true)
                }
                _ => false,
            };
            let link = format!("{}-rollout", self.link(&t.id));
            self.store.write(|tx| {
                let Some(t) = tx.view().ticket(&t.id)? else { return Ok(()) };
                let Some(ph) = t.mandate.rollout.get(i).filter(|p| p.state == "now") else { return Ok(()) };
                match (holds, ph.holding_since) {
                    (true, None) => {
                        tx.emit("engine", Some(&t.id), Event::RolloutPhase { index: i, state: "holding".into(), by: "engine".into(), note: "条件开始成立".into() })?;
                        if ph.hold_minutes == 0 {
                            ready(tx, &t, i, &link)?;
                        }
                    }
                    (true, Some(since)) if tx.now() - since >= ph.hold_minutes as i64 * 60_000 => ready(tx, &t, i, &link)?,
                    (false, Some(_)) => {
                        tx.emit("engine", Some(&t.id), Event::RolloutPhase { index: i, state: "not_holding".into(), by: "engine".into(), note: "条件不再成立，重新计时".into() })?;
                    }
                    _ => {}
                }
                Ok(())
            })?;
        }
        Ok(())
    }

    /// An approver says the current phase is finished and the next one has been entered.
    pub fn rollout_advance(&self, actor: &Actor, id: &str) -> Result<()> {
        let link = format!("{}-rollout", self.link(id));
        self.store.write(|tx| {
            let t = tx.view().ticket(id)?.ok_or_else(|| not_found(format!("找不到任务 {id}")))?;
            actor.require(Role::Approver, Some(&t.project), "推进上线阶段")?;
            let (i, ph) = current(&t).filter(|_| t.stage == Stage::RollingOut).ok_or_else(|| conflict("这个任务现在没有在上线中的阶段"))?;
            if ph.state != "ready" {
                return Err(conflict(format!("第 {} 阶段的条件还没有达成：{}", i + 1, ph.gate)));
            }
            close_queue(tx, id, "rollout", "advanced")?;
            tx.emit(&actor.id, Some(id), Event::RolloutPhase { index: i, state: "done".into(), by: actor.id.clone(), note: String::new() })?;
            if i + 1 == t.mandate.rollout.len() {
                return set_stage(tx, "engine", id, Stage::Done, "已合并，上线完成", "", None);
            }
            tx.emit(&actor.id, Some(id), Event::RolloutPhase { index: i + 1, state: "now".into(), by: actor.id.clone(), note: String::new() })?;
            let t2 = tx.view().ticket(id)?.unwrap_or(t);
            set_stage(tx, "engine", id, Stage::RollingOut, &phase_state(&t2, i + 1), &t2.mandate.rollout[i + 1].gate, None)?;
            if t2.mandate.rollout[i + 1].gate_url.is_empty() {
                ready(tx, &t2, i + 1, &link)?;
            }
            Ok(())
        })
    }

    /// An approver undid the current phase. The task stays open so the record shows where it stands.
    pub fn rollout_back(&self, actor: &Actor, id: &str, reason: &str) -> Result<()> {
        self.store.write(|tx| {
            let t = tx.view().ticket(id)?.ok_or_else(|| not_found(format!("找不到任务 {id}")))?;
            actor.require(Role::Approver, Some(&t.project), "回退上线阶段")?;
            let (i, ph) = current(&t).filter(|_| t.stage == Stage::RollingOut).ok_or_else(|| conflict("这个任务现在没有在上线中的阶段"))?;
            close_queue(tx, id, "rollout", "rolled_back")?;
            tx.emit(&actor.id, Some(id), Event::RolloutPhase { index: i, state: "rolled_back".into(), by: actor.id.clone(), note: reason.to_owned() })?;
            set_stage(tx, "engine", id, Stage::RollingOut, &format!("第 {} 阶段已回退", i + 1), &format!("回退方式：{}。{reason}", ph.back), None)
        })
    }

    /// Production reported a problem in a file. It is attached to the tasks merged in the last
    /// 14 days that changed that file, and their approvers are told. Returns the tasks it matched.
    pub fn report_issue(&self, project: &str, title: &str, file: &str, source: &str, url: &str) -> Result<Vec<String>> {
        self.store.write(|tx| {
            let since = tx.now() - 14 * 86_400_000;
            let (title, _) = acw_core::scan::redact(title);
            let hit: Vec<Ticket> = tx.view().tickets()?.into_iter().filter(|t| t.project == project && t.merged_at.is_some_and(|m| m >= since) && t.files.iter().any(|f| f == file)).collect();
            for t in &hit {
                if t.issues.iter().any(|i| i.title == title && i.file == file) {
                    continue;
                }
                tx.emit("engine", Some(&t.id), Event::IssueReported { issue: Issue { at: tx.now(), title: title.clone(), file: file.to_owned(), source: source.to_owned(), url: url.to_owned(), fix: None } })?;
                let to = owners(&tx.view(), Role::Approver, &t.project, Some(&t.by))?;
                tx.effect(Effect::Notify { kind: "issue".into(), to, text: format!("{} 合并后，线上在 {file} 报了问题：{title}", t.id), link: format!("{}-rollout", self.link(&t.id)) })?;
            }
            Ok(hit.into_iter().map(|t| t.id).collect())
        })
    }

    /// Open a task to fix a reported issue, linked both ways.
    pub fn fix_issue(&self, actor: &Actor, id: &str, index: usize) -> Result<String> {
        let fix = self.store.write(|tx| {
            let t = tx.view().ticket(id)?.ok_or_else(|| not_found(format!("找不到任务 {id}")))?;
            let issue = t.issues.get(index).ok_or_else(|| not_found("没有这条问题"))?;
            if let Some(f) = &issue.fix {
                return Err(conflict(format!("已经有修复任务 {f}")));
            }
            let p = tx.view().project(&t.project)?.ok_or_else(|| not_found("项目不存在"))?;
            let mandate = Mandate { goal: format!("修复 {}（{} 合并后线上出现）", issue.title, t.id), scope: vec![issue.file.clone()], accept: vec![format!("{} 不再出现，并有一个能复现它的测试", issue.title)], ..Default::default() };
            let new = create_ticket_tx(tx, actor, &p, mandate, "合并后问题", &issue.title, &|x| self.link(x))?;
            tx.emit(&actor.id, Some(id), Event::IssueLinked { index, fix: new.id.clone() })?;
            Ok(new.id)
        })?;
        self.kick();
        Ok(fix)
    }
}
