//! Hot standby. One node takes commands (the primary); a follower pulls the primary's event log
//! and secret table and keeps its own projections current, read-only. Taking over is a person's
//! decision: `promote` makes the follower the primary under a new epoch and tells the old primary
//! to stop. A primary that learns of a newer epoch, from that call or from watching its peers,
//! fences itself: it refuses commands and cancels its running pipelines.
//!
//! This is not consensus. Nothing here elects a leader, and a primary cut off from its peers keeps
//! taking commands until it can see them again. Promote only when the old primary is known to be
//! down or reachable (so that it can be fenced).
//!
//! What a follower has: the log, the projections, the secrets. What it does not have: the outbox
//! (side effects not yet delivered on the old primary are not delivered by the new one), the git
//! mirrors and the artifacts (mirrors are rebuilt from the remote; task branches are already
//! there), and the sandboxes (rebuilt from the task branch, like after any loss of a sandbox).

use crate::engine::*;
use acw_core::*;
use anyhow::{anyhow, bail, Result};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicI64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum NodeRole {
    Primary = 0,
    Follower = 1,
    Fenced = 2,
}

impl NodeRole {
    pub fn name(self) -> &'static str {
        match self {
            NodeRole::Primary => "primary",
            NodeRole::Follower => "follower",
            NodeRole::Fenced => "fenced",
        }
    }
    fn parse(s: &str) -> NodeRole {
        match s {
            "follower" => NodeRole::Follower,
            "fenced" => NodeRole::Fenced,
            _ => NodeRole::Primary,
        }
    }
}

#[derive(Default)]
pub struct State {
    role: AtomicU8,
    /// The primary's last sequence number, as of the last successful pull.
    pub primary_seq: AtomicI64,
    pub last_contact: AtomicI64,
    pub problem: Mutex<String>,
}

impl Engine {
    pub fn role(&self) -> NodeRole {
        match self.standby.role.load(Ordering::SeqCst) {
            1 => NodeRole::Follower,
            2 => NodeRole::Fenced,
            _ => NodeRole::Primary,
        }
    }
    pub fn is_primary(&self) -> bool {
        self.role() == NodeRole::Primary
    }
    pub fn epoch(&self) -> u64 {
        self.store.meta("epoch").ok().flatten().and_then(|e| e.parse().ok()).unwrap_or(1)
    }

    fn set_role(&self, role: NodeRole) -> Result<()> {
        self.store.set_meta("role", role.name())?;
        self.store.set_read_only(role != NodeRole::Primary);
        self.standby.role.store(role as u8, Ordering::SeqCst);
        Ok(())
    }

    /// Decide what this node is when it starts. What it was last time wins over the configuration,
    /// so a promoted follower stays the primary across restarts and a fenced node stays fenced.
    pub fn init_role(&self) -> Result<()> {
        let role = match self.store.meta("role")? {
            Some(r) => NodeRole::parse(&r),
            None if self.cfg.standby.primary.trim().is_empty() => NodeRole::Primary,
            None => NodeRole::Follower,
        };
        if self.store.meta("epoch")?.is_none() {
            self.store.set_meta("epoch", "1")?;
        }
        self.set_role(role)
    }

    fn replica_token(&self) -> String {
        std::env::var(&self.cfg.standby.token_env).unwrap_or_default()
    }

    /// The replication endpoints take one shared token, not a member token.
    pub fn check_replica(&self, token: Option<&str>) -> Result<()> {
        let want = self.replica_token();
        match token {
            Some(t) if !want.is_empty() && t.len() == want.len() && t.bytes().zip(want.bytes()).fold(0u8, |a, (x, y)| a | (x ^ y)) == 0 => Ok(()),
            _ => Err(forbidden("需要复制令牌")),
        }
    }

