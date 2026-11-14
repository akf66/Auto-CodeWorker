//! Project memory: what a finished task taught, kept for the next ones.
//! A model proposes; only an approver's acceptance makes it memory. Accepted entries are read to
//! the Worker and the Reviewer as part of their instructions, which is why they need a person.

use crate::engine::*;
use acw_core::*;
use acw_llm::{extract_json, Msg};
use anyhow::Result;
use serde_json::json;
use std::sync::Arc;

const MEMORY_PROMPT: &str = "一个任务刚合并。根据它的需求单、审查中被证实的问题、人给过的回答和要求，提炼出对这个项目以后的任务仍然成立的经验，最多 2 条，写成一句可以直接照做的项目记忆。只写这个项目特有的约定或容易踩的坑；一般的编程常识、只和这一个任务有关的细节都不要。没有值得记的就返回空数组。只输出 JSON：{\"lessons\":[{\"text\":\"…\",\"why\":\"从哪里看出来的\"}]}。";

impl Engine {
    /// After a merge: ask for lessons and put them in front of the approvers. Never blocks anything.
    pub async fn propose_memory(self: Arc<Self>, ticket: String) {
        let Ok(t) = self.ticket(&ticket) else { return };
        let events = self.store.read(|v| v.events_for(&ticket)).unwrap_or_default();
        let human: Vec<String> = events
            .iter()
            .filter_map(|e| match &e.event {
                Event::AskAnswered { answer, .. } => Some(format!("回答：{answer}")),
                Event::InputQueued { input } if input.trusted && input.source == "member" => Some(input.text.clone()),
                _ => None,
            })
            .collect();
        let findings: Vec<_> = t.review.findings.iter().filter(|f| f.confirmed && f.status != "false_positive").map(|f| json!({ "title": f.title, "file": f.file, "evidence": f.evidence })).collect();
        if findings.is_empty() && human.is_empty() {
            return;
        }
        let known: Vec<String> = self.store.read(|v| v.memory(Some(&t.project))).unwrap_or_default().into_iter().map(|m| m.text).collect();
        let user = json!({ "goal": t.mandate.goal, "confirmed_findings": findings, "from_people": human, "already_in_memory": known });
        let Ok(reply) = self.stage_chat("reviewer", Some(&ticket), &[Msg::system(MEMORY_PROMPT), Msg::user(user.to_string())], true, None).await else { return };
        let lessons: Vec<(String, String)> = extract_json(&reply)
            .ok()
            .and_then(|v| v.get("lessons").and_then(|l| l.as_array().cloned()))
            .unwrap_or_default()
            .into_iter()
            .filter_map(|l| Some((l.get("text")?.as_str()?.trim().to_owned(), l.get("why").and_then(|w| w.as_str()).unwrap_or_default().to_owned())))
            .filter(|(text, _)| !text.is_empty() && !known.contains(text))
            .take(2)
            .collect();
        if lessons.is_empty() {
            return;
        }
        let link = format!("{}/#memory", self.cfg.public_url.trim_end_matches('/'));
        let res = self.store.write(|tx| {
            for (text, why) in &lessons {
                let proposal = MemoryProposal { id: tx.view().next_id("memory_proposal", "MP-")?, project: t.project.clone(), text: text.clone(), why: why.clone(), from: ticket.clone(), at: tx.now() };
                tx.emit("reviewer", Some(&ticket), Event::MemoryProposed { proposal })?;
            }
            if tx.view().settings()?.notify.get("memory").copied().unwrap_or(false) {
                let to = owners(&tx.view(), Role::Approver, &t.project, None)?;
                tx.effect(Effect::Notify { kind: "memory".into(), to, text: format!("{ticket} 合并后有 {} 条项目记忆提议等审核", lessons.len()), link })?;
            }
            Ok(())
        });
        if let Err(e) = res {
            tracing::warn!("记录 {ticket} 的记忆提议失败：{e}");
        }
    }

    pub fn accept_memory(&self, actor: &Actor, proposal: &str, text: Option<&str>) -> Result<Memory> {
        self.store.write(|tx| {
            let p = tx.view().memory_proposals()?.into_iter().find(|p| p.id == proposal).ok_or_else(|| not_found("这条提议已经处理过了"))?;
            actor.require(Role::Approver, Some(&p.project), "采纳项目记忆")?;
            let text = text.map(str::trim).filter(|t| !t.is_empty()).unwrap_or(&p.text).to_owned();
            let memory = Memory { id: tx.view().next_id("memory", "L-")?, project: p.project, text, from: p.from.clone(), by: actor.id.clone(), at: tx.now() };
            tx.emit(&actor.id, Some(&p.from), Event::MemoryAccepted { proposal: proposal.to_owned(), memory: memory.clone() })?;
            Ok(memory)
        })
    }

    pub fn reject_memory(&self, actor: &Actor, proposal: &str, reason: &str) -> Result<()> {
        self.store.write(|tx| {
            let p = tx.view().memory_proposals()?.into_iter().find(|p| p.id == proposal).ok_or_else(|| not_found("这条提议已经处理过了"))?;
            actor.require(Role::Approver, Some(&p.project), "处理项目记忆")?;
            tx.emit(&actor.id, Some(&p.from), Event::MemoryRejected { proposal: proposal.to_owned(), by: actor.id.clone(), reason: reason.to_owned() }).map(|_| ())
        })
    }

    pub fn remove_memory(&self, actor: &Actor, id: &str) -> Result<()> {
        self.store.write(|tx| {
            let m = tx.view().memory(None)?.into_iter().find(|m| m.id == id).ok_or_else(|| not_found("没有这条记忆"))?;
            actor.require(Role::Approver, Some(&m.project), "删除项目记忆")?;
            tx.emit(&actor.id, None, Event::MemoryRemoved { id: id.to_owned() }).map(|_| ())
        })
    }
}
