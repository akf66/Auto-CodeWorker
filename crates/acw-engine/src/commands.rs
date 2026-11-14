//! Commands: every change a person or the forge can ask for. Each one checks the actor's role
//! first, then writes events in a single transaction. A refused command leaves a security record.

use crate::engine::*;
use acw_core::*;
use acw_git::PrStatus;
use anyhow::Result;
use serde_json::Value;
use sha2::{Digest, Sha256};

fn set_path(root: &mut Value, key: &str, val: Value) -> Result<()> {
    let mut cur = root;
    let parts: Vec<&str> = key.split('.').collect();
    for (i, p) in parts.iter().enumerate() {
        let obj = cur.as_object_mut().ok_or_else(|| invalid(format!("设置项 {key} 不存在")))?;
        if i == parts.len() - 1 {
            obj.insert((*p).to_owned(), val);
            return Ok(());
        }
        cur = obj.entry((*p).to_owned()).or_insert_with(|| Value::Object(Default::default()));
    }
    Ok(())
}

fn diff_values(prefix: &str, a: &Value, b: &Value, out: &mut Vec<SettingChange>) {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            let keys: std::collections::BTreeSet<&String> = x.keys().chain(y.keys()).collect();
            for k in keys {
                let key = if prefix.is_empty() { k.clone() } else { format!("{prefix}.{k}") };
                diff_values(&key, x.get(k).unwrap_or(&Value::Null), y.get(k).unwrap_or(&Value::Null), out);
            }
        }
        _ if a != b => out.push(SettingChange { key: prefix.to_owned(), from: a.clone(), to: b.clone() }),
        _ => {}
    }
}

fn validate_settings(v: &View, s: &Settings) -> Result<()> {
    for (name, n) in [("Worker 槽位", s.workers), ("审查轮数上限", s.rounds), ("每人待处理上限", s.queue_limit), ("成员每日新任务", s.member_day), ("每仓库并行任务", s.repo_parallel)] {
        if n < 1 {
            return Err(invalid(format!("{name}需要填 1 或更大的数")));
        }
    }
    if s.budget <= 0.0 || s.project_day <= 0.0 || s.project_month <= 0.0 {
        return Err(invalid("预算和额度需要大于 0"));
    }
    let running = v.tickets()?.iter().filter(|t| t.stage.is_active()).count() as u32;
    if s.workers < running {
        return Err(invalid(format!("现在有 {running} 个 Worker 在跑，槽位不能低于 {running}")));
    }
    if s.sched != "fair" && s.sched != "fifo" {
        return Err(invalid("调度方式只能是 fair 或 fifo"));
    }
    for (stage, m) in &s.stages {
        if !STAGES.contains(&stage.as_str()) {
            return Err(invalid(format!("没有“{stage}”这个阶段")));
        }
        let pairs = std::iter::once((m.endpoint.clone(), m.model.clone())).chain(m.fallback.iter().filter_map(|f| f.split_once('|')).map(|(e, m)| (e.to_owned(), m.to_owned())));
        for (ep, model) in pairs {
            let e = v.endpoint(&ep)?.ok_or_else(|| invalid(format!("阶段 {stage} 选的接入 {ep} 不存在")))?;
            if !e.models.contains(&model) {
                return Err(invalid(format!("接入 {} 的模型列表里没有 {model}", e.name)));
            }
        }
    }
    Ok(())
}

pub fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

pub fn random_token(prefix: &str) -> String {
    format!("{prefix}{:032x}{:032x}", rand::random::<u128>(), rand::random::<u128>())
}

fn title_of(goal: &str) -> String {
    let line = goal.lines().next().unwrap_or_default().trim();
    if line.chars().count() > 28 {
        format!("{}…", line.chars().take(27).collect::<String>())
    } else {
        line.to_owned()
    }
}

/// What kind of proof an acceptance criterion needs, from its wording. A person can correct it in the mandate.
pub fn classify_kind(text: &str) -> &'static str {
    let has = |words: &[&str]| words.iter().any(|w| text.contains(w));
    let low = text.to_lowercase();
    if has(&["观察期", "长跑", "天内", "连续"]) && low.chars().any(|c| c.is_ascii_digit()) && has(&["天"]) {
        "soak"
    } else if has(&["延迟", "耗时", "吞吐", "性能", "毫秒", "秒内"]) || ["p99", "p95", "qps", "ms"].iter().any(|w| low.contains(w)) {
        "perf"
    } else if has(&["并发", "超扣", "竞态", "幂等", "不丢", "不重复"]) {
        "stress"
    } else if has(&["迁移", "对账", "回填", "数据一致"]) {
        "data"
    } else if has(&["人工", "肉眼", "视觉", "手工确认"]) {
        "manual"
    } else {
        "func"
    }
}

