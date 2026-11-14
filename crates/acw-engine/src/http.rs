//! HTTP surface: commands are POST/PUT/PATCH/DELETE, views are GET, live updates are SSE.
//! Handlers only translate; every rule lives in the commands.

use crate::engine::*;
use crate::router::Incoming;
use acw_core::*;
use acw_git::{forge::parse_webhook, verify_signature, ForgeEvent};
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, patch, post, put};
use axum::{Json, Router};
use futures::Stream;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

pub struct ApiError(anyhow::Error);

impl<E: Into<anyhow::Error>> From<E> for ApiError {
    fn from(e: E) -> Self {
        ApiError(e.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, msg) = match self.0.downcast_ref::<CmdError>() {
            Some(CmdError::Forbidden(m)) => (StatusCode::FORBIDDEN, m.clone()),
            Some(CmdError::NotFound(m)) => (StatusCode::NOT_FOUND, m.clone()),
            Some(CmdError::Invalid(m)) => (StatusCode::BAD_REQUEST, m.clone()),
            Some(CmdError::Conflict(m)) => (StatusCode::CONFLICT, m.clone()),
            None if self.0.downcast_ref::<acw_core::ReadOnly>().is_some() => (StatusCode::SERVICE_UNAVAILABLE, self.0.to_string()),
            None => {
                tracing::error!("内部错误：{:#}", self.0);
                (StatusCode::INTERNAL_SERVER_ERROR, format!("内部错误：{}", self.0))
            }
        };
        (status, Json(json!({ "error": msg }))).into_response()
    }
}

type Eng = State<Arc<Engine>>;
type Api = Result<Json<Value>, ApiError>;

fn ok() -> Api {
    Ok(Json(json!({ "ok": true })))
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers.get("authorization").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).map(str::trim)
}

/// Who is calling. With `auth = "none"` (development) everyone is the first admin.
fn actor(eng: &Engine, token: Option<&str>) -> Result<Actor, ApiError> {
    if eng.cfg.auth == "none" {
        let admin = eng.store.read(|v| v.members())?.into_iter().find(|m| m.role_for(None) == Role::Admin);
        return Ok(admin.map(Actor::member).unwrap_or_else(|| Actor::system("dev")));
    }
    match token.map(|t| eng.member_by_token(t)).transpose()?.flatten() {
        Some(m) => Ok(Actor::member(m)),
        None => Err(ApiError(forbidden("需要成员令牌（Authorization: Bearer …）"))),
    }
}

fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or_default()
}

