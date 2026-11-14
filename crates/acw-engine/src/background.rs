//! Things the Engine does on its own clock: deliver side effects, chase people about items that
//! have waited too long, and look for merged pull requests.

use crate::engine::*;
use acw_core::*;
use anyhow::Result;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;

impl Engine {
    async fn deliver(&self, effect: &Effect) -> Result<()> {
        match effect {
            Effect::Notify { kind, to, text, link } => {
                let names: Vec<String> = self.store.read(|v| Ok(to.iter().filter_map(|id| v.member(id).ok().flatten()).map(|m| m.name).collect()))?;
                let webhook = std::env::var(&self.cfg.feishu.webhook_env).ok().filter(|u| !u.is_empty());
                let full = format!("{}{text}\n{link}", names.iter().map(|n| format!("@{n} ")).collect::<String>());
                let sent = match &webhook {
                    Some(url) => {
                        let resp = self.http.post(url).timeout(Duration::from_secs(15)).json(&json!({ "msg_type": "text", "content": { "text": full } })).send().await?;
                        if !resp.status().is_success() {
                            anyhow::bail!("飞书返回 {}", resp.status().as_u16());
                        }
                        true
                    }
                    None => false,
                };
                self.store.write(|tx| tx.emit("engine", None, Event::Notified { kind: kind.clone(), to: names.join("、"), text: text.clone(), sent }).map(|_| ()))
            }
            Effect::DestroySandbox { id } => {
                self.sandbox.destroy(id).await?;
                self.store.write(|tx| {
                    if tx.view().sandboxes()?.iter().any(|s| &s.id == id) {
                        tx.emit("engine", None, Event::SandboxDestroyed { id: id.clone() })?;
                    }
                    Ok(())
                })
            }
        }
    }

