//! The model gateway. A sandbox has no model key: the Worker sends its requests here with a
//! per-task token, and the gateway forwards them to the connection configured for the "worker"
//! stage, adding the real key. Because every request passes through, the gateway is also where
//! cost is counted and the budget is enforced.
//!
//!   POST {gateway}/llm/<token>/v1/responses          (what codex uses)
//!   POST {gateway}/llm/<token>/v1/chat/completions
//!   GET  {gateway}/llm/<token>/v1/models

use crate::engine::*;
use crate::models::Target;
use acw_llm::Usage;
use axum::body::{Body, Bytes};
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use futures::StreamExt;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

fn outages() -> &'static Mutex<HashMap<String, (Instant, String)>> {
    static O: OnceLock<Mutex<HashMap<String, (Instant, String)>>> = OnceLock::new();
    O.get_or_init(Default::default)
}

/// Did the gateway fail to reach a model for this task in the last few minutes?
pub fn recent_outage(ticket: &str) -> Option<String> {
    let map = outages().lock().ok()?;
    map.get(ticket).filter(|(at, _)| at.elapsed() < Duration::from_secs(180)).map(|(_, why)| why.clone())
}

fn note_outage(ticket: &str, why: &str) {
    if let Ok(mut map) = outages().lock() {
        map.insert(ticket.to_owned(), (Instant::now(), why.to_owned()));
    }
}

fn err(status: StatusCode, msg: &str) -> Response {
    (status, axum::Json(json!({ "error": { "message": msg, "type": "acw_gateway" } }))).into_response()
}