pub fn app(eng: Arc<Engine>) -> Router {
    let console = tower_http::services::ServeDir::new(&eng.cfg.console_dir);
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/api/me", get(me))
        .route("/api/me/delegate", put(delegate))
        .route("/metrics", get(|State(e): Eng, h: HeaderMap| async move { actor(&e, bearer(&h))?; Ok::<_, ApiError>(e.metrics()?) }))
        .route("/api/overview", get(|State(e): Eng, h: HeaderMap| async move { Ok::<_, ApiError>(Json(e.view_overview(&actor(&e, bearer(&h))?)?)) }))
        .route("/api/tickets", get(|State(e): Eng, h: HeaderMap| async move { actor(&e, bearer(&h))?; Ok::<_, ApiError>(Json(e.view_tickets()?)) }).post(create_ticket))
        .route("/api/tickets/{id}", get(|State(e): Eng, h: HeaderMap, Path(id): Path<String>| async move { Ok::<_, ApiError>(Json(e.view_ticket(&actor(&e, bearer(&h))?, &id)?)) }))
        .route("/api/tickets/{id}/{action}", post(ticket_action))
        .route("/api/queue/{id}/hand", post(hand))
        .route("/api/router/messages", post(say))
        .route("/api/router/inbound", post(inbound))
        .route("/api/routing", get(|State(e): Eng, h: HeaderMap| async move { actor(&e, bearer(&h))?; Ok::<_, ApiError>(Json(serde_json::to_value(e.store.read(|v| v.routes())?)?)) }))
        .route("/api/routing/{id}/replay", post(replay))
        .route("/api/routing/{id}/feedback", post(route_feedback))
        .route("/api/projects", get(|State(e): Eng, h: HeaderMap| async move { actor(&e, bearer(&h))?; Ok::<_, ApiError>(Json(e.view_projects()?)) }))
        .route("/api/projects/{id}", put(put_project))
        .route("/api/eval", get(|State(e): Eng, h: HeaderMap| async move { Ok::<_, ApiError>(Json(e.view_eval(&actor(&e, bearer(&h))?)?)) }))
        .route("/api/eval/cases", post(eval_case))
        .route("/api/eval/cases/{id}", axum::routing::delete(eval_case_remove))
        .route("/api/eval/run", post(eval_run))
        .route("/api/eval/compare", post(eval_compare))
        .route("/api/projects/{id}/index", get(get_index).post(build_index))
        .route("/api/projects/{id}/env", get(get_env).put(put_env))
        .route("/api/projects/{id}/env/{action}", post(env_action))
        .route("/api/env/{id}/{action}", post(env_decide))
        .route("/api/members", get(|State(e): Eng, h: HeaderMap| async move { actor(&e, bearer(&h))?; Ok::<_, ApiError>(Json(serde_json::to_value(e.store.read(|v| v.members())?)?)) }))
        .route("/api/members/{id}", put(put_member))
        .route("/api/members/{id}/token", post(member_token))
        .route("/api/settings", get(|State(e): Eng, h: HeaderMap| async move { actor(&e, bearer(&h))?; Ok::<_, ApiError>(Json(e.view_settings()?)) }).patch(patch_settings))
        .route("/api/settings/rollback", post(rollback))
        .route("/api/model-endpoints", post(add_endpoint))
        .route("/api/model-endpoints/{id}/pull", post(pull_endpoint))
        .route("/api/model-endpoints/{id}", axum::routing::delete(del_endpoint))
        .route("/api/plans", get(|State(e): Eng, h: HeaderMap| async move { actor(&e, bearer(&h))?; Ok::<_, ApiError>(Json(serde_json::to_value(e.store.read(|v| v.plans())?)?)) }).post(create_plan))
        .route("/api/plans/{id}", get(|State(e): Eng, h: HeaderMap, Path(id): Path<String>| async move { Ok::<_, ApiError>(Json(e.view_plan(&actor(&e, bearer(&h))?, &id)?)) }))
        .route("/api/plans/{id}/{action}", post(plan_action))
        .route("/api/memory", get(|State(e): Eng, h: HeaderMap| async move { Ok::<_, ApiError>(Json(e.view_memory(&actor(&e, bearer(&h))?)?)) }))
        .route("/api/memory/{id}/{action}", post(memory_action))
        .route("/api/cost", get(|State(e): Eng, h: HeaderMap| async move { actor(&e, bearer(&h))?; Ok::<_, ApiError>(Json(e.view_cost()?)) }))
        .route("/api/security", get(|State(e): Eng, h: HeaderMap| async move { actor(&e, bearer(&h))?.require(Role::Approver, None, "看安全记录")?; Ok::<_, ApiError>(Json(e.view_log("security_logged")?)) }))
        .route("/api/notifications", get(|State(e): Eng, h: HeaderMap| async move { actor(&e, bearer(&h))?; Ok::<_, ApiError>(Json(e.view_log("notified")?)) }))
        .route("/api/ops", get(|State(e): Eng, h: HeaderMap| async move { actor(&e, bearer(&h))?; Ok::<_, ApiError>(Json(e.view_ops()?)) }))
        .route("/api/ops/drain", post(drain))
        .route("/api/ops/rebuild", post(rebuild))
        .route("/api/events", get(events))
        .route("/webhooks/github", post(github_webhook))
        .route("/webhooks/issues", post(issue_webhook))
        .route("/webhooks/feishu", post(feishu_webhook))
        .route("/llm/{token}/{*rest}", any(crate::gateway::handle))
        .route("/api/settings/", patch(patch_settings))
        .route("/api/standby", get(|State(e): Eng, h: HeaderMap| async move { actor(&e, bearer(&h))?; Ok::<_, ApiError>(Json(e.standby_status()?)) }))
        .route("/api/standby/promote", post(|State(e): Eng, h: HeaderMap| async move { Ok::<_, ApiError>(Json(e.promote(&actor(&e, bearer(&h))?).await?)) }))
        .route("/replica/status", get(|State(e): Eng, h: HeaderMap| async move { e.check_replica(bearer(&h))?; Ok::<_, ApiError>(Json(e.standby_status()?)) }))
        .route("/replica/events", get(replica_events))
        .route("/replica/secrets", get(|State(e): Eng, h: HeaderMap| async move { e.check_replica(bearer(&h))?; Ok::<_, ApiError>(Json(json!({ "secrets": e.store.all_secrets()? }))) }))
        .route("/replica/fence", post(|State(e): Eng, h: HeaderMap, Json(b): Json<Value>| async move { e.check_replica(bearer(&h))?; Ok::<_, ApiError>(Json(json!({ "fenced": e.fence(b["epoch"].as_u64().unwrap_or(0))? }))) }))
        .fallback_service(console)
        .layer(axum::middleware::from_fn_with_state(eng.clone(), primary_only))
        .with_state(eng)
}

