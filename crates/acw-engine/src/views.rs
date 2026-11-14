//! Read models for the console. Nothing here writes; everything comes from projections and the log.

use crate::engine::*;
use acw_core::*;
use anyhow::Result;
use serde_json::{json, Value};

fn short(sha: &str) -> &str {
    &sha[..sha.len().min(7)]
}

fn clip(s: &str, n: usize) -> String {
    if s.chars().count() > n {
        format!("{}…", s.chars().take(n).collect::<String>())
    } else {
        s.to_owned()
    }
}

/// One event as a line of a task's timeline: (kind, what, detail). `None` hides it.
pub fn timeline_entry(e: &StoredEvent) -> Option<(&'static str, String, String)> {
    Some(match &e.event {
        Event::TicketCreated { ticket } => ("report", format!("{} 开了任务", e.actor), format!("来自{}：{}", ticket.via, clip(&ticket.source_text, 200))),
        Event::TicketMoved { project } => ("report", format!("{} 把任务移到了 {project}", e.actor), String::new()),
        Event::MandateUpdated { .. } => ("report", "需求单已更新".into(), String::new()),
        Event::MandateConfirmed { by, answer, complete } => ("flag", format!("{by} 确认了需求单{}", if *complete { "" } else { "，还差一位审批人" }), answer.clone().unwrap_or_default()),
        Event::StageChanged { state, why, .. } => ("stage", state.clone(), why.clone()),
        Event::PriorityChanged { priority } => ("report", format!("{} 把优先级改成{}", e.actor, match priority { Priority::High => "高", Priority::Normal => "普通", Priority::Low => "低" }), String::new()),
        Event::DependencySet { on } => ("report", on.as_ref().map(|o| format!("排在 {o} 后面")).unwrap_or_else(|| "不再依赖别的任务".into()), String::new()),
        Event::InputQueued { input } if input.trusted => ("report", format!("收到要处理的内容（{}）", input.source), clip(&input.text, 600)),
        Event::InputQueued { input } => ("flag", "收到外部内容，按数据处理，不当指令".into(), clip(&input.text, 300)),
        Event::BranchSet { branch, base_sha } => ("box", format!("任务分支 {branch}"), format!("基于 {}", short(base_sha))),
        Event::HeadMoved { sha, pushed, commits } => ("code", format!("新提交 {}", short(sha)), format!("{}{}", if *commits > 0 { format!("分支上共 {commits} 个提交，") } else { String::new() }, if *pushed { "已推到远端任务分支" } else { "还没推到远端" })),
        Event::WorkerStep { kind, what, detail } => (
            match kind.as_str() {
                "cmd" => "cmd",
                "edit" => "edit",
                "say" => "say",
                "read" => "read",
                "tool" => "tool",
                "error" => "error",
                "box" => "box",
                _ => "log",
            },
            what.clone(),
            detail.clone(),
        ),
        Event::WorkerRestarted { reason, n } => ("flag", format!("Worker 卡住，第 {n} 次重启"), reason.clone()),
        Event::CheckFinished { run } => ("check", format!("{} {}", check_name(&run.name), if run.ok { "通过" } else { "没有通过" }), run.summary.clone()),
        Event::ContractSet { key, result, note, .. } if *result != Verdict::Wait => ("gate", format!("完成条件“{}”{}", contract_name(key), if *result == Verdict::Pass { "通过" } else { "没有通过" }), note.clone()),
        Event::ReviewFinished { round, findings } => {
            let blocking = findings.iter().filter(|f| f.blocks()).count();
            ("review", format!("审查第 {round} 轮：{} 个发现，{blocking} 个已证实的 P0 或 P1", findings.len()), findings.iter().map(|f| format!("[{}{}] {}", f.severity.to_uppercase(), if f.confirmed { "，已证实" } else { "" }, f.title)).collect::<Vec<_>>().join("\n"))
        }
        Event::ReviewPassed { .. } => return None,
        Event::ArchDeltaProposed { delta } => ("report", "Worker 提交了架构变化".into(), format!("{}\n新增 {} 个组件，移除 {} 个", delta.summary, delta.added().len(), delta.removed().len())),
        Event::ArchDeltaChecked { divergence } if divergence.is_empty() => ("gate", "架构变化图已按改动核对".into(), String::new()),
        Event::ArchDeltaChecked { divergence } => ("flag", "改动和架构变化图不一致".into(), divergence.join("\n")),
        Event::RolloutPhase { index, state, by, note } => match state.as_str() {
            "holding" | "not_holding" => ("report", format!("上线第 {} 阶段：{note}", index + 1), String::new()),
            "ready" => ("flag", format!("上线第 {} 阶段可以推进", index + 1), note.clone()),
            "done" => ("gate", format!("{by} 确认上线第 {} 阶段完成", index + 1), note.clone()),
            "rolled_back" => ("flag", format!("{by} 回退了上线第 {} 阶段", index + 1), note.clone()),
            _ => ("stage", format!("进入上线第 {} 阶段", index + 1), note.clone()),
        },
        Event::IssueReported { issue } => ("flag", format!("线上问题：{}", issue.title), format!("{}，来自 {}", issue.file, issue.source)),
        Event::IssueLinked { fix, .. } => ("report", format!("已开修复任务 {fix}"), String::new()),
        Event::PlanTaskStarted { plan, index, stack_on, siblings } => (
            "report",
            format!("计划 {plan} 的任务 {}", index + 1),
            match stack_on {
                Some(s) => format!("叠放在 {s} 的分支上，它合并后自动改到主分支"),
                None if !siblings.is_empty() => format!("依赖别的仓库里的 {}，它们的代码放在 ../deps 下", siblings.join("、")),
                None => String::new(),
            },
        ),
        Event::SiblingsPinned { shas } => ("box", "同组仓库的代码已放进沙箱".into(), shas.iter().map(|(k, v)| format!("{k} @ {}", &v[..v.len().min(7)])).collect::<Vec<_>>().join("，")),
        Event::PlanChangeProposed { id, change } => ("flag", format!("Worker 提议改计划 {id}"), change.why.clone()),
        Event::MemoryProposed { proposal } => ("report", "提议了一条项目记忆，等审批人审核".into(), proposal.text.clone()),
        Event::MemoryAccepted { memory, .. } => ("flag", format!("{} 采纳了项目记忆 {}", memory.by, memory.id), memory.text.clone()),
        Event::MemoryRejected { by, reason, .. } => ("flag", format!("{by} 没有采纳一条记忆提议"), reason.clone()),
        Event::FindingMarked { status, .. } => ("flag", format!("{} 把一条审查发现{}", e.actor, if status == "false_positive" { "标为误报" } else { "恢复为待修" }), String::new()),
        Event::PrTestsFinished { tests } => ("check", format!("验收测试 {} 个：{} 个在新提交上通过", tests.len(), tests.iter().filter(|t| t.head_pass).count()), tests.iter().map(|t| format!("验收 {}：改动前{}，改动后{}", t.criterion, if t.base_pass { "通过" } else { "失败" }, if t.head_pass { "通过" } else { "失败" })).collect::<Vec<_>>().join("\n")),
        Event::EvidenceRecorded { evidence } => ("check", format!("非功能验收取证 {} 条", evidence.len()), evidence.iter().map(|e| format!("验收 {}（{}）：{}。{}", e.criterion, crate::gates::kind_name(&e.kind), if e.deferred { "留待确认" } else if e.ok { "通过" } else { "没有通过" }, e.note.lines().next().unwrap_or_default())).collect::<Vec<_>>().join("\n")),
        Event::EvidenceWaived { criteria, by } => ("flag", format!("{by} 同意验收标准 {} 按人工确认处理", criteria.iter().map(|c| c.to_string()).collect::<Vec<_>>().join("、")), String::new()),
        Event::RisksFlagged { risks } if !risks.is_empty() => ("flag", "有需要批准的改动".into(), risks.iter().map(|r| format!("{}：{}", r.what, r.paths.join("、"))).collect::<Vec<_>>().join("\n")),
        Event::RisksApproved { by } => ("flag", format!("{by} 批准了这些改动"), String::new()),
        Event::AskRaised { ask } => ("ask", "需要人决定".into(), ask.text.clone()),
        Event::AskAnswered { by, answer } => ("flag", format!("{by} 回答了"), answer.clone()),
        Event::BudgetRaised { by, extra } => ("flag", format!("{by} 把预算提高了 ¥{extra:.0}"), String::new()),
        Event::PrOpened { pr } => ("gate", format!("开出 PR #{}", pr.number), pr.url.clone()),
        Event::PrMerged { by } => ("gate", "PR 已合并，任务结束".into(), format!("合并人：{by}")),
        Event::PrChangesRequested { by, .. } => ("report", format!("{by} 在 PR 上要求修改"), String::new()),
        Event::TicketStopped { by, reason } => ("flag", format!("{by} 停止了任务"), reason.clone()),
        Event::HandedOver { by } => ("flag", format!("{by} 接手了任务分支"), "Worker 停下，等交还".into()),
        Event::HandedBack { by } => ("flag", format!("{by} 把任务交还给 Worker"), String::new()),
        Event::OverlapFound { overlap } => ("report", format!("和 {} 改动范围重叠", overlap.with), format!("都会改模块“{}”", overlap.module)),
        Event::QueueReminded { to, .. } => ("flag", "等待过半，已提醒".into(), to.join("、")),
        Event::QueueEscalated { to, .. } => ("flag", "超时，已升级".into(), to.join("、")),
        Event::QueueHanded { to, .. } => ("flag", format!("{} 把这件事转给了 {to}", e.actor), String::new()),
        Event::SandboxCreated { sandbox } => ("box", format!("沙箱已创建（{}）", sandbox.provider), format!("宿主机 {}，模板 {}", sandbox.host, sandbox.template)),
        Event::SandboxStateChanged { state, .. } => ("box", format!("沙箱{}", if state == "paused" { "已暂停" } else { "恢复运行" }), String::new()),
        Event::SecurityLogged { kind, who, what, result } => ("flag", format!("{kind}：{who}"), format!("{what}\n{result}")),
        Event::MessageRouted { route } if route.output.decision == "route_to_ticket" => ("report", "Router 把一条消息转给了这个任务".into(), clip(&route.input.text, 200)),
        _ => return None,
    })
}

