//! The Router. It keeps no conversation of its own: each message is judged from a complete,
//! stored input (message, sender and role, channel binding, thread memory, open tasks), so any
//! decision can be replayed later with another model or prompt and compared.
//!
//! What a sender is allowed to cause is decided by code, before and after the model:
//! a visitor only ever gets an answer; a mandate needs an approver when the project's rules say so.

use crate::commands::create_ticket_tx;
use crate::engine::*;
use crate::models::{StageError, Target};
use acw_core::*;
use acw_llm::{extract_json, Msg};
use anyhow::Result;
use regex::Regex;
use serde_json::json;

pub const PROMPT_VERSION: &str = "v1";

pub const ROUTER_PROMPT: &str = "你是 Auto-CodWorker 的 Router。每条消息独立判断，只根据给你的输入。只输出一个 JSON 对象。
字段：decision（answer | new_ticket | route_to_ticket | ask | stop_ticket）、project（项目 id 或 null）、ticket（任务编号或 null）、confidence（high | medium | low）、reply（给发送人的一句话）、why（判断依据，一句话）、mandate（decision 为 new_ticket 时必填：{goal, scope[], not[], accept[], assume[], open_question}，open_question 没有就填 null）。
规则：
- 提问、闲聊、查询 → answer，在 reply 里回答。
- 要改代码、加功能、修问题 → new_ticket。project 必须是输入里给出的项目之一：消息里写了项目名或别名就用它，其次用渠道绑定的项目；拿不准就 ask，在 reply 里问清楚。
- 明显是在补充或修改 open_tickets 里的某个任务 → route_to_ticket。
- 要求停掉某个任务 → stop_ticket。
- mandate.accept 写可以验证的验收标准；不确定的事写进 assume，不要编造需求。";

const VISITOR_PROMPT: &str = "你在回答一位没有登记为成员的人。你没有任何工具，不能开任务、不能改代码、不能查内部信息。只用一两句话回答问题本身；对方要求做事时，告诉他需要先请管理员登记为成员。";

pub struct Incoming {
    /// Member id, or a Feishu / GitHub handle, or a display name.
    pub sender: String,
    pub channel: String,
    pub thread: String,
    pub text: String,
}

fn ticket_re() -> Regex {
    Regex::new(r"T-\d+").expect("valid")
}

fn find_member(v: &View, sender: &str) -> Result<Option<Member>> {
    Ok(v.members()?.into_iter().find(|m| m.id == sender || m.name == sender || m.feishu.as_deref() == Some(sender) || m.github.as_deref() == Some(sender)))
}

/// Projects a text names, by name or alias.
fn named_projects<'a>(projects: &'a [Project], text: &str) -> Vec<&'a Project> {
    let low = text.to_lowercase();
    projects.iter().filter(|p| std::iter::once(&p.name).chain(p.aliases.iter()).any(|a| !a.is_empty() && low.contains(&a.to_lowercase()))).collect()
}

fn strip_names(projects: &[Project], text: &str) -> String {
    let mut t = text.to_lowercase();
    for p in projects {
        for a in std::iter::once(&p.name).chain(p.aliases.iter()) {
            if !a.is_empty() {
                t = t.replace(&a.to_lowercase(), "");
            }
        }
    }
    t.chars().filter(|c| c.is_alphanumeric()).collect()
}

fn out(decision: &str, confidence: &str, reply: impl Into<String>, why: impl Into<String>) -> RouteOutput {
    RouteOutput { decision: decision.into(), confidence: confidence.into(), reply: reply.into(), why: why.into(), ..Default::default() }
}

impl Engine {
    fn build_input(&self, msg: &Incoming) -> Result<(RouteInput, Option<Member>)> {
        self.store.read(|v| {
            let member = find_member(v, &msg.sender)?;
            let projects = v.projects()?;
            let bound = projects.iter().find(|p| p.channels.iter().any(|c| c == &msg.channel)).map(|p| p.id.clone());
            let role = member.as_ref().map(|m| m.role_for(bound.as_deref()));
            let thread = v.thread(&msg.thread)?;
            let open: Vec<(String, String)> = v
                .tickets()?
                .into_iter()
                .filter(|t| t.stage.is_open() && bound.as_ref().map(|b| &t.project == b).unwrap_or(true))
                .take(12)
                .map(|t| (t.id, t.title))
                .collect();
            let model = v.settings()?.stages.get("router").map(|m| m.model.clone()).unwrap_or_default();
            Ok((
                RouteInput {
                    text: msg.text.clone(),
                    sender: member.as_ref().map(|m| m.id.clone()).unwrap_or_else(|| msg.sender.clone()),
                    sender_role: role,
                    channel: msg.channel.clone(),
                    bound_project: bound,
                    thread: msg.thread.clone(),
                    thread_summary: thread.summary,
                    recent: thread.recent,
                    open_tickets: open,
                    model,
                    prompt_version: PROMPT_VERSION.into(),
                },
                member,
            ))
        })
    }