    /// Effects were written in the same transaction as their cause; here they are carried out,
    /// at least once, with retries. Unsent ones survive a restart.
    pub async fn outbox(self: Arc<Self>) {
        loop {
            if !self.is_primary() {
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
            match self.store.due_effects(20) {
                Ok(list) => {
                    for (id, effect, _tries) in list {
                        let res = match self.deliver(&effect).await {
                            Ok(()) => self.store.effect_done(id),
                            Err(e) => {
                                tracing::warn!("副作用 {id} 执行失败：{e}");
                                self.store.effect_failed(id, &e.to_string(), 8)
                            }
                        };
                        if let Err(e) = res {
                            tracing::error!("更新副作用 {id} 的状态失败：{e}");
                        }
                    }
                }
                Err(e) => tracing::error!("读取待执行的副作用失败：{e}"),
            }
            tokio::time::sleep(Duration::from_millis(700)).await;
        }
    }

    /// Remind at half the time limit; at the limit, escalate to everyone who could act plus the admins.
    pub fn chase(&self) -> Result<()> {
        self.store.write(|tx| {
            let s = tx.view().settings()?;
            let now = tx.now();
            for q in tx.view().queue()? {
                let limit = s.sla.get(&q.kind).copied().unwrap_or(60) as i64 * 60_000;
                let age = now - q.since;
                let owners_now: Vec<String> = match &q.hand_to {
                    Some(to) => vec![to.clone()],
                    None => owners(&tx.view(), q.need, &q.project, q.also.as_deref())?,
                };
                if age >= limit && !q.escalated {
                    let mut to = owners(&tx.view(), q.need, &q.project, q.also.as_deref())?;
                    to.extend(tx.view().members()?.into_iter().filter(|m| m.role_for(None) == Role::Admin).map(|m| m.id));
                    to.sort();
                    to.dedup();
                    tx.emit("engine", Some(&q.ticket), Event::QueueEscalated { id: q.id.clone(), to: to.clone() })?;
                    tx.effect(Effect::Notify { kind: q.kind.clone(), to, text: format!("超时未处理：{}（{}）", q.title, q.why.lines().next().unwrap_or_default()), link: self.link(&q.ticket) })?;
                } else if age >= limit / 2 && !q.reminded && !q.escalated {
                    tx.emit("engine", Some(&q.ticket), Event::QueueReminded { id: q.id.clone(), to: owners_now.clone() })?;
                    tx.effect(Effect::Notify { kind: q.kind.clone(), to: owners_now, text: format!("还在等你：{}", q.title), link: self.link(&q.ticket) })?;
                }
            }
            Ok(())
        })
    }

    /// Conditions an operator should hear about. Each is raised once and cleared when it is over.
    pub fn watch(&self) -> Result<()> {
        let (_, dead) = self.store.outbox_counts()?;
        self.store.write(|tx| {
            let s = tx.view().settings()?;
            let now = tx.now();
            let mut active: Vec<(String, String)> = Vec::new();
            if dead > 0 {
                active.push(("outbox".into(), format!("有 {dead} 个通知或清理动作重试多次仍然失败")));
            }
            let stuck_after = (self.cfg.worker.run_minutes + self.cfg.worker.idle_minutes) as i64 * 60_000;
            for t in tx.view().tickets()?.iter().filter(|t| t.stage.is_active() && t.stage != Stage::Waiting && now - t.updated > stuck_after) {
                active.push((format!("stuck:{}", t.id), format!("{} 超过 {} 分钟没有任何进展", t.id, stuck_after / 60_000)));
            }
            for p in tx.view().projects()? {
                let day = tx.view().cost_sum(Some(&p.id), day_start(now))?;
                if day >= s.project_day * 0.8 {
                    active.push((format!("quota:{}", p.id), format!("{} 今天已用 ¥{day:.0}，到了每日额度 ¥{:.0} 的 80%", p.name, s.project_day)));
                }
            }
            let open = tx.view().alerts()?;
            let admins: Vec<String> = tx.view().members()?.into_iter().filter(|m| m.role_for(None) == Role::Admin).map(|m| m.id).collect();
            for (key, text) in &active {
                if !open.iter().any(|(k, _, _)| k == key) {
                    tx.emit("engine", None, Event::AlertRaised { key: key.clone(), text: text.clone() })?;
                    tx.effect(Effect::Notify { kind: "alert".into(), to: admins.clone(), text: format!("告警：{text}"), link: format!("{}/#ops", self.cfg.public_url.trim_end_matches('/')) })?;
                }
            }
            for (key, _, _) in open {
                if !active.iter().any(|(k, _)| k == &key) {
                    tx.emit("engine", None, Event::AlertCleared { key })?;
                }
            }
            Ok(())
        })
    }

    /// Delete what was kept outside the event log (generated tests, agent sessions) once a finished
    /// task is older than the retention period. Tasks that did not merge are kept longer.
    pub async fn sweep_artifacts(&self) -> Result<u32> {
        let s = self.settings()?;
        let now = now_ms();
        let mut removed = 0;
        let Ok(mut rd) = tokio::fs::read_dir(self.cfg.data_dir.join("artifacts")).await else { return Ok(0) };
        while let Some(entry) = rd.next_entry().await? {
            let id = entry.file_name().to_string_lossy().into_owned();
            let Some(t) = self.store.read(|v| v.ticket(&id))? else { continue };
            let days = match t.stage {
                Stage::Done => s.artifacts_keep_days,
                Stage::Dropped => s.fail_keep_days,
                _ => continue,
            };
            if now - t.updated > days as i64 * 86_400_000 {
                tokio::fs::remove_dir_all(entry.path()).await?;
                removed += 1;
            }
        }
        Ok(removed)
    }

    pub async fn clock(self: Arc<Self>) {
        let mut tick: u64 = 0;
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if !self.is_primary() {
                continue;
            }
            if tick.is_multiple_of(5) && !self.cfg.standby.peers.is_empty() {
                self.watch_peers().await;
            }
            let merged: Vec<String> = self.merged.lock().map(|mut m| std::mem::take(&mut *m)).unwrap_or_default();
            for id in merged {
                // the base branch just changed: refresh the code index of that project
                if let Ok(t) = self.ticket(&id) {
                    if self.store.read(|v| v.index_info(&t.project)).ok().flatten().is_some() {
                        let (eng, project) = (self.clone(), t.project.clone());
                        tokio::spawn(async move {
                            if let Err(e) = eng.build_index(&project).await {
                                tracing::warn!("重建 {project} 的代码索引失败：{e}");
                            }
                        });
                    }
                }
                tokio::spawn(self.clone().propose_memory(id));
            }
            tick += 1;
            if tick.is_multiple_of(30) {
                if let Err(e) = self.check_rollouts().await {
                    tracing::warn!("检查上线阶段出错：{e}");
                }
            }
            if tick.is_multiple_of(30) {
                if let Err(e) = self.chase() {
                    tracing::error!("检查时限出错：{e}");
                }
            }
            if tick.is_multiple_of(60) {
                if let Err(e) = self.watch() {
                    tracing::error!("检查告警条件出错：{e}");
                }
            }
            if tick.is_multiple_of(3600) {
                if let Err(e) = self.sweep_artifacts().await {
                    tracing::warn!("清理过期产物出错：{e}");
                }
            }
            if tick.is_multiple_of(self.cfg.forge.poll_seconds.max(5)) {
                if let Err(e) = self.poll_prs().await {
                    tracing::warn!("查询 PR 状态出错：{e}");
                }
            }
        }
    }
}