pub fn check_name(k: &str) -> &str {
    match k {
        "build" => "构建",
        "lint" => "lint",
        "unit" => "单元测试",
        "e2e" => "全量 E2E",
        "accept" => "验收测试",
        "tests_kept" => "测试保留检查",
        "evidence" => "非功能验收",
        "arch" => "架构变化核对",
        other => other,
    }
}

pub fn contract_name(k: &str) -> &str {
    match k {
        "checks" => "构建、lint、单元测试",
        "e2e" => "全量 E2E 与验收测试",
        "review" => "审查无已证实的 P0 或 P1",
        "tests_kept" => "测试未删除、未新增 skip",
        _ => "需人确认的事项已确认",
    }
}

fn brief(t: &Ticket) -> Value {
    json!({
        "id": t.id, "title": t.title, "project": t.project, "kind": t.stage.kind(), "stage": t.stage, "state": t.state, "why": t.why,
        "created": t.created, "updated": t.updated, "since": t.since, "by": t.by, "priority": t.priority, "pr": t.pr, "cost": t.cost,
        "branch": t.branch, "modules": t.modules, "handed": t.handed, "passed": t.contract.iter().filter(|c| c.result == Verdict::Pass).count(),
        "depends_on": t.depends_on, "plan": t.plan, "stack_on": t.stack_on,
    })
}

