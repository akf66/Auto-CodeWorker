//! Single-writer event store on SQLite.
//!
//! A command is one closure run inside one transaction: it reads projections, decides, emits
//! events (each applied to the projections at once, so later reads in the same command see it)
//! and enqueues side effects. Commit publishes the events to subscribers. Nothing else writes.

use crate::event::{Effect, Event, StoredEvent};
use crate::model::*;
use crate::projection::{self, get_doc, list_docs};
use anyhow::{anyhow, Result};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tokio::sync::broadcast;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS events(
  seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, ticket TEXT, actor TEXT NOT NULL,
  kind TEXT NOT NULL, body TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ev_ticket ON events(ticket, seq);
CREATE INDEX IF NOT EXISTS ev_kind ON events(kind, seq);
CREATE TABLE IF NOT EXISTS doc(kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind, id));
CREATE TABLE IF NOT EXISTS cost(
  seq INTEGER PRIMARY KEY, ts INTEGER NOT NULL, ticket TEXT, project TEXT, stage TEXT NOT NULL,
  model TEXT NOT NULL, input INTEGER NOT NULL, output INTEGER NOT NULL, amount REAL NOT NULL);
CREATE TABLE IF NOT EXISTS outbox(
  id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
  tries INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, error TEXT);
CREATE TABLE IF NOT EXISTS secret(name TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
";

pub struct Store {
    conn: Mutex<Connection>,
    bus: broadcast::Sender<StoredEvent>,
    /// Set on a standby and on a node that was superseded: commands are refused.
    read_only: AtomicBool,
}

/// The error of a command on a store that does not take commands.
#[derive(Debug)]
pub struct ReadOnly;
impl std::fmt::Display for ReadOnly {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("这台 Engine 现在只读：它是备机，或者已经被新的主机取代")
    }
}
impl std::error::Error for ReadOnly {}

/// One row of the log as it is stored, for shipping to a standby byte for byte.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
pub struct RawEvent {
    pub seq: i64,
    pub ts: Ms,
    pub ticket: Option<String>,
    pub actor: String,
    pub kind: String,
    pub body: String,
}

impl RawEvent {
    /// A fingerprint to tell two logs apart at one position (FNV-1a; not a security measure).
    pub fn mark(&self) -> String {
        let mut h: u64 = 0xcbf29ce484222325;
        for b in format!("{}|{}|{}", self.ts, self.actor, self.body).bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        format!("{h:016x}")
    }
}

/// Read access to the projections and the log.
pub struct View<'a>(pub &'a Connection);

/// A command in progress.
pub struct Tx<'a> {
    tx: rusqlite::Transaction<'a>,
    emitted: Vec<StoredEvent>,
    now: Ms,
}