/// Create a task inside a transaction. Used by the Router and by the direct API.
pub fn create_ticket_tx(tx: &mut Tx, by: &Actor, project: &Project, mut mandate: Mandate, via: &str, source: &str, link: &dyn Fn(&str) -> String) -> Result<Ticket> {
    by.require(Role::Requester, Some(&project.id), "开任务")?;
    if mandate.goal.trim().is_empty() {
        return Err(invalid("需求不能为空"));
    }
    let v = tx.view();
    let s = v.settings()?;
    let today = v.tickets()?.iter().filter(|t| t.by == by.id && t.created >= day_start(tx.now())).count() as u32;
    if !by.system && today >= s.member_day {
        return Err(invalid(format!("今天的新任务额度（{} 个）用完了", s.member_day)));
    }
    const KINDS: [&str; 6] = ["func", "perf", "stress", "data", "soak", "manual"];
    mandate.kinds = mandate.accept.iter().enumerate().map(|(i, a)| mandate.kinds.get(i).filter(|k| KINDS.contains(&k.as_str())).cloned().unwrap_or_else(|| classify_kind(a).to_owned())).collect();
    let text = format!("{} {} {}", mandate.goal, mandate.scope.join(" "), source);
    // modules the text names, plus those the code index ties it to (a symbol, a file name)
    let mut modules: Vec<String> = project.modules_in(&text).iter().map(|m| m.name.clone()).collect();
    for m in std::mem::take(&mut mandate.modules_hint) {
        if project.modules.iter().any(|x| x.name == m) && !modules.contains(&m) {
            modules.push(m);
        }
    }
    // whether a mandate needs an approver is decided here, by the project's rules, never by a model
    if mandate.need_confirm.is_none() {
        mandate.need_confirm = project.modules.iter().filter(|m| modules.contains(&m.name)).find_map(|m| m.confirm.clone());
    }
    let overlap = v
        .tickets()?
        .into_iter()
        .find(|o| o.project == project.id && o.stage.is_open() && o.modules.iter().any(|m| modules.contains(m)))
        .map(|o| Overlap { module: o.modules.iter().find(|m| modules.contains(m)).cloned().unwrap_or_default(), with: o.id });
    let needs = mandate.need_confirm.is_some();
    let id = v.next_ticket_id()?;
    let now = tx.now();
    let ticket = Ticket {
        id: id.clone(),
        title: title_of(&mandate.goal),
        project: project.id.clone(),
        by: by.id.clone(),
        via: via.to_owned(),
        source_text: source.to_owned(),
        stage: if needs { Stage::MandatePending } else { Stage::Queued },
        resume: None,
        state: if needs { "需求单等确认".into() } else { "排队中".into() },
        why: mandate.need_confirm.as_ref().map(|r| format!("涉及{r}，按项目规则要审批角色确认")).unwrap_or_default(),
        created: now,
        updated: now,
        since: needs.then_some(now),
        priority: Priority::Normal,
        depends_on: None,
        plan: None,
        plan_task: 0,
        stack_on: None,
        siblings: vec![],
        siblings_sha: Default::default(),
        contract: new_contract(!needs),
        mandate,
        branch: None,
        base_sha: None,
        head_sha: None,
        pr: None,
        sandbox: None,
        review: Review::default(),
        checks: vec![],
        pr_tests: vec![],
        evidence: vec![],
        cost: 0.0,
        budget_extra: 0.0,
        ask: None,
        risks: vec![],
        inputs: vec![],
        overlap: overlap.clone(),
        modules,
        handed: false,
        tainted: false,
        restarts: 0,
        check_fails: 0,
        progress: vec![],
        files: vec![],
        merged_at: None,
        issues: vec![],
        arch: None,
    };
    tx.emit(&by.id, Some(&id), Event::TicketCreated { ticket: Box::new(ticket.clone()) })?;
    if needs {
        open_queue(tx, &ticket, "mandate", &ticket.why, Role::Approver, None, &link(&id))?;
    }
    Ok(ticket)
}

impl Engine {
    /// Write default settings on first start.
    pub fn init(&self) -> Result<()> {
        self.store.write(|tx| {
            if tx.view().last_seq()? == 0 {
                tx.emit("engine", None, Event::SettingsChanged { changes: vec![], note: "初始默认值".into(), snapshot: Settings::default() })?;
            }
            Ok(())
        })
    }

    // ------------------------------------------------------------ members

    pub fn upsert_member(&self, actor: &Actor, member: Member) -> Result<()> {
        self.store.write(|tx| {
            actor.require(Role::Admin, None, "改成员")?;
            if member.id.is_empty() || member.name.trim().is_empty() {
                return Err(invalid("成员要有编号和名字"));
            }
            if member.roles.iter().any(|(k, r)| k != "*" && *r == Role::Admin) {
                return Err(invalid("管理角色只能全局授予"));
            }
            let admins_left = tx.view().members()?.iter().filter(|m| m.id != member.id && m.role_for(None) == Role::Admin).count();
            if admins_left == 0 && member.role_for(None) != Role::Admin && tx.view().member(&member.id)?.is_some() {
                return Err(conflict("至少要留一个管理角色"));
            }
            tx.emit(&actor.id, None, Event::MemberUpserted { member })?;
            Ok(())
        })
    }