impl Engine {
    fn queue_json(&self, v: &View, q: &QueueItem, s: &Settings, now: Ms) -> Result<Value> {
        let limit = s.sla.get(&q.kind).copied().unwrap_or(60) as i64;
        let waited = (now - q.since) / 60_000;
        let who = match &q.hand_to {
            Some(to) => vec![to.clone()],
            None => owners(v, q.need, &q.project, q.also.as_deref())?,
        };
        Ok(json!({ "id": q.id, "ticket": q.ticket, "project": q.project, "kind": q.kind, "title": q.title, "why": q.why, "since": q.since,
            "waited_minutes": waited, "limit_minutes": limit, "overdue_minutes": (waited - limit).max(0), "owners": who, "hand_to": q.hand_to,
            "reminded": q.reminded, "escalated": q.escalated }))
    }

    pub fn view_overview(&self, actor: &Actor) -> Result<Value> {
        self.store.read(|v| {
            let s = v.settings()?;
            let now = now_ms();
            let tickets = v.tickets()?;
            let mine = match &actor.member {
                Some(m) => queue_of(v, m)?,
                None => v.queue()?,
            };
            let queue: Vec<Value> = mine.iter().map(|q| self.queue_json(v, q, &s, now)).collect::<Result<_>>()?;
            let today = day_start(now);
            let limit = actor.member.as_ref().map(|m| queue_limit(m, &s)).unwrap_or(s.queue_limit);
            Ok(json!({
                "queue": queue,
                "stats": {
                    "queue": mine.len(), "queue_limit": limit,
                    "today_new": tickets.iter().filter(|t| t.created >= today).count(),
                    "merged_today": tickets.iter().filter(|t| t.stage == Stage::Done && t.updated >= today).count(),
                    "prs_open": tickets.iter().filter(|t| t.stage == Stage::PrOpen).count(),
                    "workers_used": tickets.iter().filter(|t| t.stage.is_active()).count(), "workers": s.workers,
                    "sandboxes": v.sandboxes()?.len(),
                },
                "running": tickets.iter().filter(|t| t.stage.is_active()).map(brief).collect::<Vec<_>>(),
                "queued": tickets.iter().filter(|t| t.stage == Stage::Queued).map(brief).collect::<Vec<_>>(),
                "draining": v.draining()?,
            }))
        })
    }