/// Token counts from the end of a response body, streamed or not, Responses or Chat Completions.
pub fn usage_from(tail: &str) -> Usage {
    static RE: OnceLock<(Regex, Regex)> = OnceLock::new();
    let (inp, outp) = RE.get_or_init(|| (Regex::new(r#""(?:input_tokens|prompt_tokens)"\s*:\s*(\d+)"#).expect("valid"), Regex::new(r#""(?:output_tokens|completion_tokens)"\s*:\s*(\d+)"#).expect("valid")));
    let last = |re: &Regex| re.captures_iter(tail).last().and_then(|c| c[1].parse().ok()).unwrap_or(0);
    Usage { input: last(inp), output: last(outp) }
}

pub async fn handle(State(eng): State<Arc<Engine>>, Path((token, rest)): Path<(String, String)>, method: Method, headers: HeaderMap, body: Bytes) -> Response {
    let Ok(Some(name)) = eng.store.secret_name_for("gw:", &token) else { return err(StatusCode::UNAUTHORIZED, "无效的任务令牌") };
    let ticket_id = name.trim_start_matches("gw:").to_owned();
    let Ok(t) = eng.ticket(&ticket_id) else { return err(StatusCode::UNAUTHORIZED, "任务不存在") };
    if !t.stage.is_active() {
        return err(StatusCode::FORBIDDEN, "任务现在不在运行，令牌不可用");
    }
    let Ok(settings) = eng.settings() else { return err(StatusCode::INTERNAL_SERVER_ERROR, "读不到设置") };
    if over_budget(&t, &settings) {
        return err(StatusCode::PAYMENT_REQUIRED, "任务超出预算，等审批人决定");
    }
    let rest = rest.trim_start_matches("v1/").to_owned();
    if !["responses", "chat/completions", "models"].contains(&rest.as_str()) {
        return err(StatusCode::NOT_FOUND, "网关只转发 responses、chat/completions 和 models");
    }
    let targets = eng.stage_targets("worker").unwrap_or_default();
    if targets.is_empty() {
        return err(StatusCode::SERVICE_UNAVAILABLE, "设置里没有给“开发”阶段选模型");
    }
    let content_type = headers.get(header::CONTENT_TYPE).cloned();
    let mut last = String::from("没有可用的模型");
    for target in targets {
        if rest == "responses" && target.endpoint.api != "responses" {
            // this connection only speaks Chat Completions: translate, so codex can still use it
            match shim(&eng, &ticket_id, &target, &body).await {
                Ok(resp) => return resp,
                Err(Upstream::Unavailable(m)) => {
                    last = format!("{} / {}：{m}", target.endpoint.name, target.model);
                    continue;
                }
                Err(Upstream::Rejected(status, text)) => return (StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY), text).into_response(),
            }
        }
        // the configured model is what runs, whatever the agent asked for; this is also how the fallback swaps models
        let payload = match serde_json::from_slice::<Value>(&body) {
            Ok(mut v) if v.is_object() => {
                v["model"] = json!(target.model);
                Bytes::from(v.to_string())
            }
            _ => body.clone(),
        };
        let url = format!("{}/{}", target.endpoint.base.trim_end_matches('/'), rest);
        let mut req = eng.http.request(method.clone(), url).timeout(Duration::from_secs(900));
        if let Some(k) = &target.key {
            req = req.bearer_auth(k);
        }
        if let Some(ct) = &content_type {
            req = req.header(header::CONTENT_TYPE, ct);
        }
        if method != Method::GET {
            req = req.body(payload);
        }
        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                last = format!("{} / {}：{e}", target.endpoint.name, target.model);
                continue;
            }
        };
        let status = resp.status();
        if status.as_u16() == 408 || status.as_u16() == 429 || status.is_server_error() {
            last = format!("{} / {}：HTTP {}", target.endpoint.name, target.model, status.as_u16());
            continue;
        }
        let mut out = Response::builder().status(status.as_u16());
        if let Some(ct) = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()) {
            out = out.header(header::CONTENT_TYPE, ct);
        }
        let ctx = (eng.clone(), ticket_id.clone(), target.clone());
        let stream = futures::stream::unfold((Box::pin(resp.bytes_stream()), Vec::<u8>::new(), Some(ctx)), |(mut st, mut acc, mut ctx)| async move {
            match st.next().await {
                Some(Ok(chunk)) => {
                    acc.extend_from_slice(&chunk);
                    if acc.len() > 256 * 1024 {
                        let cut = acc.len() - 128 * 1024;
                        acc.drain(..cut);
                    }
                    Some((Ok::<Bytes, std::io::Error>(chunk), (st, acc, ctx)))
                }
                Some(Err(e)) => Some((Err(std::io::Error::other(e)), (st, acc, ctx))),
                None => {
                    if let Some((eng, ticket, target)) = ctx.take() {
                        finish(&eng, &ticket, &target, &acc);
                    }
                    None
                }
            }
        });
        return out.body(Body::from_stream(stream)).unwrap_or_else(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "网关内部错误"));
    }
    note_outage(&ticket_id, &last);
    err(StatusCode::SERVICE_UNAVAILABLE, &last)
}

enum Upstream {
    Unavailable(String),
    Rejected(u16, String),
}

fn text_of(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts.iter().filter_map(|p| p.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n"),
        _ => String::new(),
    }
}