    /// While away, a member lends their rights over queue items to someone else, until a date.
    pub fn set_delegate(&self, actor: &Actor, to: Option<&str>, days: u32) -> Result<()> {
        self.store.write(|tx| {
            let mut me = actor.member.clone().ok_or_else(|| forbidden("只有成员可以设代理人"))?;
            me = tx.view().member(&me.id)?.unwrap_or(me);
            match to {
                Some(to) => {
                    if to == me.id {
                        return Err(invalid("不能把自己设成代理人"));
                    }
                    let target = tx.view().member(to)?.ok_or_else(|| not_found(format!("没有成员 {to}")))?;
                    if days == 0 || days > 60 {
                        return Err(invalid("代理期限要在 1 到 60 天之间"));
                    }
                    me.delegate = Some(Delegate { to: to.to_owned(), until: tx.now() + days as i64 * 86_400_000 });
                    security(tx, None, "代理", &me.id, &format!("把待处理交给 {}，{days} 天", target.name), "期间他有委托人的审批权限，到期自动收回")?;
                }
                None => me.delegate = None,
            }
            tx.emit(&actor.id, None, Event::MemberUpserted { member: me })?;
            Ok(())
        })
    }

    /// Issue an API token for a member. Only its hash is stored.
    pub fn issue_token(&self, member: &str) -> Result<String> {
        self.store.read(|v| v.member(member))?.ok_or_else(|| not_found(format!("没有成员 {member}")))?;
        let token = random_token("acw_");
        self.store.set_secret(&format!("token:{}", token_hash(&token)), member)?;
        Ok(token)
    }

    pub fn member_by_token(&self, token: &str) -> Result<Option<Member>> {
        match self.store.secret(&format!("token:{}", token_hash(token)))? {
            Some(id) => self.store.read(|v| v.member(&id)),
            None => Ok(None),
        }
    }

    // ------------------------------------------------------------ projects, settings, endpoints