    pub fn view_tickets(&self) -> Result<Value> {
        self.store.read(|v| Ok(Value::Array(v.tickets()?.iter().map(brief).collect())))
    }

    pub fn view_ticket(&self, actor: &Actor, id: &str) -> Result<Value> {
        self.store.read(|v| {
            let t = v.ticket(id)?.ok_or_else(|| not_found(format!("找不到任务 {id}")))?;
            let s = v.settings()?;
            let now = now_ms();
            let timeline: Vec<Value> = v
                .events_for(id)?
                .iter()
                .filter_map(|e| timeline_entry(e).map(|(kind, what, detail)| json!({ "seq": e.seq, "t": e.ts, "actor": e.actor, "kind": kind, "what": what, "detail": detail })))
                .collect();
            let queue: Vec<Value> = v.queue()?.iter().filter(|q| q.ticket == id).map(|q| self.queue_json(v, q, &s, now)).collect::<Result<_>>()?;
            let sandbox = v.sandboxes()?.into_iter().find(|sb| sb.ticket == id);
            let contract: Vec<Value> = t.contract.iter().map(|c| json!({ "key": c.key, "title": contract_name(&c.key), "result": c.result, "note": c.note, "sha": c.sha })).collect();
            Ok(json!({
                "ticket": t, "kind": t.stage.kind(), "project_name": v.project(&t.project)?.map(|p| p.name).unwrap_or_default(),
                "contract": contract, "timeline": timeline, "queue": queue, "sandbox": sandbox,
                "budget": s.budget + t.budget_extra, "running": self.is_running(id), "forge": self.forge.name(),
                "can": { "approve": actor.can(Role::Approver, Some(&t.project)), "request": actor.can(Role::Approver, Some(&t.project)) || t.by == actor.id },
            }))
        })
    }

    pub fn view_settings(&self) -> Result<Value> {
        self.store.read(|v| {
            let history: Vec<Value> = v
                .events_of_kind("settings_changed", 50)?
                .into_iter()
                .filter_map(|e| match e.event {
                    Event::SettingsChanged { changes, note, snapshot } => Some(json!({ "version": snapshot.version, "at": e.ts, "by": e.actor, "changes": changes, "note": note })),
                    _ => None,
                })
                .collect();
            Ok(json!({ "settings": v.settings()?, "endpoints": v.endpoints()?, "history": history, "stages": STAGES }))
        })
    }