/// A Responses API request, as codex sends it, rewritten as a Chat Completions request.
/// Function tools carry over one to one; hosted tools (web search and the like) are dropped,
/// because a Chat Completions service cannot run them.
pub fn responses_to_chat(body: &Value, model: &str) -> Value {
    let mut messages: Vec<Value> = Vec::new();
    if let Some(ins) = body.get("instructions").and_then(Value::as_str).filter(|s| !s.is_empty()) {
        messages.push(json!({ "role": "system", "content": ins }));
    }
    for item in body.get("input").and_then(Value::as_array).into_iter().flatten() {
        match item.get("type").and_then(Value::as_str).unwrap_or("message") {
            "message" => {
                let role = match item.get("role").and_then(Value::as_str).unwrap_or("user") {
                    "developer" => "system",
                    other => other,
                };
                messages.push(json!({ "role": role, "content": text_of(item.get("content").unwrap_or(&Value::Null)) }));
            }
            "function_call" => {
                let call = json!({ "id": item["call_id"], "type": "function", "function": { "name": item["name"], "arguments": item.get("arguments").and_then(Value::as_str).unwrap_or("{}") } });
                match messages.last_mut().filter(|m| m["role"] == "assistant" && m.get("tool_calls").is_some()) {
                    Some(prev) => {
                        if let Some(calls) = prev["tool_calls"].as_array_mut() {
                            calls.push(call);
                        }
                    }
                    None => messages.push(json!({ "role": "assistant", "content": null, "tool_calls": [call] })),
                }
            }
            "function_call_output" => {
                let out = item.get("output").unwrap_or(&Value::Null);
                let content = match out {
                    Value::String(s) => s.clone(),
                    Value::Object(o) => o.get("content").map(text_of).filter(|s| !s.is_empty()).unwrap_or_else(|| out.to_string()),
                    other => other.to_string(),
                };
                messages.push(json!({ "role": "tool", "tool_call_id": item["call_id"], "content": content }));
            }
            _ => {} // reasoning and other items have no Chat Completions equivalent
        }
    }
    let tools: Vec<Value> = body
        .get("tools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|t| t["type"] == "function" && t.get("name").is_some())
        .map(|t| json!({ "type": "function", "function": { "name": t["name"], "description": t.get("description").cloned().unwrap_or(json!("")), "parameters": t.get("parameters").cloned().unwrap_or(json!({ "type": "object", "properties": {} })) } }))
        .collect();
    let mut out = json!({ "model": model, "messages": messages, "stream": false });
    if !tools.is_empty() {
        out["tools"] = Value::Array(tools);
        out["tool_choice"] = json!("auto");
    }
    out
}

/// A Chat Completions reply rewritten as the Responses event stream codex reads.
pub fn chat_to_sse(chat: &Value) -> String {
    let msg = &chat["choices"][0]["message"];
    let usage = usage_from(&chat.to_string());
    let mut events = vec![json!({ "type": "response.created", "response": { "id": "resp_acw" } })];
    let mut index = 0;
    let text = msg.get("content").and_then(Value::as_str).unwrap_or_default();
    let calls: Vec<&Value> = msg.get("tool_calls").and_then(Value::as_array).into_iter().flatten().collect();
    if !text.is_empty() || calls.is_empty() {
        events.push(json!({ "type": "response.output_item.done", "output_index": index, "item": { "type": "message", "role": "assistant", "id": "msg_acw", "content": [{ "type": "output_text", "text": text }] } }));
        index += 1;
    }
    for c in calls {
        events.push(json!({ "type": "response.output_item.done", "output_index": index, "item": { "type": "function_call", "id": format!("fc_{index}"), "call_id": c["id"], "name": c["function"]["name"], "arguments": c["function"].get("arguments").and_then(Value::as_str).unwrap_or("{}") } }));
        index += 1;
    }
    events.push(json!({ "type": "response.completed", "response": { "id": "resp_acw", "usage": { "input_tokens": usage.input, "input_tokens_details": null, "output_tokens": usage.output, "output_tokens_details": null, "total_tokens": usage.input + usage.output } } }));
    events.iter().map(|e| format!("event: {}\ndata: {}\n\n", e["type"].as_str().unwrap_or_default(), e)).collect()
}

async fn shim(eng: &Engine, ticket: &str, target: &Target, body: &Bytes) -> Result<Response, Upstream> {
    let req_body: Value = serde_json::from_slice(body).map_err(|e| Upstream::Rejected(400, format!("请求不是 JSON：{e}")))?;
    let chat_req = responses_to_chat(&req_body, &target.model);
    let url = format!("{}/chat/completions", target.endpoint.base.trim_end_matches('/'));
    let mut req = eng.http.post(url).timeout(Duration::from_secs(900)).json(&chat_req);
    if let Some(k) = &target.key {
        req = req.bearer_auth(k);
    }
    let resp = req.send().await.map_err(|e| Upstream::Unavailable(e.to_string()))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| Upstream::Unavailable(e.to_string()))?;
    if status.as_u16() == 408 || status.as_u16() == 429 || status.is_server_error() {
        return Err(Upstream::Unavailable(format!("HTTP {}", status.as_u16())));
    }
    if !status.is_success() {
        return Err(Upstream::Rejected(status.as_u16(), text));
    }
    let chat: Value = serde_json::from_str(&text).map_err(|e| Upstream::Unavailable(format!("响应不是 JSON：{e}")))?;
    finish(eng, ticket, target, text.as_bytes());
    Ok(([(header::CONTENT_TYPE, "text/event-stream")], chat_to_sse(&chat)).into_response())
}