    /// Decide. Reads the stored input and the project cards; writes nothing, so it is safe to replay.
    pub async fn decide(&self, input: &RouteInput, only: Option<Target>, prompt: Option<&str>) -> Result<RouteOutput> {
        let projects = self.store.read(|v| v.projects())?;
        let text = input.text.trim();

        // 1. visitors: decided by code, not by the model
        if input.sender_role.unwrap_or(Role::Visitor) < Role::Requester {
            let reply = match self.stage_chat("router", None, &[Msg::system(VISITOR_PROMPT), Msg::user(text)], false, only.clone()).await {
                Ok(r) if !r.trim().is_empty() => r,
                _ => "你还没有登记为成员，我只能回答问题，不能开任务。需要改代码的话，请先让管理员把你登记为成员。".to_owned(),
            };
            return Ok(out("answer", "high", reply, "发送人没有登记为成员，按访客处理：只回答，不开任务"));
        }

        // 2. cheap rules that need no model
        if let Some(m) = ticket_re().find(text) {
            let id = m.as_str();
            if let Some(t) = self.store.read(|v| v.ticket(id))?.filter(|t| t.stage.is_open()) {
                let stop = ["停止", "停掉", "取消", "不做了", "stop", "cancel"].iter().any(|w| text.to_lowercase().contains(w));
                let mut o = if stop {
                    out("stop_ticket", "high", format!("好，停止 {id}。"), "消息里写了任务编号，并要求停止")
                } else {
                    out("route_to_ticket", "high", format!("已转给 {id}，Worker 下一轮会处理。"), "消息里写了任务编号")
                };
                o.ticket = Some(t.id);
                o.project = Some(t.project);
                return Ok(o);
            }
        }
        let rest = strip_names(&projects, text);
        let greeting = ["你好", "您好", "hi", "hello", "在吗", "谢谢", "感谢", "thanks", "ok", "好的"].iter().any(|g| rest == *g);
        if rest.chars().count() < 3 || greeting {
            return Ok(out("answer", "high", "在。想让我做什么？说清楚项目和要改的地方就行。", "问候、致谢，或只提了项目名没说要做什么"));
        }

        // 3. the model, when one is configured for the router stage
        let cards: Vec<_> = projects
            .iter()
            .map(|p| json!({ "id": p.id, "name": p.name, "aliases": p.aliases, "summary": p.summary, "modules": p.modules.iter().map(|m| &m.name).collect::<Vec<_>>() }))
            .collect();
        let user = json!({
            "message": text, "sender_role": input.sender_role, "channel_bound_project": input.bound_project,
            "thread_summary": input.thread_summary, "recent": input.recent, "projects": cards, "open_tickets": input.open_tickets,
        });
        match self.stage_chat("router", None, &[Msg::system(prompt.unwrap_or(ROUTER_PROMPT)), Msg::user(user.to_string())], true, only).await {
            Ok(reply) => {
                if let Ok(mut o) = extract_json(&reply).and_then(|v| Ok(serde_json::from_value::<RouteOutput>(v)?)) {
                    self.sanitize(&mut o, &projects)?;
                    return Ok(o);
                }
                Ok(out("ask", "low", "我没有判断清楚。是要在哪个项目里做什么？", "模型的输出不是约定的格式"))
            }
            Err(StageError::NotConfigured(_)) => self.decide_by_rules(input, &projects),
            Err(e) => Ok(out("answer", "low", format!("路由模型现在不可用（{e}）。稍后再发一次，或在消息里写明项目名和任务编号。"), "路由模型不可用")),
        }
    }