fn row_to_event(seq: i64, ts: Ms, ticket: Option<String>, actor: String, body: String) -> Result<StoredEvent> {
    Ok(StoredEvent { seq, ts, ticket, actor, event: serde_json::from_str(&body)? })
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.execute_batch(SCHEMA)?;
        let (bus, _) = broadcast::channel(4096);
        Ok(Store { conn: Mutex::new(conn), bus, read_only: AtomicBool::new(false) })
    }

    pub fn memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(SCHEMA)?;
        let (bus, _) = broadcast::channel(4096);
        Ok(Store { conn: Mutex::new(conn), bus, read_only: AtomicBool::new(false) })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<StoredEvent> {
        self.bus.subscribe()
    }

    /// Run a command. On `Err` nothing is written and nothing is published.
    pub fn write<R>(&self, f: impl FnOnce(&mut Tx) -> Result<R>) -> Result<R> {
        if self.read_only.load(Ordering::SeqCst) {
            return Err(ReadOnly.into());
        }
        let mut conn = self.conn.lock().map_err(|_| anyhow!("store lock poisoned"))?;
        let tx = conn.transaction()?;
        let mut t = Tx { tx, emitted: Vec::new(), now: now_ms() };
        let out = f(&mut t)?;
        let Tx { tx, emitted, .. } = t;
        tx.commit()?;
        for e in emitted {
            let _ = self.bus.send(e);
        }
        Ok(out)
    }

    pub fn read<R>(&self, f: impl FnOnce(&View) -> Result<R>) -> Result<R> {
        let conn = self.conn.lock().map_err(|_| anyhow!("store lock poisoned"))?;
        f(&View(&conn))
    }

    /// Drop every projection and replay the log. Side effects are not replayed.
    pub fn rebuild(&self) -> Result<u64> {
        let mut conn = self.conn.lock().map_err(|_| anyhow!("store lock poisoned"))?;
        let tx = conn.transaction()?;
        tx.execute_batch("DELETE FROM doc; DELETE FROM cost;")?;
        let mut n = 0;
        {
            let mut st = tx.prepare("SELECT seq, ts, ticket, actor, body FROM events ORDER BY seq")?;
            let mut rows = st.query([])?;
            while let Some(r) = rows.next()? {
                let e = row_to_event(r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)?;
                projection::apply(&tx, &e)?;
                n += 1;
            }
        }
        tx.commit()?;
        Ok(n)
    }

    // ---- standby: role and epoch, shipping the log

    pub fn set_read_only(&self, on: bool) {
        self.read_only.store(on, Ordering::SeqCst);
    }
    pub fn is_read_only(&self) -> bool {
        self.read_only.load(Ordering::SeqCst)
    }
    pub fn meta(&self, k: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().map_err(|_| anyhow!("store lock poisoned"))?;
        Ok(conn.query_row("SELECT v FROM meta WHERE k=?1", params![k], |r| r.get(0)).optional()?)
    }
    pub fn set_meta(&self, k: &str, v: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| anyhow!("store lock poisoned"))?;
        conn.execute("INSERT INTO meta(k,v) VALUES(?1,?2) ON CONFLICT(k) DO UPDATE SET v=excluded.v", params![k, v])?;
        Ok(())
    }
    /// Rows after `after`, oldest first.
    pub fn raw_events(&self, after: i64, limit: i64) -> Result<Vec<RawEvent>> {
        let conn = self.conn.lock().map_err(|_| anyhow!("store lock poisoned"))?;
        let mut st = conn.prepare("SELECT seq, ts, ticket, actor, kind, body FROM events WHERE seq>?1 ORDER BY seq LIMIT ?2")?;
        let rows = st.query_map(params![after, limit], |r| Ok(RawEvent { seq: r.get(0)?, ts: r.get(1)?, ticket: r.get(2)?, actor: r.get(3)?, kind: r.get(4)?, body: r.get(5)? }))?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }
    pub fn raw_event(&self, seq: i64) -> Result<Option<RawEvent>> {
        Ok(self.raw_events(seq - 1, 1)?.into_iter().find(|e| e.seq == seq))
    }
    /// Append rows shipped from the primary, as they are, and fold them into the projections.
    /// No side effects are queued: those belong to the node that took the command. The rows must
    /// continue this log exactly; otherwise nothing is written.
    pub fn replicate(&self, rows: &[RawEvent]) -> Result<i64> {
        let mut conn = self.conn.lock().map_err(|_| anyhow!("store lock poisoned"))?;
        let tx = conn.transaction()?;
        let mut last: i64 = tx.query_row("SELECT COALESCE(MAX(seq),0) FROM events", [], |r| r.get(0))?;
        let mut applied = Vec::new();
        for r in rows {
            if r.seq != last + 1 {
                return Err(anyhow!("复制的事件不连续：本地到 {last}，收到 {}", r.seq));
            }
            tx.execute("INSERT INTO events(seq,ts,ticket,actor,kind,body) VALUES(?1,?2,?3,?4,?5,?6)", params![r.seq, r.ts, r.ticket, r.actor, r.kind, r.body])?;
            let e = row_to_event(r.seq, r.ts, r.ticket.clone(), r.actor.clone(), r.body.clone())?;
            projection::apply(&tx, &e)?;
            applied.push(e);
            last = r.seq;
        }
        tx.commit()?;
        for e in applied {
            let _ = self.bus.send(e);
        }
        Ok(last)
    }
    pub fn all_secrets(&self) -> Result<Vec<(String, String)>> {
        let conn = self.conn.lock().map_err(|_| anyhow!("store lock poisoned"))?;
        let mut st = conn.prepare("SELECT name, value FROM secret ORDER BY name")?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }
    /// Make the secret table equal to the primary's.
    pub fn replace_secrets(&self, all: &[(String, String)]) -> Result<()> {
        let mut conn = self.conn.lock().map_err(|_| anyhow!("store lock poisoned"))?;
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM secret", [])?;
        for (k, v) in all {
            tx.execute("INSERT INTO secret(name,value) VALUES(?1,?2)", params![k, v])?;
        }
        tx.commit()?;
        Ok(())
    }

    // ---- secrets: never in events, never in a sandbox

    pub fn set_secret(&self, name: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| anyhow!("store lock poisoned"))?;
        conn.execute("INSERT INTO secret(name,value) VALUES(?1,?2) ON CONFLICT(name) DO UPDATE SET value=excluded.value", params![name, value])?;
        Ok(())
    }
    pub fn secret(&self, name: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().map_err(|_| anyhow!("store lock poisoned"))?;
        Ok(conn.query_row("SELECT value FROM secret WHERE name=?1", params![name], |r| r.get(0)).optional()?)
    }
    pub fn secret_name_for(&self, prefix: &str, value: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().map_err(|_| anyhow!("store lock poisoned"))?;
        Ok(conn
            .query_row("SELECT name FROM secret WHERE name LIKE ?1 || '%' AND value=?2", params![prefix, value], |r| r.get(0))
            .optional()?)
    }
    pub fn del_secret(&self, name: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| anyhow!("store lock poisoned"))?;
        conn.execute("DELETE FROM secret WHERE name=?1", params![name])?;
        Ok(())
    }

    // ---- outbox

    pub fn due_effects(&self, limit: usize) -> Result<Vec<(i64, Effect, u32)>> {
        let conn = self.conn.lock().map_err(|_| anyhow!("store lock poisoned"))?;
        let mut st = conn.prepare("SELECT id, body, tries FROM outbox WHERE state='pending' AND next_at<=?1 ORDER BY id LIMIT ?2")?;
        let rows = st.query_map(params![now_ms(), limit as i64], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, u32>(2)?)))?;
        let mut out = Vec::new();
        for row in rows {
            let (id, body, tries) = row?;
            out.push((id, serde_json::from_str(&body)?, tries));
        }
        Ok(out)
    }
    /// (waiting to be delivered, given up on)
    pub fn outbox_counts(&self) -> Result<(i64, i64)> {
        let conn = self.conn.lock().map_err(|_| anyhow!("store lock poisoned"))?;
        let n = |state: &str| conn.query_row("SELECT COUNT(*) FROM outbox WHERE state=?1", params![state], |r| r.get::<_, i64>(0));
        Ok((n("pending")?, n("dead")?))
    }
    pub fn effect_done(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| anyhow!("store lock poisoned"))?;
        conn.execute("UPDATE outbox SET state='done' WHERE id=?1", params![id])?;
        Ok(())
    }
    /// Retry with backoff; give up after `max_tries`.
    pub fn effect_failed(&self, id: i64, err: &str, max_tries: u32) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| anyhow!("store lock poisoned"))?;
        conn.execute(
            "UPDATE outbox SET tries=tries+1, error=?2, next_at=?3 + 5000 * (1 << MIN(tries, 8)),
             state=CASE WHEN tries+1>=?4 THEN 'dead' ELSE 'pending' END WHERE id=?1",
            params![id, err, now_ms(), max_tries],
        )?;
        Ok(())
    }
}