    pub fn view_projects(&self) -> Result<Value> {
        self.store.read(|v| {
            let tickets = v.tickets()?;
            Ok(Value::Array(
                v.projects()?
                    .into_iter()
                    .map(|p| {
                        let open = tickets.iter().filter(|t| t.project == p.id && t.stage.is_open()).count();
                        let approvers = owners(v, Role::Approver, &p.id, None).unwrap_or_default();
                        json!({ "project": p, "open": open, "approvers": approvers })
                    })
                    .collect(),
            ))
        })
    }

    pub fn view_cost(&self) -> Result<Value> {
        self.store.read(|v| {
            let now = now_ms();
            let s = v.settings()?;
            let rows = |dim: &str, since: Ms| -> Result<Vec<Value>> { Ok(v.cost_by(dim, since)?.into_iter().map(|(k, amount, input, output)| json!({ "key": k, "amount": amount, "input": input, "output": output })).collect()) };
            let tickets = v.tickets()?;
            let projects: Vec<Value> = v
                .projects()?
                .iter()
                .map(|p| Ok(json!({ "id": p.id, "name": p.name, "day": v.cost_sum(Some(&p.id), day_start(now))?, "month": v.cost_sum(Some(&p.id), now - 30 * 86_400_000)? })))
                .collect::<Result<_>>()?;
            let members: Vec<Value> = v.members()?.iter().map(|m| json!({ "id": m.id, "name": m.name, "today": tickets.iter().filter(|t| t.by == m.id && t.created >= day_start(now)).count() })).collect();
            let unpriced = v.events_of_kind("cost_incurred", 500)?.iter().any(|e| matches!(e.event, Event::CostIncurred { priced: false, .. }));
            Ok(json!({
                "by_stage": rows("stage", now - 30 * 86_400_000)?, "by_model": rows("model", now - 30 * 86_400_000)?,
                "projects": projects, "members": members, "unpriced": unpriced,
                "limits": { "project_day": s.project_day, "project_month": s.project_month, "member_day": s.member_day, "budget": s.budget },
                "total_30d": v.cost_sum(None, now - 30 * 86_400_000)?, "total_today": v.cost_sum(None, day_start(now))?,
            }))
        })
    }

    /// Events of one kind as plain rows, newest first: the security log, notifications.
    pub fn view_log(&self, kind: &str) -> Result<Value> {
        self.store.read(|v| Ok(Value::Array(v.events_of_kind(kind, 300)?.into_iter().map(|e| serde_json::to_value(&e).unwrap_or_default()).collect())))
    }

    pub fn view_plan(&self, actor: &Actor, id: &str) -> Result<Value> {
        self.store.read(|v| {
            let plan = v.plan(id)?.ok_or_else(|| not_found(format!("找不到计划 {id}")))?;
            let state = |task: &PlanTask| -> Result<Value> {
                Ok(match &task.ticket {
                    Some(tid) => v.ticket(tid)?.map(|t| json!({ "id": t.id, "kind": t.stage.kind(), "state": t.state, "cost": t.cost, "pr": t.pr, "merged": t.merged_at.is_some() || t.stage == Stage::Done, "ready": t.contract_ok() })).unwrap_or(Value::Null),
                    None => Value::Null,
                })
            };
            let tasks: Vec<Value> = plan.tasks.iter().map(|t| Ok(json!({ "task": t, "project": plan.project_of(t), "ticket": state(t)? }))).collect::<Result<_>>()?;
            let spent: f64 = tasks.iter().filter_map(|t| t["ticket"]["cost"].as_f64()).sum();
            // a plan over several repositories: its pull requests are one group, merged in dependency order
            let projects = plan.projects();
            let group = if projects.len() > 1 {
                let order: Vec<Value> = tasks.iter().enumerate().filter(|(_, t)| !t["ticket"].is_null()).map(|(i, t)| json!({ "task": i + 1, "ticket": t["ticket"]["id"], "project": t["project"], "pr": t["ticket"]["pr"], "merged": t["ticket"]["merged"], "ready": t["ticket"]["ready"] })).collect();
                let all_started = tasks.iter().all(|t| !t["ticket"].is_null());
                let ready = all_started && order.iter().all(|o| o["merged"] == true || (o["ready"] == true && !o["pr"].is_null()));
                let next = order.iter().find(|o| o["merged"] != true).map(|o| o["ticket"].clone());
                json!({ "order": order, "ready": ready, "next": next })
            } else {
                Value::Null
            };
            Ok(json!({ "plan": plan, "tasks": tasks, "spent": spent, "budget": plan.budget(), "project_name": v.project(&plan.project)?.map(|p| p.name).unwrap_or_default(), "projects": projects, "group": group,
                "can": { "approve": projects.iter().all(|p| actor.can(Role::Approver, Some(p))) } }))
        })
    }