/// A node that is not the primary answers reads and nothing else.
async fn primary_only(State(e): Eng, req: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let role = e.role();
    let path = req.uri().path();
    let read = req.method() == axum::http::Method::GET || req.method() == axum::http::Method::HEAD;
    if role != crate::standby::NodeRole::Primary && !read && !path.starts_with("/replica/") && path != "/api/standby/promote" {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "error": crate::standby::not_primary(role).to_string(), "role": role.name() }))).into_response();
    }
    next.run(req).await
}

async fn replica_events(State(e): Eng, h: HeaderMap, axum::extract::Query(q): axum::extract::Query<std::collections::HashMap<String, String>>) -> Api {
    e.check_replica(bearer(&h))?;
    let n = |k: &str, d: i64| q.get(k).and_then(|v| v.parse().ok()).unwrap_or(d);
    Ok(Json(e.replica_events(n("after", 0), n("limit", 500))?))
}

async fn me(State(e): Eng, h: HeaderMap) -> Api {
    let a = actor(&e, bearer(&h))?;
    Ok(Json(json!({ "id": a.id, "member": a.member, "auth": e.cfg.auth, "forge": e.forge.name() })))
}

async fn delegate(State(e): Eng, h: HeaderMap, Json(b): Json<Value>) -> Api {
    let to = b.get("to").and_then(Value::as_str).filter(|x| !x.is_empty());
    e.set_delegate(&actor(&e, bearer(&h))?, to, b.get("days").and_then(Value::as_u64).unwrap_or(7) as u32)?;
    ok()
}

async fn create_ticket(State(e): Eng, h: HeaderMap, Json(b): Json<Value>) -> Api {
    let a = actor(&e, bearer(&h))?;
    let mandate: Mandate = match b.get("mandate") {
        Some(m) => serde_json::from_value(m.clone()).map_err(|x| invalid(format!("需求单格式不对：{x}")))?,
        None => Mandate { goal: s(&b, "goal").to_owned(), scope: vec!["Worker 读完代码后补充".into()], accept: vec!["Worker 读完代码后补充，改动前会更新这里".into()], ..Default::default() },
    };
    let t = e.create_ticket(&a, s(&b, "project"), mandate, "控制台", s(&b, "goal"))?;
    Ok(Json(json!({ "id": t.id })))
}