impl<'a> Tx<'a> {
    pub fn view(&self) -> View<'_> {
        View(&self.tx)
    }
    pub fn now(&self) -> Ms {
        self.now
    }
    /// Append one event and fold it into the projections.
    pub fn emit(&mut self, actor: &str, ticket: Option<&str>, event: Event) -> Result<i64> {
        let body = serde_json::to_string(&event)?;
        self.tx.execute(
            "INSERT INTO events(ts,ticket,actor,kind,body) VALUES(?1,?2,?3,?4,?5)",
            params![self.now, ticket, actor, event.kind(), body],
        )?;
        let seq = self.tx.last_insert_rowid();
        let stored = StoredEvent { seq, ts: self.now, ticket: ticket.map(str::to_owned), actor: actor.to_owned(), event };
        projection::apply(&self.tx, &stored)?;
        self.emitted.push(stored);
        Ok(seq)
    }
    pub fn effect(&mut self, effect: Effect) -> Result<()> {
        self.tx.execute("INSERT INTO outbox(body) VALUES(?1)", params![serde_json::to_string(&effect)?])?;
        Ok(())
    }
}

impl<'a> View<'a> {
    pub fn ticket(&self, id: &str) -> Result<Option<Ticket>> {
        get_doc(self.0, "ticket", id)
    }
    pub fn tickets(&self) -> Result<Vec<Ticket>> {
        let mut v: Vec<Ticket> = list_docs(self.0, "ticket")?;
        v.sort_by_key(|t| std::cmp::Reverse(ticket_no(&t.id)));
        Ok(v)
    }
    pub fn project(&self, id: &str) -> Result<Option<Project>> {
        get_doc(self.0, "project", id)
    }
    pub fn projects(&self) -> Result<Vec<Project>> {
        list_docs(self.0, "project")
    }
    pub fn member(&self, id: &str) -> Result<Option<Member>> {
        get_doc(self.0, "member", id)
    }
    pub fn members(&self) -> Result<Vec<Member>> {
        list_docs(self.0, "member")
    }
    pub fn settings(&self) -> Result<Settings> {
        Ok(get_doc(self.0, "settings", "current")?.unwrap_or_default())
    }
    pub fn endpoint(&self, id: &str) -> Result<Option<Endpoint>> {
        get_doc(self.0, "endpoint", id)
    }
    pub fn endpoints(&self) -> Result<Vec<Endpoint>> {
        list_docs(self.0, "endpoint")
    }
    pub fn queue(&self) -> Result<Vec<QueueItem>> {
        let mut v: Vec<QueueItem> = list_docs(self.0, "queue")?;
        v.sort_by_key(|q| q.since);
        Ok(v)
    }
    pub fn queue_item(&self, id: &str) -> Result<Option<QueueItem>> {
        get_doc(self.0, "queue", id)
    }
    pub fn sandboxes(&self) -> Result<Vec<SandboxInfo>> {
        list_docs(self.0, "sandbox")
    }
    pub fn route(&self, id: &str) -> Result<Option<RouteRecord>> {
        get_doc(self.0, "route", id)
    }
    pub fn routes(&self) -> Result<Vec<RouteRecord>> {
        let mut v: Vec<RouteRecord> = list_docs(self.0, "route")?;
        v.sort_by_key(|r| std::cmp::Reverse(r.at));
        Ok(v)
    }
    pub fn thread(&self, id: &str) -> Result<Thread> {
        Ok(get_doc(self.0, "thread", id)?.unwrap_or(Thread { id: id.to_owned(), ..Default::default() }))
    }
    pub fn inbound_seen(&self, source: &str, id: &str) -> Result<bool> {
        Ok(get_doc::<Ms>(self.0, "inbound", &format!("{source}:{id}"))?.is_some())
    }
    pub fn eval_cases(&self) -> Result<Vec<EvalCase>> {
        list_docs(self.0, "eval_case")
    }
    /// Newest first.
    pub fn eval_runs(&self) -> Result<Vec<EvalRun>> {
        let mut v: Vec<EvalRun> = list_docs(self.0, "eval_run")?;
        v.sort_by_key(|r| std::cmp::Reverse(r.at));
        Ok(v)
    }
    pub fn env_plan(&self, project: &str) -> Result<Option<EnvPlan>> {
        get_doc(self.0, "env", project)
    }
    pub fn env_history(&self, project: &str) -> Result<Vec<EnvPlan>> {
        Ok(list_docs::<EnvPlan>(self.0, "env_history")?.into_iter().filter(|p| p.project == project).collect())
    }
    pub fn env_proposals(&self) -> Result<Vec<EnvProposal>> {
        list_docs(self.0, "env_proposal")
    }
    pub fn env_proposal(&self, id: &str) -> Result<Option<EnvProposal>> {
        get_doc(self.0, "env_proposal", id)
    }
    pub fn index_info(&self, project: &str) -> Result<Option<IndexInfo>> {
        get_doc(self.0, "index", project)
    }
    pub fn plan(&self, id: &str) -> Result<Option<Plan>> {
        get_doc(self.0, "plan", id)
    }
    pub fn plans(&self) -> Result<Vec<Plan>> {
        let mut v: Vec<Plan> = list_docs(self.0, "plan")?;
        v.sort_by_key(|p| std::cmp::Reverse(p.created));
        Ok(v)
    }
    pub fn memory(&self, project: Option<&str>) -> Result<Vec<Memory>> {
        let mut v: Vec<Memory> = list_docs(self.0, "memory")?;
        v.retain(|m| project.is_none_or(|p| m.project == p));
        v.sort_by_key(|m| m.at);
        Ok(v)
    }
    pub fn memory_proposals(&self) -> Result<Vec<MemoryProposal>> {
        let mut v: Vec<MemoryProposal> = list_docs(self.0, "memory_proposal")?;
        v.sort_by_key(|m| m.at);
        Ok(v)
    }
    /// Next id in a `<prefix><n>` series of documents.
    pub fn next_id(&self, kind: &str, prefix: &str) -> Result<String> {
        let n: i64 = self.0.query_row("SELECT COALESCE(MAX(CAST(SUBSTR(id,?2) AS INTEGER)),0) FROM doc WHERE kind=?1", params![kind, prefix.len() as i64 + 1], |r| r.get(0))?;
        Ok(format!("{prefix}{}", n + 1))
    }
    /// Open alerts: (key, since, text).
    pub fn alerts(&self) -> Result<Vec<(String, Ms, String)>> {
        let mut st = self.0.prepare("SELECT id, body FROM doc WHERE kind='alert' ORDER BY id")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut out = Vec::new();
        for row in rows {
            let (key, body) = row?;
            let (since, text): (Ms, String) = serde_json::from_str(&body)?;
            out.push((key, since, text));
        }
        Ok(out)
    }
    pub fn draining(&self) -> Result<bool> {
        Ok(get_doc(self.0, "ops", "drain")?.unwrap_or(false))
    }