    pub fn view_memory(&self, actor: &Actor) -> Result<Value> {
        self.store.read(|v| {
            let proposals: Vec<Value> = v.memory_proposals()?.into_iter().map(|p| { let can = actor.can(Role::Approver, Some(&p.project)); json!({ "proposal": p, "can": can }) }).collect();
            Ok(json!({ "entries": v.memory(None)?, "proposals": proposals }))
        })
    }

    pub fn view_ops(&self) -> Result<Value> {
        self.store.read(|v| {
            Ok(json!({
                "draining": v.draining()?, "last_seq": v.last_seq()?, "sandbox_provider": self.sandbox.name(), "sandbox_isolated": self.sandbox.isolated(),
                "forge": self.forge.name(), "agent": self.cfg.worker.agent, "running": self.runs.lock().map(|r| r.keys().cloned().collect::<Vec<_>>()).unwrap_or_default(),
                "alerts": v.alerts()?.into_iter().map(|(key, since, text)| json!({ "key": key, "since": since, "text": text })).collect::<Vec<_>>(),
                "sandboxes": v.sandboxes()?, "feishu": std::env::var(&self.cfg.feishu.webhook_env).map(|u| !u.is_empty()).unwrap_or(false),
            }))
        })
    }
}

impl Engine {
    /// Prometheus text exposition.
    pub fn metrics(&self) -> Result<String> {
        let (pending, dead) = self.store.outbox_counts()?;
        self.store.read(|v| {
            let s = v.settings()?;
            let tickets = v.tickets()?;
            let mut out = String::from("# TYPE acw_tickets gauge\n");
            let mut by_stage: std::collections::BTreeMap<String, usize> = Default::default();
            for t in &tickets {
                *by_stage.entry(serde_json::to_value(t.stage)?.as_str().unwrap_or_default().to_owned()).or_default() += 1;
            }
            for (stage, n) in by_stage {
                out.push_str(&format!("acw_tickets{{stage=\"{stage}\"}} {n}\n"));
            }
            out.push_str("# TYPE acw_queue_items gauge\n");
            let mut by_kind: std::collections::BTreeMap<String, usize> = Default::default();
            for q in v.queue()? {
                *by_kind.entry(q.kind).or_default() += 1;
            }
            for (kind, n) in by_kind {
                out.push_str(&format!("acw_queue_items{{kind=\"{kind}\"}} {n}\n"));
            }
            for (name, value) in [
                ("acw_workers_used", tickets.iter().filter(|t| t.stage.is_active()).count() as f64),
                ("acw_workers_total", s.workers as f64),
                ("acw_sandboxes", v.sandboxes()?.len() as f64),
                ("acw_events_seq", v.last_seq()? as f64),
                ("acw_cost_today_yuan", v.cost_sum(None, day_start(now_ms()))?),
                ("acw_outbox_pending", pending as f64),
                ("acw_outbox_dead", dead as f64),
                ("acw_alerts_open", v.alerts()?.len() as f64),
                ("acw_draining", if v.draining()? { 1.0 } else { 0.0 }),
            ] {
                out.push_str(&format!("# TYPE {name} gauge\n{name} {value}\n"));
            }
            Ok(out)
        })
    }
}