async fn ticket_action(State(e): Eng, h: HeaderMap, Path((id, action)): Path<(String, String)>, body: Option<Json<Value>>) -> Api {
    let a = actor(&e, bearer(&h))?;
    let b = body.map(|Json(v)| v).unwrap_or(Value::Null);
    match action.as_str() {
        "confirm" => e.confirm_mandate(&a, &id, b.get("answer").and_then(Value::as_str).map(str::to_owned), s(&b, "rel"))?,
        "answer" => e.answer(&a, &id, s(&b, "text"))?,
        "budget" => e.raise_budget(&a, &id, b.get("extra").and_then(Value::as_f64).unwrap_or(0.0))?,
        "approve-risks" => e.approve_risks(&a, &id)?,
        "stop" => e.stop(&a, &id, if s(&b, "reason").is_empty() { "在控制台停止" } else { s(&b, "reason") })?,
        "retry" => e.retry(&a, &id)?,
        "handover" => e.handover(&a, &id)?,
        "handback" => e.handback(&a, &id)?,
        "move" => e.move_ticket(&a, &id, s(&b, "project"))?,
        "priority" => e.set_priority(&a, &id, serde_json::from_value(b.get("priority").cloned().unwrap_or_default()).map_err(|_| invalid("优先级只能是 high、normal 或 low"))?)?,
        "finding" => e.mark_finding(&a, &id, s(&b, "fingerprint"), s(&b, "status"))?,
        "rollout-advance" => e.rollout_advance(&a, &id)?,
        "rollout-back" => e.rollout_back(&a, &id, s(&b, "reason"))?,
        "fix-issue" => return Ok(Json(json!({ "id": e.fix_issue(&a, &id, b.get("index").and_then(Value::as_u64).unwrap_or(0) as usize)? }))),
        "merge" => {
            // only the local forge can be merged from here; on GitHub a person merges on GitHub
            a.require(Role::Approver, Some(&e.ticket(&id)?.project), "合并")?;
            let lf = e.local_forge.clone().ok_or_else(|| invalid("合并在 GitHub 上进行，控制台不合并"))?;
            let t = e.ticket(&id)?;
            let p = e.project(&t.project)?;
            let pr = t.pr.ok_or_else(|| conflict("这个任务还没有 PR"))?;
            lf.merge(&p.repo, &p.slug, pr.number).await.map_err(|x| conflict(x.to_string()))?;
            e.on_merged(&id, &a.id)?;
        }
        _ => return Err(ApiError(not_found("没有这个操作"))),
    }
    ok()
}

async fn create_plan(State(e): Eng, h: HeaderMap, Json(b): Json<Value>) -> Api {
    let a = actor(&e, bearer(&h))?;
    let accept: Vec<String> = serde_json::from_value(b.get("accept").cloned().unwrap_or_default()).map_err(|_| invalid("accept 要是字符串数组"))?;
    let tasks: Vec<PlanTask> = serde_json::from_value(b.get("tasks").cloned().unwrap_or_default()).map_err(|x| invalid(format!("任务列表格式不对：{x}")))?;
    let plan = e.create_plan(&a, s(&b, "project"), s(&b, "goal"), accept, tasks)?;
    Ok(Json(json!({ "id": plan.id })))
}

async fn plan_action(State(e): Eng, h: HeaderMap, Path((id, action)): Path<(String, String)>, body: Option<Json<Value>>) -> Api {
    let a = actor(&e, bearer(&h))?;
    let b = body.map(|Json(v)| v).unwrap_or(Value::Null);
    let started = match action.as_str() {
        "confirm" => e.confirm_plan(&a, &id)?,
        "change" => e.decide_plan_change(&a, &id, b.get("accept").and_then(Value::as_bool).unwrap_or(false), s(&b, "reason"))?,
        "drop" => {
            e.drop_plan(&a, &id)?;
            vec![]
        }
        _ => return Err(ApiError(not_found("没有这个操作"))),
    };
    Ok(Json(json!({ "started": started })))
}

async fn memory_action(State(e): Eng, h: HeaderMap, Path((id, action)): Path<(String, String)>, body: Option<Json<Value>>) -> Api {
    let a = actor(&e, bearer(&h))?;
    let b = body.map(|Json(v)| v).unwrap_or(Value::Null);
    match action.as_str() {
        "accept" => return Ok(Json(serde_json::to_value(e.accept_memory(&a, &id, b.get("text").and_then(Value::as_str))?)?)),
        "reject" => e.reject_memory(&a, &id, s(&b, "reason"))?,
        "remove" => e.remove_memory(&a, &id)?,
        _ => return Err(ApiError(not_found("没有这个操作"))),
    }
    ok()
}

async fn hand(State(e): Eng, h: HeaderMap, Path(id): Path<String>, Json(b): Json<Value>) -> Api {
    e.hand_queue_item(&actor(&e, bearer(&h))?, &id, s(&b, "to"))?;
    ok()
}