    pub fn upsert_project(&self, actor: &Actor, project: Project) -> Result<()> {
        self.store.write(|tx| {
            actor.require(Role::Admin, None, "改项目")?;
            if project.id.is_empty() || !project.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                return Err(invalid("项目编号只能用字母、数字、- 和 _"));
            }
            if project.repo.trim().is_empty() {
                return Err(invalid("项目要有仓库地址"));
            }
            tx.emit(&actor.id, None, Event::ProjectUpserted { project })?;
            Ok(())
        })?;
        self.kick();
        Ok(())
    }

    /// `patch` maps dotted keys to new values, for example `{"stages.worker.model": "gpt-x"}`.
    pub fn change_settings(&self, actor: &Actor, patch: &serde_json::Map<String, Value>, note: &str) -> Result<Settings> {
        let out = self.store.write(|tx| {
            actor.require(Role::Admin, None, "改设置")?;
            let old = tx.view().settings()?;
            let mut v = serde_json::to_value(&old)?;
            for (k, val) in patch {
                if k == "version" || k == "_eval_override" {
                    continue;
                }
                set_path(&mut v, k, val.clone())?;
            }
            let mut new: Settings = serde_json::from_value(v).map_err(|e| invalid(format!("设置的值不对：{e}")))?;
            validate_settings(&tx.view(), &new)?;
            // the Router's model changes only after the eval set says the new one is not worse
            if let Some(why) = crate::eval::eval_gate(&tx.view(), old.stages.get("router"), new.stages.get("router"))? {
                match patch.get("_eval_override").and_then(Value::as_str).map(str::trim).filter(|r| !r.is_empty()) {
                    Some(reason) => security(tx, None, "越过评测", &actor.id, &format!("换路由模型：{why}"), &format!("管理员越过，理由：{reason}"))?,
                    None => return Err(conflict(why)),
                }
            }
            new.version = old.version;
            let mut changes = Vec::new();
            diff_values("", &serde_json::to_value(&old)?, &serde_json::to_value(&new)?, &mut changes);
            if changes.is_empty() {
                return Ok(old);
            }
            new.version = old.version + 1;
            tx.emit(&actor.id, None, Event::SettingsChanged { changes, note: note.to_owned(), snapshot: new.clone() })?;
            Ok(new)
        })?;
        self.kick();
        Ok(out)
    }

    /// Rolling back writes a new version whose values are those of `version`.
    pub fn rollback_settings(&self, actor: &Actor, version: u32) -> Result<Settings> {
        let out = self.store.write(|tx| {
            actor.require(Role::Admin, None, "改设置")?;
            let target = tx
                .view()
                .events_of_kind("settings_changed", 1000)?
                .into_iter()
                .find_map(|e| match e.event {
                    Event::SettingsChanged { snapshot, .. } if snapshot.version == version => Some(snapshot),
                    _ => None,
                })
                .ok_or_else(|| not_found(format!("没有第 {version} 版设置")))?;
            let old = tx.view().settings()?;
            let mut new = target;
            new.version = old.version;
            validate_settings(&tx.view(), &new)?;
            let mut changes = Vec::new();
            diff_values("", &serde_json::to_value(&old)?, &serde_json::to_value(&new)?, &mut changes);
            new.version = old.version + 1;
            tx.emit(&actor.id, None, Event::SettingsChanged { changes, note: format!("回滚到第 {version} 版"), snapshot: new.clone() })?;
            Ok(new)
        })?;
        self.kick();
        Ok(out)
    }

    /// A connection is saved only after its model list could be pulled.
    pub async fn add_endpoint(&self, actor: &Actor, name: &str, base: &str, key: &str, api: &str) -> Result<Endpoint> {
        actor.require(Role::Admin, None, "加模型接入")?;
        let base = base.trim().trim_end_matches('/');
        if name.trim().is_empty() {
            return Err(invalid("写一个名字"));
        }
        if !base.starts_with("https://") && !(base.starts_with("http://127.0.0.1") || base.starts_with("http://localhost")) {
            return Err(invalid("Base URL 需要 https 开头的完整地址，例如 https://api.example.com/v1"));
        }
        if key.trim().is_empty() {
            return Err(invalid("填这个服务的 API key"));
        }
        if api != "chat" && api != "responses" {
            return Err(invalid("接口类型只能是 chat 或 responses"));
        }
        let models = self.llm.models(base, Some(key.trim())).await.map_err(|e| invalid(format!("拉取模型列表失败，没有保存：{e}")))?;
        let key = key.trim().to_owned();
        let ep = self.store.write(|tx| {
            let n = tx.view().endpoints()?.len();
            let mut id = format!("ep{}", n + 1);
            while tx.view().endpoint(&id)?.is_some() {
                id.push('x');
            }
            let hint: String = key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
            let ep = Endpoint { id, name: name.trim().to_owned(), base: base.to_owned(), api: api.to_owned(), models, pulled_at: tx.now(), key_hint: hint };
            tx.emit(&actor.id, None, Event::EndpointUpserted { endpoint: ep.clone() })?;
            Ok(ep)
        })?;
        self.store.set_secret(&format!("endpoint:{}", ep.id), &key)?;
        Ok(ep)
    }

    /// Pull the model list again. Returns the models that are new.
    pub async fn pull_endpoint(&self, actor: &Actor, id: &str) -> Result<(Endpoint, Vec<String>)> {
        actor.require(Role::Admin, None, "拉取模型列表")?;
        let mut ep = self.store.read(|v| v.endpoint(id))?.ok_or_else(|| not_found("没有这个接入"))?;
        let key = self.store.secret(&format!("endpoint:{id}"))?;
        let models = self.llm.models(&ep.base, key.as_deref()).await.map_err(|e| invalid(format!("拉取失败，保留上一次的列表：{e}")))?;
        let fresh: Vec<String> = models.iter().filter(|m| !ep.models.contains(m)).cloned().collect();
        ep.models = models;
        self.store.write(|tx| {
            ep.pulled_at = tx.now();
            tx.emit(&actor.id, None, Event::EndpointUpserted { endpoint: ep.clone() })?;
            Ok(())
        })?;
        Ok((ep, fresh))
    }

    pub fn remove_endpoint(&self, actor: &Actor, id: &str) -> Result<()> {
        self.store.write(|tx| {
            actor.require(Role::Admin, None, "删模型接入")?;
            let s = tx.view().settings()?;
            if let Some((stage, _)) = s.stages.iter().find(|(_, m)| m.endpoint == id || m.fallback.as_deref().is_some_and(|f| f.starts_with(&format!("{id}|")))) {
                return Err(conflict(format!("阶段 {stage} 还在用这个接入，先换掉再删")));
            }
            tx.emit(&actor.id, None, Event::EndpointRemoved { id: id.to_owned() })?;
            Ok(())
        })?;
        self.store.del_secret(&format!("endpoint:{id}"))
    }

    pub fn set_drain(&self, actor: &Actor, on: bool) -> Result<()> {
        self.store.write(|tx| {
            actor.require(Role::Admin, None, "排空 Engine ")?;
            tx.emit(&actor.id, None, Event::DrainSet { on })?;
            Ok(())
        })?;
        self.kick();
        Ok(())
    }

    // ------------------------------------------------------------ tickets

    pub fn create_ticket(&self, actor: &Actor, project: &str, mut mandate: Mandate, via: &str, source: &str) -> Result<Ticket> {
        mandate.modules_hint = self.hint_modules(project, &format!("{} {source}", mandate.goal));
        let t = self.store.write(|tx| {
            let p = tx.view().project(project)?.ok_or_else(|| not_found(format!("找不到项目 {project}")))?;
            create_ticket_tx(tx, actor, &p, mandate, via, source, &|id| self.link(id))
        })?;
        self.kick();
        Ok(t)
    }

    /// Run `f` on a ticket after checking the role; a refusal is written to the security log.
    fn on_ticket<R>(&self, actor: &Actor, id: &str, need: Role, what: &str, f: impl FnOnce(&mut Tx, &Ticket) -> Result<R>) -> Result<R> {
        let out = self.store.write(|tx| {
            let t = tx.view().ticket(id)?.ok_or_else(|| not_found(format!("找不到任务 {id}")))?;
            // `Requester` here means: the person who asked for this task, or an approver of its project
            let allowed = if need == Role::Requester { t.by == actor.id || actor.can(Role::Approver, Some(&t.project)) } else { actor.can(need, Some(&t.project)) };
            if !allowed {
                return Ok(Err(format!("{what}需要 {} 的{}角色", t.project, role_name(need))));
            }
            f(tx, &t).map(Ok)
        })?;
        match out {
            Ok(r) => {
                self.kick();
                Ok(r)
            }
            Err(msg) => {
                self.store.write(|tx| security(tx, Some(id), "权限不足", &actor.id, what, &format!("拒绝：{msg}")))?;
                Err(forbidden(msg))
            }
        }
    }

    /// `rel` says how to treat an overlapping task: `par` (default), `after` (start when it merges) or `merge` (fold into it).
    pub fn confirm_mandate(&self, actor: &Actor, id: &str, answer: Option<String>, rel: &str) -> Result<()> {
        self.on_ticket(actor, id, Role::Approver, "确认需求单", |tx, t| {
            if t.stage != Stage::MandatePending {
                return Err(conflict("这份需求单现在不需要确认"));
            }
            if t.mandate.confirmed_by.contains(&actor.id) {
                return Err(conflict("你已经确认过，还差另一位审批人"));
            }
            let two = tx.view().project(&t.project)?.map(|p| p.two_person).unwrap_or(false);
            let complete = !two || !t.mandate.confirmed_by.is_empty();
            tx.emit(&actor.id, Some(id), Event::MandateConfirmed { by: actor.id.clone(), answer: answer.clone().filter(|a| !a.trim().is_empty()), complete })?;
            if !complete {
                return set_stage(tx, "engine", id, Stage::MandatePending, "需求单还差一位审批人确认", &t.why, None);
            }
            close_queue(tx, id, "mandate", "confirmed")?;
            tx.emit("engine", Some(id), Event::ContractSet { key: "confirmed".into(), result: Verdict::Pass, note: format!("{} 确认", actor.id), sha: None })?;
            match (rel, &t.overlap) {
                ("merge", Some(o)) => {
                    let other = tx.view().ticket(&o.with)?.ok_or_else(|| not_found("重叠的任务不存在了"))?;
                    tx.emit(&actor.id, Some(&other.id), Event::InputQueued { input: Input { source: "member".into(), text: format!("并入 {} 的需求：{}", t.id, t.mandate.goal), trusted: true } })?;
                    if matches!(other.stage, Stage::PrOpen | Stage::Blocked | Stage::Failed) {
                        close_all_queue(tx, &other.id, "superseded")?;
                        set_stage(tx, "engine", &other.id, Stage::Queued, "排队中", &format!("并入了 {}", t.id), Some(Stage::Working))?;
                    }
                    tx.emit(&actor.id, Some(id), Event::TicketStopped { by: actor.id.clone(), reason: format!("并入 {}", other.id) })?;
                    set_stage(tx, "engine", id, Stage::Dropped, &format!("已并入 {}", other.id), "", None)
                }
                ("after", Some(o)) => {
                    tx.emit(&actor.id, Some(id), Event::DependencySet { on: Some(o.with.clone()) })?;
                    set_stage(tx, "engine", id, Stage::Queued, &format!("排在 {} 后面", o.with), &format!("{} 合并后自动开工", o.with), None)
                }
                _ => set_stage(tx, "engine", id, Stage::Queued, "排队中", "", None),
            }
        })
    }

    /// Answer the Worker's question, or decide an escalation. What the answer means depends on `ask.kind`.
    pub fn answer(&self, actor: &Actor, id: &str, text: &str) -> Result<()> {
        self.on_ticket(actor, id, Role::Approver, "回答问题", |tx, t| {
            let ask = t.ask.clone().filter(|_| t.stage == Stage::Blocked).ok_or_else(|| conflict("这个任务现在没有等回答的问题"))?;
            let text = text.trim();
            match ask.kind.as_str() {
                "budget" => return Err(invalid("预算问题请选择提高预算或停止任务")),
                "evidence" => {
                    if text != "waive" {
                        return Err(invalid("没有取证命令的验收标准，只能按人工确认处理，或停止任务后在项目卡里配上命令"));
                    }
                    let missing: Vec<u32> = t.mandate.kinds.iter().enumerate().filter(|(i, k)| ["perf", "stress", "data"].contains(&k.as_str()) && !t.evidence.iter().any(|e| e.criterion == *i as u32 + 1 && e.ok)).map(|(i, _)| i as u32 + 1).collect();
                    tx.emit(&actor.id, Some(id), Event::EvidenceWaived { criteria: missing, by: actor.id.clone() })?;
                    tx.emit(&actor.id, Some(id), Event::AskAnswered { by: actor.id.clone(), answer: "按人工确认处理".into() })?;
                    close_queue(tx, id, "evidence", "waived")?;
                    return set_stage(tx, "engine", id, Stage::Queued, "排队中", "已按人工确认处理", Some(Stage::Testing));
                }
                "risk" => return Err(invalid("这些改动需要批准或停止任务")),
                "oscillation" | "rounds" if text == "false_positive" => {
                    for f in t.review.findings.iter().filter(|f| f.blocks()) {
                        tx.emit(&actor.id, Some(id), Event::FindingMarked { fingerprint: f.fingerprint.clone(), status: "false_positive".into() })?;
                    }
                    tx.emit(&actor.id, Some(id), Event::AskAnswered { by: actor.id.clone(), answer: "标为误报".into() })?;
                    close_queue(tx, id, &ask.kind, "answered")?;
                    return set_stage(tx, "engine", id, Stage::Queued, "排队中", "误报已标记，重新审查", Some(Stage::Reviewing));
                }
                "oscillation" | "rounds" => {
                    for f in t.review.findings.iter().filter(|f| f.blocks()) {
                        tx.emit(&actor.id, Some(id), Event::FindingMarked { fingerprint: f.fingerprint.clone(), status: "open".into() })?;
                    }
                }
                _ if text.is_empty() => return Err(invalid("写一句回答")),
                _ => {}
            }
            tx.emit(&actor.id, Some(id), Event::AskAnswered { by: actor.id.clone(), answer: text.to_owned() })?;
            let note = if text.is_empty() { "继续修这些问题".to_owned() } else { text.to_owned() };
            tx.emit(&actor.id, Some(id), Event::InputQueued { input: Input { source: "answer".into(), text: format!("问题：{}\n回答：{note}", ask.text), trusted: true } })?;
            close_queue(tx, id, &ask.kind, "answered")?;
            set_stage(tx, "engine", id, Stage::Queued, "排队中", "已回答，继续", Some(Stage::Working))
        })
    }

    pub fn raise_budget(&self, actor: &Actor, id: &str, extra: f64) -> Result<()> {
        self.on_ticket(actor, id, Role::Approver, "提高预算", |tx, t| {
            if extra <= 0.0 {
                return Err(invalid("提高的金额要大于 0"));
            }
            tx.emit(&actor.id, Some(id), Event::BudgetRaised { by: actor.id.clone(), extra })?;
            if t.ask.as_ref().is_some_and(|a| a.kind == "budget") {
                tx.emit(&actor.id, Some(id), Event::AskAnswered { by: actor.id.clone(), answer: format!("预算提高 ¥{extra}") })?;
                close_queue(tx, id, "budget", "raised")?;
                set_stage(tx, "engine", id, Stage::Queued, "排队中", "预算已提高，继续", t.resume.or(Some(Stage::Working)))?;
            }
            Ok(())
        })
    }

    pub fn approve_risks(&self, actor: &Actor, id: &str) -> Result<()> {
        self.on_ticket(actor, id, Role::Approver, "批准中风险改动", |tx, t| {
            if !t.ask.as_ref().is_some_and(|a| a.kind == "risk") {
                return Err(conflict("这个任务现在没有等批准的改动"));
            }
            tx.emit(&actor.id, Some(id), Event::RisksApproved { by: actor.id.clone() })?;
            tx.emit("engine", Some(id), Event::ContractSet { key: "confirmed".into(), result: Verdict::Pass, note: format!("{} 批准了改动", actor.id), sha: None })?;
            tx.emit(&actor.id, Some(id), Event::AskAnswered { by: actor.id.clone(), answer: "批准".into() })?;
            close_queue(tx, id, "risk", "approved")?;
            set_stage(tx, "engine", id, Stage::Queued, "排队中", "改动已批准", Some(Stage::Opening))
        })
    }

    pub fn stop(&self, actor: &Actor, id: &str, reason: &str) -> Result<()> {
        self.on_ticket(actor, id, Role::Requester, "停止任务", |tx, t| {
            if !t.stage.is_open() {
                return Err(conflict("任务已经结束"));
            }
            tx.emit(&actor.id, Some(id), Event::TicketStopped { by: actor.id.clone(), reason: reason.to_owned() })?;
            close_all_queue(tx, id, "stopped")?;
            if let Some(sb) = &t.sandbox {
                tx.effect(Effect::DestroySandbox { id: sb.clone() })?;
            }
            set_stage(tx, "engine", id, Stage::Dropped, "已停止", reason, None)
        })?;
        self.cancel_run(id);
        Ok(())
    }

    pub fn retry(&self, actor: &Actor, id: &str) -> Result<()> {
        self.on_ticket(actor, id, Role::Requester, "重试", |tx, t| {
            if t.stage != Stage::Failed {
                return Err(conflict("只有失败的任务可以重试"));
            }
            close_queue(tx, id, "failed", "retried")?;
            set_stage(tx, "engine", id, Stage::Queued, "排队中", "重试", t.resume.or(Some(Stage::Provisioning)))
        })
    }

    pub fn set_priority(&self, actor: &Actor, id: &str, priority: Priority) -> Result<()> {
        self.on_ticket(actor, id, Role::Approver, "改优先级", |tx, _| {
            tx.emit(&actor.id, Some(id), Event::PriorityChanged { priority })?;
            Ok(())
        })
    }

    pub fn move_ticket(&self, actor: &Actor, id: &str, project: &str) -> Result<()> {
        self.on_ticket(actor, id, Role::Approver, "移动任务", |tx, t| {
            actor.require(Role::Requester, Some(project), "移到这个项目")?;
            tx.view().project(project)?.ok_or_else(|| not_found(format!("找不到项目 {project}")))?;
            if !matches!(t.stage, Stage::MandatePending | Stage::Queued) {
                return Err(conflict("任务已经开工，不能再换项目；停止后重新提"));
            }
            tx.emit(&actor.id, Some(id), Event::TicketMoved { project: project.to_owned() })?;
            Ok(())
        })
    }

    pub fn mark_finding(&self, actor: &Actor, id: &str, fingerprint: &str, status: &str) -> Result<()> {
        self.on_ticket(actor, id, Role::Approver, "标记审查发现", |tx, t| {
            if !["false_positive", "open"].contains(&status) {
                return Err(invalid("只能标为误报或恢复"));
            }
            if !t.review.findings.iter().any(|f| f.fingerprint == fingerprint) {
                return Err(not_found("没有这条审查发现"));
            }
            tx.emit(&actor.id, Some(id), Event::FindingMarked { fingerprint: fingerprint.to_owned(), status: status.to_owned() })?;
            Ok(())
        })
    }

    /// A person takes the branch over. The Worker stops after killing its current command.
    pub fn handover(&self, actor: &Actor, id: &str) -> Result<()> {
        self.on_ticket(actor, id, Role::Approver, "接手任务", |tx, t| {
            if !(t.stage.is_active() || t.stage == Stage::Queued) || t.branch.is_none() {
                return Err(conflict("只有已经开工、还没开 PR 的任务可以接手"));
            }
            tx.emit(&actor.id, Some(id), Event::HandedOver { by: actor.id.clone() })?;
            set_stage(tx, "engine", id, Stage::Blocked, &format!("{} 接手中", actor.id), "Worker 已停下，等交还", Some(Stage::Provisioning))
        })?;
        self.cancel_run(id);
        Ok(())
    }

    /// Human commits win: the Worker restarts from the remote branch and is told to build on them.
    pub fn handback(&self, actor: &Actor, id: &str) -> Result<()> {
        self.on_ticket(actor, id, Role::Approver, "交还任务", |tx, t| {
            if !t.handed {
                return Err(conflict("这个任务没有被接手"));
            }
            tx.emit(&actor.id, Some(id), Event::HandedBack { by: actor.id.clone() })?;
            tx.emit(&actor.id, Some(id), Event::InputQueued { input: Input { source: "member".into(), text: "有人直接在任务分支上提交了改动。先用 git log 读这些提交，在它们的基础上继续，不要把它们改回去。".into(), trusted: true } })?;
            set_stage(tx, "engine", id, Stage::Queued, "排队中", "已交还给 Worker", Some(Stage::Provisioning))
        })
    }

    pub fn hand_queue_item(&self, actor: &Actor, qid: &str, to: &str) -> Result<()> {
        self.store.write(|tx| {
            let q = tx.view().queue_item(qid)?.ok_or_else(|| not_found("这件事已经处理掉了"))?;
            let me = actor.member.clone().ok_or_else(|| forbidden("只有成员可以转交"))?;
            if !can_act(&me, &q, &tx.view().members()?) {
                return Err(forbidden("这件事不在你的待处理里"));
            }
            let target = tx.view().member(to)?.ok_or_else(|| not_found(format!("没有成员 {to}")))?;
            if !(can(Some(&target), q.need, Some(&q.project)) || q.also.as_deref() == Some(to)) {
                return Err(invalid(format!("{} 没有处理这件事的权限", target.name)));
            }
            tx.emit(&actor.id, Some(&q.ticket), Event::QueueHanded { id: qid.to_owned(), to: to.to_owned() })?;
            tx.effect(Effect::Notify { kind: q.kind.clone(), to: vec![to.to_owned()], text: format!("{} 把这件事转给了你：{}", me.name, q.title), link: self.link(&q.ticket) })?;
            Ok(())
        })
    }

    // ------------------------------------------------------------ forge callbacks

    pub fn on_merged(&self, id: &str, by: &str) -> Result<()> {
        self.store.write(|tx| {
            let t = tx.view().ticket(id)?.ok_or_else(|| not_found("没有这个任务"))?;
            if t.stage == Stage::Done || t.stage == Stage::RollingOut {
                return Ok(());
            }
            tx.emit("github", Some(id), Event::PrMerged { by: by.to_owned() })?;
            close_all_queue(tx, id, "merged")?;
            // a pull-request group merges in dependency order; out of order is allowed but said out loud
            let early: Vec<String> = t.siblings.iter().filter_map(|s| tx.view().ticket(s).ok().flatten()).filter(|s| s.merged_at.is_none() && s.stage != Stage::Done).map(|s| format!("{}（{}）", s.id, s.project)).collect();
            if !early.is_empty() {
                let what = format!("{} 先于它依赖的 {} 合并了。{} 的主分支现在依赖还没合并的改动", t.id, early.join("、"), t.project);
                security(tx, Some(id), "合并顺序", by, &what, "已通知审批人")?;
                let to = owners(&tx.view(), Role::Approver, &t.project, None)?;
                tx.effect(Effect::Notify { kind: "pr".into(), to, text: what, link: self.link(id) })?;
            }
            if let Some(sb) = &t.sandbox {
                tx.effect(Effect::DestroySandbox { id: sb.clone() })?;
            }
            if crate::rollout::start_rollout(tx, &t, &format!("{}-rollout", self.link(id)))? {
                return Ok(());
            }
            set_stage(tx, "engine", id, Stage::Done, "已合并", "沙箱已回收", None)
        })?;
        if let Ok(mut m) = self.merged.lock() {
            m.push(id.to_owned());
        }
        self.advance_plans()?;
        self.cancel_run(id);
        self.kick();
        Ok(())
    }

    pub fn on_pr_closed(&self, id: &str, by: &str) -> Result<()> {
        self.store.write(|tx| {
            let t = tx.view().ticket(id)?.ok_or_else(|| not_found("没有这个任务"))?;
            if !t.stage.is_open() {
                return Ok(());
            }
            tx.emit("github", Some(id), Event::TicketStopped { by: by.to_owned(), reason: "PR 被关闭，没有合并".into() })?;
            close_all_queue(tx, id, "closed")?;
            if let Some(sb) = &t.sandbox {
                tx.effect(Effect::DestroySandbox { id: sb.clone() })?;
            }
            set_stage(tx, "engine", id, Stage::Dropped, "PR 已关闭", "没有合并", None)
        })?;
        self.cancel_run(id);
        self.kick();
        Ok(())
    }

    /// Feedback on the pull request. From an approver it is an instruction and the task goes back to
    /// work. From anyone else it is kept as data, flagged, and starts nothing.
    pub fn on_pr_feedback(&self, id: &str, login: &str, body: &str, changes_requested: bool) -> Result<()> {
        self.store.write(|tx| {
            let t = tx.view().ticket(id)?.ok_or_else(|| not_found("没有这个任务"))?;
            if t.stage != Stage::PrOpen {
                return Ok(());
            }
            let member = tx.view().members()?.into_iter().find(|m| m.github.as_deref() == Some(login));
            let trusted = can(member.as_ref(), Role::Approver, Some(&t.project));
            let (body, found) = acw_core::scan::redact(body);
            if !found.is_empty() {
                security(tx, Some(id), "密钥扫描", login, "PR 评论里有疑似密钥", "打码后存储")?;
            }
            if !trusted {
                security(tx, Some(id), "外部内容", &format!("GitHub 用户 {login}（没有审批权限）"), &body.chars().take(120).collect::<String>(), "按数据处理，没有执行")?;
                tx.emit("github", Some(id), Event::InputQueued { input: Input { source: "pr_comment".into(), text: format!("{login}：{body}"), trusted: false } })?;
                return Ok(());
            }
            let who = member.map(|m| m.id).unwrap_or_else(|| login.to_owned());
            if !changes_requested && body.trim().is_empty() {
                return Ok(());
            }
            tx.emit("github", Some(id), Event::PrChangesRequested { by: who.clone(), member: true })?;
            tx.emit(&who, Some(id), Event::InputQueued { input: Input { source: "member".into(), text: format!("审批人在 PR 上要求修改：{body}"), trusted: true } })?;
            close_queue(tx, id, "pr", "changes_requested")?;
            set_stage(tx, "engine", id, Stage::Queued, "排队中", "审批人要求修改", Some(Stage::Provisioning))
        })?;
        self.kick();
        Ok(())
    }

    /// Fallback for missed webhooks, and the only path for the local forge.
    pub async fn poll_prs(&self) -> Result<()> {
        let open: Vec<Ticket> = self.store.read(|v| v.tickets())?.into_iter().filter(|t| t.stage == Stage::PrOpen).collect();
        for t in open {
            let (Some(pr), Ok(p)) = (&t.pr, self.project(&t.project)) else { continue };
            match self.forge.pr_status(&p.slug, pr.number).await {
                Ok(PrStatus::Merged) => self.on_merged(&t.id, "forge")?,
                Ok(PrStatus::Closed) => self.on_pr_closed(&t.id, "forge")?,
                Ok(PrStatus::Open) => {
                    // the base moved under an open pull request: rebase and re-verify, quietly
                    if self.git.sync(&p.id, &self.forge.remote(&p.repo)).await.is_ok() {
                        let base = self.base_of(&t, &p)?;
                        let tip = self.git.base_tip(&p.id, &base).await.ok().flatten();
                        if tip.is_some() && tip != t.base_sha {
                            // the new commit may be this very pull request, merged between the two looks
                            // (seen on GitHub with a squash merge): ask again before rebasing a merged branch
                            if matches!(self.forge.pr_status(&p.slug, pr.number).await, Ok(PrStatus::Merged)) {
                                self.on_merged(&t.id, "forge")?;
                                continue;
                            }
                            self.store.write(|tx| set_stage(tx, "engine", &t.id, Stage::Queued, "排队中", &format!("{base} 有新提交，自动变基并重新校验"), Some(Stage::Opening)))?;
                            self.kick();
                        }
                    }
                }
                Err(e) => tracing::warn!("查询 {} 的 PR 状态失败：{e}", t.id),
            }
        }
        Ok(())
    }
}