    pub fn standby_status(&self) -> Result<Value> {
        let seq = self.store.read(|v| v.last_seq())?;
        let (primary_seq, last) = (self.standby.primary_seq.load(Ordering::SeqCst), self.standby.last_contact.load(Ordering::SeqCst));
        let role = self.role();
        Ok(json!({
            "role": role.name(), "epoch": self.epoch(), "seq": seq,
            "primary": self.cfg.standby.primary, "peers": self.cfg.standby.peers,
            "primary_seq": if role == NodeRole::Follower { Some(primary_seq) } else { None },
            "behind": if role == NodeRole::Follower { Some((primary_seq - seq).max(0)) } else { None },
            "last_contact": if last > 0 { Some(last) } else { None },
            "problem": self.standby.problem.lock().map(|p| p.clone()).unwrap_or_default(),
        }))
    }

    /// What a follower asks for: the rows after `after`, and the fingerprint of row `after` so it
    /// can tell whether its own log is a prefix of this one.
    pub fn replica_events(&self, after: i64, limit: i64) -> Result<Value> {
        let rows = self.store.raw_events(after, limit.clamp(1, 2000))?;
        let mark = if after > 0 { self.store.raw_event(after)?.map(|e| e.mark()) } else { None };
        Ok(json!({ "role": self.role().name(), "epoch": self.epoch(), "last": self.store.read(|v| v.last_seq())?, "mark": mark, "events": rows }))
    }

    async fn peer_get(&self, base: &str, path: &str) -> Result<Value> {
        let resp = self.http.get(format!("{}{path}", base.trim_end_matches('/'))).bearer_auth(self.replica_token()).timeout(Duration::from_secs(10)).send().await?;
        if !resp.status().is_success() {
            bail!("{} 返回 {}", base, resp.status().as_u16());
        }
        Ok(resp.json().await?)
    }

    /// One pull from the primary. Returns how many rows were applied.
    pub async fn follow_once(&self) -> Result<usize> {
        let primary = self.cfg.standby.primary.trim().to_owned();
        if primary.is_empty() {
            bail!("配置里没有主机地址（standby.primary）");
        }
        let mine = self.store.read(|v| v.last_seq())?;
        let v = self.peer_get(&primary, &format!("/replica/events?after={mine}&limit=500")).await?;
        if v["role"] != "primary" {
            bail!("对方不是主机（{}）", v["role"].as_str().unwrap_or("?"));
        }
        let (theirs, epoch) = (v["last"].as_i64().unwrap_or(0), v["epoch"].as_u64().unwrap_or(0));
        if epoch < self.epoch() {
            bail!("主机的任期（{epoch}）比这台备机见过的（{}）旧", self.epoch());
        }
        let my_mark = if mine > 0 { self.store.raw_event(mine)?.map(|e| e.mark()) } else { None };
        if mine > theirs || (mine > 0 && v["mark"].as_str().map(str::to_owned) != my_mark) {
            bail!("这台备机的日志和主机的不是同一条（在第 {mine} 条分叉）。清空这台的数据目录，重新从主机同步");
        }
        let rows: Vec<RawEvent> = serde_json::from_value(v["events"].clone())?;
        let n = rows.len();
        if n > 0 {
            self.store.replicate(&rows)?;
        }
        if epoch > self.epoch() {
            self.store.set_meta("epoch", &epoch.to_string())?;
        }
        self.standby.primary_seq.store(theirs, Ordering::SeqCst);
        self.standby.last_contact.store(now_ms(), Ordering::SeqCst);
        Ok(n)
    }

    pub async fn pull_secrets(&self) -> Result<()> {
        let v = self.peer_get(self.cfg.standby.primary.trim(), "/replica/secrets").await?;
        let all: Vec<(String, String)> = serde_json::from_value(v["secrets"].clone())?;
        self.store.replace_secrets(&all)
    }