    pub fn next_ticket_id(&self) -> Result<String> {
        let n: i64 = self.0.query_row("SELECT COALESCE(MAX(CAST(SUBSTR(id,3) AS INTEGER)),0) FROM doc WHERE kind='ticket'", [], |r| r.get(0))?;
        Ok(format!("T-{}", n + 1))
    }
    pub fn next_route_id(&self) -> Result<String> {
        let n: i64 = self.0.query_row("SELECT COALESCE(MAX(CAST(SUBSTR(id,3) AS INTEGER)),0) FROM doc WHERE kind='route'", [], |r| r.get(0))?;
        Ok(format!("R-{}", n + 1))
    }
    pub fn last_seq(&self) -> Result<i64> {
        Ok(self.0.query_row("SELECT COALESCE(MAX(seq),0) FROM events", [], |r| r.get(0))?)
    }

    fn events_where(&self, clause: &str, args: &[&dyn rusqlite::ToSql]) -> Result<Vec<StoredEvent>> {
        let sql = format!("SELECT seq, ts, ticket, actor, body FROM events WHERE {clause}");
        let mut st = self.0.prepare(&sql)?;
        let rows = st.query_map(args, |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get::<_, String>(4)?)))?;
        let mut out = Vec::new();
        for row in rows {
            let (seq, ts, ticket, actor, body) = row?;
            out.push(row_to_event(seq, ts, ticket, actor, body)?);
        }
        Ok(out)
    }
    pub fn events_for(&self, ticket: &str) -> Result<Vec<StoredEvent>> {
        self.events_where("ticket=?1 ORDER BY seq", &[&ticket])
    }
    pub fn events_since(&self, seq: i64, limit: i64) -> Result<Vec<StoredEvent>> {
        self.events_where("seq>?1 ORDER BY seq LIMIT ?2", &[&seq, &limit])
    }
    /// Newest first.
    pub fn events_of_kind(&self, kind: &str, limit: i64) -> Result<Vec<StoredEvent>> {
        self.events_where("kind=?1 ORDER BY seq DESC LIMIT ?2", &[&kind, &limit])
    }

    pub fn cost_sum(&self, project: Option<&str>, since: Ms) -> Result<f64> {
        Ok(match project {
            Some(p) => self.0.query_row("SELECT COALESCE(SUM(amount),0) FROM cost WHERE project=?1 AND ts>=?2", params![p, since], |r| r.get(0))?,
            None => self.0.query_row("SELECT COALESCE(SUM(amount),0) FROM cost WHERE ts>=?1", params![since], |r| r.get(0))?,
        })
    }
    /// `dim` is one of `stage`, `project`, `model`. Returns (key, amount, input tokens, output tokens).
    pub fn cost_by(&self, dim: &str, since: Ms) -> Result<Vec<(String, f64, i64, i64)>> {
        let col = match dim {
            "stage" => "stage",
            "project" => "project",
            "model" => "model",
            _ => return Err(anyhow!("unknown cost dimension {dim}")),
        };
        let sql = format!("SELECT COALESCE({col},''), SUM(amount), SUM(input), SUM(output) FROM cost WHERE ts>=?1 GROUP BY 1 ORDER BY 2 DESC");
        let mut st = self.0.prepare(&sql)?;
        let rows = st.query_map(params![since], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }
    /// Dump of every projection, for comparing before and after a rebuild.
    pub fn snapshot(&self) -> Result<Vec<(String, String, String)>> {
        let mut st = self.0.prepare("SELECT kind, id, body FROM doc ORDER BY kind, id")?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }
}

pub fn ticket_no(id: &str) -> i64 {
    id.trim_start_matches("T-").parse().unwrap_or(0)
}