async fn say(State(e): Eng, h: HeaderMap, Json(b): Json<Value>) -> Api {
    let a = actor(&e, bearer(&h))?;
    let text = s(&b, "text").trim().to_owned();
    if text.is_empty() {
        return Err(ApiError(invalid("先写一句需求再发送")));
    }
    let thread = if s(&b, "thread").is_empty() { format!("console:{}", a.id) } else { s(&b, "thread").to_owned() };
    let r = e.route(Incoming { sender: a.id.clone(), channel: "控制台".into(), thread, text }).await?;
    Ok(Json(serde_json::to_value(r)?))
}

/// For chat integrations: a message from someone in a channel. The caller vouches for who sent it,
/// so this needs an admin token.
async fn inbound(State(e): Eng, h: HeaderMap, Json(b): Json<Value>) -> Api {
    actor(&e, bearer(&h))?.require(Role::Admin, None, "代发消息")?;
    let r = e.route(Incoming { sender: s(&b, "sender").to_owned(), channel: s(&b, "channel").to_owned(), thread: s(&b, "thread").to_owned(), text: s(&b, "text").to_owned() }).await?;
    Ok(Json(serde_json::to_value(r)?))
}

async fn replay(State(e): Eng, h: HeaderMap, Path(id): Path<String>, body: Option<Json<Value>>) -> Api {
    let a = actor(&e, bearer(&h))?;
    let b = body.map(|Json(v)| v).unwrap_or(Value::Null);
    let target = (!s(&b, "endpoint").is_empty() && !s(&b, "model").is_empty()).then(|| (s(&b, "endpoint").to_owned(), s(&b, "model").to_owned()));
    let out = e.replay(&a, &id, target, b.get("prompt").and_then(Value::as_str).filter(|p| !p.trim().is_empty()).map(str::to_owned)).await?;
    let was = e.store.read(|v| v.route(&id))?.map(|r| r.output);
    Ok(Json(json!({ "was": was, "now": out })))
}

async fn route_feedback(State(e): Eng, h: HeaderMap, Path(id): Path<String>, Json(b): Json<Value>) -> Api {
    let a = actor(&e, bearer(&h))?;
    e.store.write(|tx| {
        a.require(Role::Requester, None, "标记路由判断")?;
        tx.view().route(&id)?.ok_or_else(|| not_found("没有这条路由记录"))?;
        tx.emit(&a.id, None, Event::RouteFeedback { id: id.clone(), wrong: b.get("wrong").and_then(Value::as_bool).unwrap_or(true) }).map(|_| ())
    })?;
    ok()
}

async fn put_project(State(e): Eng, h: HeaderMap, Path(id): Path<String>, Json(mut b): Json<Value>) -> Api {
    b["id"] = json!(id);
    let p: Project = serde_json::from_value(b).map_err(|x| invalid(format!("项目格式不对：{x}")))?;
    e.upsert_project(&actor(&e, bearer(&h))?, p)?;
    ok()
}

fn pair(b: &Value, key: &str) -> Option<(String, String)> {
    Some((b.get(key)?.get("endpoint")?.as_str()?.to_owned(), b.get(key)?.get("model")?.as_str()?.to_owned()))
}

async fn eval_case(State(e): Eng, h: HeaderMap, Json(b): Json<Value>) -> Api {
    let a = actor(&e, bearer(&h))?;
    let case = e.save_eval_case(&a, s(&b, "route"), b.get("decision").and_then(Value::as_str), b.get("project").and_then(Value::as_str), s(&b, "note"))?;
    Ok(Json(serde_json::to_value(case)?))
}

async fn eval_case_remove(State(e): Eng, h: HeaderMap, Path(id): Path<String>) -> Api {
    e.remove_eval_case(&actor(&e, bearer(&h))?, &id)?;
    Ok(Json(json!({ "ok": true })))
}

async fn eval_run(State(e): Eng, h: HeaderMap, body: Option<Json<Value>>) -> Api {
    let b = body.map(|b| b.0).unwrap_or_default();
    Ok(Json(serde_json::to_value(e.run_eval(&actor(&e, bearer(&h))?, pair(&b, "target")).await?)?))
}