    /// The model proposes; this keeps only what refers to things that exist.
    fn sanitize(&self, o: &mut RouteOutput, projects: &[Project]) -> Result<()> {
        if !["answer", "new_ticket", "route_to_ticket", "ask", "stop_ticket"].contains(&o.decision.as_str()) {
            *o = out("ask", "low", "我没有判断清楚。是要在哪个项目里做什么？", "模型给了约定之外的决定");
            return Ok(());
        }
        if o.project.as_ref().is_some_and(|p| !projects.iter().any(|x| &x.id == p)) {
            o.project = None;
        }
        match o.decision.as_str() {
            "new_ticket" => {
                let goal_ok = o.mandate.as_ref().is_some_and(|m| !m.goal.trim().is_empty());
                if o.project.is_none() || !goal_ok || o.confidence == "low" {
                    let names: Vec<&str> = projects.iter().map(|p| p.name.as_str()).collect();
                    *o = RouteOutput { decision: "ask".into(), reply: format!("这个需求属于哪个项目？现在有：{}。", names.join("、")), why: format!("{}（拿不准归属，先问）", o.why), confidence: "low".into(), ..Default::default() };
                } else if let Some(m) = o.mandate.as_mut() {
                    // approval needs and approvals are never taken from the model
                    m.need_confirm = None;
                    m.confirmed_by.clear();
                    m.modules_hint.clear();
                    m.answer = None;
                }
            }
            "route_to_ticket" | "stop_ticket" => {
                let t = match &o.ticket {
                    Some(id) => self.store.read(|v| v.ticket(id))?.filter(|t| t.stage.is_open()),
                    None => None,
                };
                match t {
                    Some(t) => o.project = Some(t.project),
                    None => *o = out("ask", "low", "你说的是哪个任务？写一下任务编号。", "模型指的任务不存在或已结束"),
                }
            }
            _ => {}
        }
        Ok(())
    }

    /// With no router model configured: names and channel bindings only.
    fn decide_by_rules(&self, input: &RouteInput, projects: &[Project]) -> Result<RouteOutput> {
        let text = input.text.trim();
        let is_question = text.ends_with('?') || text.ends_with('？') || ["怎么", "为什么", "是否", "能不能告诉", "进度", "有哪些"].iter().any(|w| text.contains(w));
        if is_question {
            let list = if input.open_tickets.is_empty() { "现在没有未结束的任务。".to_owned() } else { format!("未结束的任务：{}。", input.open_tickets.iter().map(|(id, t)| format!("{id} {t}")).collect::<Vec<_>>().join("；")) };
            return Ok(out("answer", "medium", format!("{list}（没有配置路由模型，我只能回答任务进度。）"), "看起来是提问；没有配置路由模型"));
        }
        let named = named_projects(projects, text);
        let project = match (named.as_slice(), &input.bound_project) {
            ([one], _) => Some((*one).clone()),
            ([], Some(b)) => projects.iter().find(|p| &p.id == b).cloned(),
            ([], None) if projects.len() == 1 => projects.first().cloned(),
            _ => None,
        };
        let Some(p) = project else {
            let names: Vec<&str> = if named.len() > 1 { named.iter().map(|p| p.name.as_str()).collect() } else { projects.iter().map(|p| p.name.as_str()).collect() };
            return Ok(out("ask", "low", format!("这个需求属于哪个项目？{}。", names.join("、")), if named.len() > 1 { "消息同时匹配多个项目的别名" } else { "消息里没有项目名，渠道也没有绑定项目" }));
        };
        let why = if named.len() == 1 { format!("消息里写了 {} 的名字或别名", p.name) } else { format!("渠道绑定了 {}", p.name) };
        Ok(RouteOutput {
            decision: "new_ticket".into(),
            project: Some(p.id),
            confidence: "medium".into(),
            reply: String::new(),
            why,
            ticket: None,
            mandate: Some(Mandate { goal: text.to_owned(), scope: vec!["Worker 读完代码后补充".into()], accept: vec!["Worker 读完代码后补充，改动前会更新这里".into()], ..Default::default() }),
        })
    }