    /// The follower's loop. Runs on every node; does nothing unless the node is a follower.
    pub async fn follow(self: Arc<Self>) {
        let mut round: u64 = 0;
        loop {
            if self.role() != NodeRole::Follower {
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
            let res = async {
                let n = self.follow_once().await?;
                if round.is_multiple_of(20) || n > 0 {
                    self.pull_secrets().await?;
                }
                Ok::<usize, anyhow::Error>(n)
            }
            .await;
            round += 1;
            let wait = match res {
                Ok(n) => {
                    if let Ok(mut p) = self.standby.problem.lock() {
                        p.clear();
                    }
                    if n >= 500 { 10 } else { 500 }
                }
                Err(e) => {
                    let text = e.to_string();
                    if let Ok(mut p) = self.standby.problem.lock() {
                        if *p != text {
                            tracing::warn!("从主机同步失败：{text}");
                        }
                        *p = text;
                    }
                    2000
                }
            };
            tokio::time::sleep(Duration::from_millis(wait)).await;
        }
    }

    /// Stop taking commands: a newer primary exists.
    pub fn fence(&self, by_epoch: u64) -> Result<bool> {
        if self.role() != NodeRole::Primary || by_epoch <= self.epoch() {
            return Ok(false);
        }
        self.set_role(NodeRole::Fenced)?;
        if let Ok(mut p) = self.standby.problem.lock() {
            *p = format!("已被任期 {by_epoch} 的新主机取代。这台不再接受操作；要重新加入，清空数据目录后作为备机启动");
        }
        if let Ok(runs) = self.runs.lock() {
            for r in runs.values() {
                r.cancel.cancel();
            }
        }
        tracing::error!("这台 Engine 已被任期 {by_epoch} 的新主机取代，停止接受操作");
        Ok(true)
    }

    /// A primary with peers looks at them; a peer that is a primary under a newer epoch wins.
    pub async fn watch_peers(&self) {
        if !self.is_primary() {
            return;
        }
        for peer in &self.cfg.standby.peers {
            if let Ok(v) = self.peer_get(peer, "/replica/status").await {
                if v["role"] == "primary" {
                    let _ = self.fence(v["epoch"].as_u64().unwrap_or(0));
                }
            }
        }
    }

    /// Make this follower the primary.
    pub async fn promote(self: &Arc<Self>, actor: &Actor) -> Result<Value> {
        actor.require(Role::Admin, None, "提升备机")?;
        if self.role() != NodeRole::Follower {
            return Err(conflict(format!("这台现在是{}，只有备机可以提升", match self.role() { NodeRole::Primary => "主机", _ => "被取代的旧主机" })));
        }
        // take whatever the old primary still gives
        let caught_up = match self.follow_once().await {
            Ok(_) => self.pull_secrets().await.is_ok(),
            Err(_) => false,
        };
        let epoch = self.epoch() + 1;
        self.store.set_meta("epoch", &epoch.to_string())?;
        self.set_role(NodeRole::Primary)?;
        if let Ok(mut p) = self.standby.problem.lock() {
            p.clear();
        }
        let seq = self.store.write(|tx| tx.emit(&actor.id, None, Event::Promoted { epoch, by: actor.id.clone() }))?;
        let primary = self.cfg.standby.primary.trim().trim_end_matches('/').to_owned();
        let fenced = match self.http.post(format!("{primary}/replica/fence")).bearer_auth(self.replica_token()).timeout(Duration::from_secs(10)).json(&json!({ "epoch": epoch })).send().await {
            Ok(r) if r.status().is_success() => r.json::<Value>().await.ok().is_some_and(|v| v["fenced"] == true),
            _ => false,
        };
        self.kick();
        Ok(json!({ "epoch": epoch, "seq": seq, "caught_up": caught_up, "old_primary_fenced": fenced,
            "note": if fenced { "旧主机已停止接受操作" } else { "没能通知到旧主机。确认它已经停机；它再启动时如果配置了 peers，会自己停止接受操作" } }))
    }
}

pub fn not_primary(role: NodeRole) -> anyhow::Error {
    anyhow!(match role {
        NodeRole::Follower => "这台是备机，只读。操作请发给主机；主机不在了，由管理员提升这台",
        _ => "这台已被新的主机取代，只读。操作请发给新的主机",
    })
}