async fn eval_compare(State(e): Eng, h: HeaderMap, Json(b): Json<Value>) -> Api {
    let (Some(x), Some(y)) = (pair(&b, "a"), pair(&b, "b")) else { return Err(invalid("要有 a 和 b，各带 endpoint 和 model").into()) };
    Ok(Json(e.compare_eval(&actor(&e, bearer(&h))?, x, y).await?))
}

async fn get_env(State(e): Eng, h: HeaderMap, Path(id): Path<String>) -> Api {
    actor(&e, bearer(&h))?;
    let p = e.project(&id)?;
    let (history, proposals) = e.store.read(|v| Ok((v.env_history(&id)?, v.env_proposals()?)))?;
    let current = e.env_plan(&p)?;
    let proposals: Vec<Value> = proposals.into_iter().filter(|x| x.project == id).map(|x| json!({ "id": x.id, "from": x.from, "why": x.why, "need": x.need, "at": x.at, "changes": current.diff(&x.plan), "plan": x.plan })).collect();
    Ok(Json(json!({ "plan": current, "history": history, "proposals": proposals })))
}

async fn put_env(State(e): Eng, h: HeaderMap, Path(id): Path<String>, Json(b): Json<Value>) -> Api {
    let a = actor(&e, bearer(&h))?;
    let note = s(&b, "note").to_owned();
    let plan: EnvPlan = serde_json::from_value(b).map_err(|x| invalid(format!("环境计划的格式不对：{x}")))?;
    Ok(Json(serde_json::to_value(e.set_env_plan(&a, &id, plan, &note)?)?))
}

async fn env_action(State(e): Eng, h: HeaderMap, Path((id, action)): Path<(String, String)>, body: Option<Json<Value>>) -> Api {
    let a = actor(&e, bearer(&h))?;
    let b = body.map(|b| b.0).unwrap_or_default();
    match action.as_str() {
        "rollback" => Ok(Json(serde_json::to_value(e.rollback_env_plan(&a, &id, b.get("version").and_then(Value::as_u64).unwrap_or(0) as u32)?)?)),
        "detect" => {
            a.require(Role::Approver, Some(&id), "生成环境计划草稿")?;
            Ok(Json(serde_json::to_value(e.detect_env(&id).await?)?))
        }
        other => Err(not_found(format!("没有这个操作：{other}")).into()),
    }
}

async fn env_decide(State(e): Eng, h: HeaderMap, Path((id, action)): Path<(String, String)>, body: Option<Json<Value>>) -> Api {
    let a = actor(&e, bearer(&h))?;
    let b = body.map(|b| b.0).unwrap_or_default();
    match action.as_str() {
        "accept" => e.decide_env_change(&a, &id, true, "")?,
        "reject" => e.decide_env_change(&a, &id, false, s(&b, "reason"))?,
        other => return Err(not_found(format!("没有这个操作：{other}")).into()),
    }
    Ok(Json(json!({ "ok": true })))
}

async fn get_index(State(e): Eng, h: HeaderMap, Path(id): Path<String>) -> Api {
    actor(&e, bearer(&h))?;
    let info = e.store.read(|v| v.index_info(&id))?;
    let behind = e.index_behind(&id).await.unwrap_or(None);
    let (hit, predicted, actual) = e.index_quality()?;
    let idx = e.load_index(&id);
    Ok(Json(json!({ "info": info, "behind": behind, "stale": behind.is_some_and(|b| b > 20), "access": idx.as_ref().map(|i| &i.access),
        "quality": { "hit": hit, "predicted": predicted, "actual": actual } })))
}

async fn build_index(State(e): Eng, h: HeaderMap, Path(id): Path<String>) -> Api {
    actor(&e, bearer(&h))?.require(Role::Approver, Some(&id), "建代码索引")?;
    Ok(Json(serde_json::to_value(e.build_index(&id).await?)?))
}