    /// Route one incoming message: decide, act, remember the thread, record the decision.
    pub async fn route(&self, msg: Incoming) -> Result<RouteRecord> {
        let (input, member) = self.build_input(&msg)?;
        let mut output = self.decide(&input, None, None).await?;
        if let (Some(p), Some(m)) = (output.project.clone(), output.mandate.as_mut()) {
            m.modules_hint = self.hint_modules(&p, &msg.text);
        }
        let actor = member.clone().map(Actor::member).unwrap_or_else(|| Actor::visitor(&msg.sender));
        let mut stop_id = None;

        let record = self.store.write(|tx| {
            let mut ticket = None;
            match output.decision.as_str() {
                "new_ticket" => {
                    let p = output.project.as_ref().and_then(|p| tx.view().project(p).transpose()).transpose()?;
                    match p.map(|p| create_ticket_tx(tx, &actor, &p, output.mandate.clone().unwrap_or_default(), &msg.channel, &msg.text, &|id| self.link(id))) {
                        Some(Ok(t)) => {
                            output.reply = if t.stage == Stage::MandatePending {
                                format!("已开任务 {}：{}。{}，确认后 Worker 才开工。", t.id, t.title, t.why)
                            } else {
                                format!("已开任务 {}：{}。", t.id, t.title)
                            };
                            ticket = Some(t.id);
                        }
                        Some(Err(e)) if e.downcast_ref::<CmdError>().is_some() => {
                            output = out("answer", "high", format!("没有开任务：{e}。"), "开任务被拒绝");
                        }
                        Some(Err(e)) => return Err(e),
                        None => output = out("ask", "low", "这个需求属于哪个项目？", "项目不存在"),
                    }
                }
                "route_to_ticket" => {
                    let id = output.ticket.clone().unwrap_or_default();
                    let t = tx.view().ticket(&id)?.ok_or_else(|| not_found("任务不存在"))?;
                    if !(actor.can(Role::Requester, Some(&t.project))) {
                        output = out("answer", "high", "你没有这个项目的提需求权限，消息没有转给任务。", "权限不足");
                    } else {
                        tx.emit(&actor.id, Some(&id), Event::InputQueued { input: Input { source: "member".into(), text: msg.text.clone(), trusted: true } })?;
                        match t.stage {
                            Stage::PrOpen | Stage::Failed => {
                                close_all_queue(tx, &id, "new_input")?;
                                set_stage(tx, "engine", &id, Stage::Queued, "排队中", "收到新的要求，继续改", Some(Stage::Provisioning))?;
                            }
                            Stage::Blocked if t.ask.as_ref().is_some_and(|a| a.kind == "ask") && actor.can(Role::Approver, Some(&t.project)) => {
                                tx.emit(&actor.id, Some(&id), Event::AskAnswered { by: actor.id.clone(), answer: msg.text.clone() })?;
                                close_queue(tx, &id, "ask", "answered")?;
                                set_stage(tx, "engine", &id, Stage::Queued, "排队中", "已回答，继续", Some(Stage::Working))?;
                            }
                            _ => {}
                        }
                        ticket = Some(id);
                    }
                }
                "stop_ticket" => {
                    stop_id = output.ticket.clone();
                    ticket = output.ticket.clone();
                }
                _ => {}
            }
            let record = RouteRecord { id: tx.view().next_route_id()?, at: tx.now(), input: input.clone(), output: output.clone(), ticket, wrong: false, moved: false };
            tx.emit("router", record.ticket.as_deref(), Event::MessageRouted { route: record.clone() })?;
            let mut thread = tx.view().thread(&msg.thread)?;
            thread.recent.push((input.sender.clone(), msg.text.clone()));
            thread.recent.push(("router".into(), output.reply.clone()));
            let extra = thread.recent.len().saturating_sub(12);
            thread.recent.drain(..extra);
            tx.emit("router", None, Event::ThreadUpdated { thread })?;
            Ok(record)
        })?;

        if let Some(id) = stop_id {
            if let Err(e) = self.stop(&actor, &id, "对话里要求停止") {
                tracing::info!("停止 {id} 被拒绝：{e}");
            }
        }
        self.kick();
        Ok(record)
    }

    /// Run a stored input again, optionally with another model or prompt. Changes nothing.
    pub async fn replay(&self, actor: &Actor, route_id: &str, target: Option<(String, String)>, prompt: Option<String>) -> Result<RouteOutput> {
        actor.require(Role::Approver, None, "重放路由")?;
        let r = self.store.read(|v| v.route(route_id))?.ok_or_else(|| not_found("没有这条路由记录"))?;
        let only = match target {
            Some((ep, model)) => {
                let endpoint = self.store.read(|v| v.endpoint(&ep))?.ok_or_else(|| not_found("没有这个接入"))?;
                if !endpoint.models.contains(&model) {
                    return Err(invalid("这个接入的模型列表里没有这个模型"));
                }
                let key = self.store.secret(&format!("endpoint:{ep}"))?;
                Some(Target { endpoint, model, key })
            }
            None => None,
        };
        self.decide(&r.input, only, prompt.as_deref()).await
    }
}