fn finish(eng: &Engine, ticket: &str, target: &Target, body_tail: &[u8]) {
    let usage = usage_from(&String::from_utf8_lossy(body_tail));
    if let Err(e) = eng.record_cost(Some(ticket), "worker", target, usage) {
        tracing::warn!("记录 {ticket} 的模型成本失败：{e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_usage_from_streamed_and_plain_bodies() {
        let sse = "event: response.output_text.delta\ndata: {\"delta\":\"hi\"}\n\nevent: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":1200,\"input_tokens_details\":{\"cached_tokens\":0},\"output_tokens\":85,\"total_tokens\":1285}}}\n\n";
        assert_eq!(usage_from(sse), Usage { input: 1200, output: 85 });
        let chat = r#"{"choices":[],"usage":{"prompt_tokens": 40, "completion_tokens": 7}}"#;
        assert_eq!(usage_from(chat), Usage { input: 40, output: 7 });
        assert_eq!(usage_from("no usage here"), Usage::default());
    }

    #[test]
    fn a_codex_request_becomes_a_chat_request() {
        let body = json!({
            "model": "whatever", "stream": true,
            "input": [
                { "type": "message", "role": "developer", "content": [{ "type": "input_text", "text": "rules" }] },
                { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "do it" }] },
                { "type": "reasoning", "summary": [] },
                { "type": "function_call", "call_id": "c1", "name": "exec_command", "arguments": "{\"cmd\":\"ls\"}" },
                { "type": "function_call_output", "call_id": "c1", "output": "a.txt" },
            ],
            "tools": [
                { "type": "function", "name": "exec_command", "description": "run", "parameters": { "type": "object", "properties": { "cmd": { "type": "string" } } } },
                { "type": "web_search" },
                { "type": "namespace", "name": "multi_agent_v1" },
            ],
        });
        let chat = responses_to_chat(&body, "deepseek-chat");
        assert_eq!(chat["model"], "deepseek-chat");
        assert_eq!(chat["stream"], false);
        let roles: Vec<&str> = chat["messages"].as_array().unwrap().iter().map(|m| m["role"].as_str().unwrap()).collect();
        assert_eq!(roles, ["system", "user", "assistant", "tool"]);
        assert_eq!(chat["messages"][2]["tool_calls"][0]["function"]["name"], "exec_command");
        assert_eq!(chat["messages"][3]["tool_call_id"], "c1");
        assert_eq!(chat["tools"].as_array().unwrap().len(), 1, "hosted tools are dropped");
    }

    #[test]
    fn a_chat_reply_becomes_a_responses_stream() {
        let chat = json!({ "choices": [{ "message": { "role": "assistant", "content": null, "tool_calls": [{ "id": "call_9", "type": "function", "function": { "name": "exec_command", "arguments": "{\"cmd\":\"ls\"}" } }] } }], "usage": { "prompt_tokens": 50, "completion_tokens": 9 } });
        let sse = chat_to_sse(&chat);
        let types: Vec<&str> = sse.lines().filter_map(|l| l.strip_prefix("event: ")).collect();
        assert_eq!(types, ["response.created", "response.output_item.done", "response.completed"]);
        assert!(sse.contains("\"call_id\":\"call_9\"") && sse.contains("\"input_tokens\":50") && sse.contains("\"output_tokens\":9"));
        let plain = chat_to_sse(&json!({ "choices": [{ "message": { "role": "assistant", "content": "done" } }] }));
        assert!(plain.contains("\"output_text\"") && plain.contains("done"));
    }
}