async fn put_member(State(e): Eng, h: HeaderMap, Path(id): Path<String>, Json(mut b): Json<Value>) -> Api {
    b["id"] = json!(id);
    let m: Member = serde_json::from_value(b).map_err(|x| invalid(format!("成员格式不对：{x}")))?;
    e.upsert_member(&actor(&e, bearer(&h))?, m)?;
    ok()
}

async fn member_token(State(e): Eng, h: HeaderMap, Path(id): Path<String>) -> Api {
    actor(&e, bearer(&h))?.require(Role::Admin, None, "签发令牌")?;
    Ok(Json(json!({ "token": e.issue_token(&id)? })))
}

async fn patch_settings(State(e): Eng, h: HeaderMap, Json(b): Json<Value>) -> Api {
    let changes = b.get("changes").and_then(Value::as_object).cloned().ok_or_else(|| invalid("要有 changes 对象"))?;
    let s2 = e.change_settings(&actor(&e, bearer(&h))?, &changes, s(&b, "note"))?;
    Ok(Json(serde_json::to_value(s2)?))
}

async fn rollback(State(e): Eng, h: HeaderMap, Json(b): Json<Value>) -> Api {
    let v = b.get("version").and_then(Value::as_u64).ok_or_else(|| invalid("要有 version"))? as u32;
    Ok(Json(serde_json::to_value(e.rollback_settings(&actor(&e, bearer(&h))?, v)?)?))
}

async fn add_endpoint(State(e): Eng, h: HeaderMap, Json(b): Json<Value>) -> Api {
    let api = if s(&b, "api").is_empty() { "chat" } else { s(&b, "api") };
    let ep = e.add_endpoint(&actor(&e, bearer(&h))?, s(&b, "name"), s(&b, "base"), s(&b, "key"), api).await?;
    Ok(Json(serde_json::to_value(ep)?))
}

async fn pull_endpoint(State(e): Eng, h: HeaderMap, Path(id): Path<String>) -> Api {
    let (ep, fresh) = e.pull_endpoint(&actor(&e, bearer(&h))?, &id).await?;
    Ok(Json(json!({ "endpoint": ep, "fresh": fresh })))
}

async fn del_endpoint(State(e): Eng, h: HeaderMap, Path(id): Path<String>) -> Api {
    e.remove_endpoint(&actor(&e, bearer(&h))?, &id)?;
    ok()
}

async fn drain(State(e): Eng, h: HeaderMap, Json(b): Json<Value>) -> Api {
    e.set_drain(&actor(&e, bearer(&h))?, b.get("on").and_then(Value::as_bool).unwrap_or(true))?;
    ok()
}

async fn rebuild(State(e): Eng, h: HeaderMap) -> Api {
    actor(&e, bearer(&h))?.require(Role::Admin, None, "重建投影")?;
    Ok(Json(json!({ "replayed": e.store.rebuild()? })))
}

/// Live updates. A client that reconnects passes the last sequence number it saw and gets
/// everything after it, then the live stream. Only the envelope is sent: the client re-reads the view.
async fn events(State(e): Eng, h: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Result<Sse<impl Stream<Item = Result<SseEvent, std::convert::Infallible>>>, ApiError> {
    actor(&e, bearer(&h).or(q.get("token").map(String::as_str)))?;
    let since: i64 = h.get("last-event-id").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()).or_else(|| q.get("since").and_then(|v| v.parse().ok())).unwrap_or(i64::MAX);
    let rx = e.store.subscribe();
    let backlog = if since == i64::MAX { vec![] } else { e.store.read(|v| v.events_since(since, 2000))? };
    let envelope = |ev: &StoredEvent| SseEvent::default().id(ev.seq.to_string()).data(json!({ "seq": ev.seq, "ticket": ev.ticket, "kind": ev.event.kind() }).to_string());
    let last = backlog.last().map(|x| x.seq).unwrap_or(if since == i64::MAX { 0 } else { since });
    let first: Vec<Result<SseEvent, std::convert::Infallible>> = backlog.iter().map(|x| Ok(envelope(x))).collect();
    let live = futures::stream::unfold((rx, last), move |(mut rx, last)| async move {
        loop {
            match rx.recv().await {
                Ok(ev) if ev.seq > last => return Some((Ok(envelope(&ev)), (rx, ev.seq))),
                Ok(_) => continue,
                // the client fell behind: tell it to reload everything
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => return Some((Ok(SseEvent::default().event("reload").data("{}")), (rx, last))),
                Err(_) => return None,
            }
        }
    });
    Ok(Sse::new(futures::StreamExt::chain(futures::stream::iter(first), live)).keep_alive(KeepAlive::default()))
}

/// Error trackers and deploy tools post here: `{project, title, file, source?, url?}` with the shared
/// token in `X-ACW-Token`.
async fn issue_webhook(State(e): Eng, h: HeaderMap, Json(b): Json<Value>) -> Result<Json<Value>, ApiError> {
    let want = std::env::var(&e.cfg.issues_token_env).unwrap_or_default();
    let got = h.get("x-acw-token").and_then(|v| v.to_str().ok()).unwrap_or_default();
    if want.is_empty() || want != got {
        e.store.write(|tx| security(tx, None, "webhook 验签失败", "问题回传", "令牌不对或没有配置", "拒绝"))?;
        return Err(ApiError(forbidden("令牌不对")));
    }
    let matched = e.report_issue(s(&b, "project"), s(&b, "title"), s(&b, "file"), s(&b, "source"), s(&b, "url"))?;
    Ok(Json(json!({ "matched": matched })))
}

async fn feishu_webhook(State(e): Eng, h: HeaderMap, body: Bytes) -> Result<axum::response::Response, ApiError> {
    use axum::response::IntoResponse;
    let get = |k: &str| h.get(k).and_then(|v| v.to_str().ok()).unwrap_or_default();
    let headers = crate::feishu::Headers { timestamp: get("x-lark-request-timestamp"), nonce: get("x-lark-request-nonce"), signature: get("x-lark-signature") };
    Ok(match e.feishu_event(headers, &body)? {
        crate::feishu::Answer::Challenge(c) => Json(json!({ "challenge": c })).into_response(),
        crate::feishu::Answer::Accepted => Json(json!({})).into_response(),
        crate::feishu::Answer::Refused(why) => {
            e.store.write(|tx| security(tx, None, "webhook 验签失败", "飞书事件", &why, "拒绝"))?;
            StatusCode::UNAUTHORIZED.into_response()
        }
    })
}

async fn github_webhook(State(e): Eng, h: HeaderMap, body: Bytes) -> Result<StatusCode, ApiError> {
    let secret = std::env::var(&e.cfg.forge.webhook_secret_env).unwrap_or_default();
    let sig = h.get("x-hub-signature-256").and_then(|v| v.to_str().ok()).unwrap_or_default();
    if secret.is_empty() || !verify_signature(&secret, &body, sig) {
        e.store.write(|tx| security(tx, None, "webhook 验签失败", "GitHub webhook", "签名不对或没有配置密钥", "拒绝"))?;
        return Ok(StatusCode::UNAUTHORIZED);
    }
    let name = h.get("x-github-event").and_then(|v| v.to_str().ok()).unwrap_or_default();
    let Some(ev) = parse_webhook(name, &body) else { return Ok(StatusCode::NO_CONTENT) };
    let (slug, number) = match &ev {
        ForgeEvent::PrClosed { slug, number, .. } | ForgeEvent::PrFeedback { slug, number, .. } => (slug.clone(), *number),
    };
    let found = e.store.read(|v| {
        let projects = v.projects()?;
        Ok(v.tickets()?.into_iter().find(|t| t.pr.as_ref().is_some_and(|p| p.number == number) && projects.iter().any(|p| p.id == t.project && p.slug == slug)))
    })?;
    let Some(t) = found else { return Ok(StatusCode::NO_CONTENT) };
    match ev {
        ForgeEvent::PrClosed { merged: true, by, .. } => e.on_merged(&t.id, &by)?,
        ForgeEvent::PrClosed { by, .. } => e.on_pr_closed(&t.id, &by)?,
        ForgeEvent::PrFeedback { by, body, changes_requested, .. } => e.on_pr_feedback(&t.id, &by, &body, changes_requested)?,
    }
    Ok(StatusCode::OK)
}
