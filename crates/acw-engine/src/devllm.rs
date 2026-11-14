//! A stand-in for a model service, for demos and tests without network or keys. It speaks enough
//! of the OpenAI-compatible API for the Engine (`/models`, `/chat/completions`) and for codex
//! (`/responses`, streamed), and answers by simple rules, not by a model:
//!
//!   router    opens a task when the message names a project (or the channel is bound), else asks;
//!             the model `dev-tiny` always asks, as a worse router for eval runs
//!   reviewer  reports a P1 for every added line containing `BUG:` and a P3 for `NIT:`
//!   verifier  confirms, unless the finding's title contains `不确定`
//!   tester    turns every acceptance criterion that quotes a command in backticks into a shell test
//!   responses asks the agent to run one shell command, then says it is done

use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

#[derive(Default)]
pub struct DevLlm {
    /// Fail this many of the next requests with 503, to exercise retries and waiting.
    pub fail_next: AtomicU32,
    pub calls: AtomicU32,
}

pub fn router(state: Arc<DevLlm>) -> Router {
    Router::new()
        .route("/v1/models", get(|| async { Json(json!({ "object": "list", "data": [{ "id": "dev-small" }, { "id": "dev-large" }, { "id": "dev-tiny" }] })) }))
        .route("/v1/chat/completions", post(chat))
        .route("/v1/responses", post(responses))
        .with_state(state)
}

fn backticked(s: &str) -> Vec<String> {
    s.split('`').skip(1).step_by(2).map(str::to_owned).filter(|c| !c.trim().is_empty()).collect()
}

fn route(user: &Value) -> Value {
    let msg = user["message"].as_str().unwrap_or_default();
    let projects = user["projects"].as_array().cloned().unwrap_or_default();
    let low = msg.to_lowercase();
    let named: Vec<&Value> = projects
        .iter()
        .filter(|p| std::iter::once(&p["name"]).chain(p["aliases"].as_array().into_iter().flatten()).filter_map(Value::as_str).any(|a| !a.is_empty() && low.contains(&a.to_lowercase())))
        .collect();
    let project = match named.as_slice() {
        [one] => one["id"].as_str().map(str::to_owned),
        [] => user["channel_bound_project"].as_str().map(str::to_owned),
        _ => None,
    };
    if msg.ends_with('?') || msg.ends_with('？') {
        return json!({ "decision": "answer", "confidence": "high", "reply": "这是演示用的规则路由，只能回答：现在的任务进度请看任务列表。", "why": "消息是提问" });
    }
    match project {
        Some(p) => {
            let cmds = backticked(msg);
            let accept: Vec<String> = if cmds.is_empty() { vec!["按需求完成，现有测试通过".into()] } else { cmds.iter().map(|c| format!("运行 `{c}` 成功")).collect() };
            json!({ "decision": "new_ticket", "project": p, "confidence": "high", "reply": "", "why": "消息里写了项目名，或渠道绑定了项目",
                "mandate": { "goal": msg, "scope": ["和需求直接相关的代码"], "not": [], "accept": accept, "assume": [], "open_question": null } })
        }
        None => json!({ "decision": "ask", "confidence": "low", "reply": "这个需求属于哪个项目？", "why": if named.len() > 1 { "消息同时匹配多个项目" } else { "消息里没有项目名，渠道也没有绑定项目" } }),
    }
}

fn review(user: &Value) -> Value {
    let diff = user["diff"].as_str().unwrap_or_default();
    let ignore: Vec<&str> = user["ignore"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
    let (mut file, mut line_no, mut findings) = (String::new(), 0u32, Vec::new());
    for l in diff.lines() {
        if let Some(p) = l.strip_prefix("+++ b/") {
            file = p.to_owned();
        } else if l.starts_with("@@") {
            line_no = l.split('+').nth(1).and_then(|x| x.split([',', ' ']).next()).and_then(|x| x.parse().ok()).unwrap_or(0);
        } else if l.starts_with('+') {
            for (tag, sev) in [("BUG:", "p1"), ("NIT:", "p3")] {
                if let Some(i) = l.find(tag) {
                    let title = l[i + tag.len()..].trim().to_owned();
                    if !ignore.contains(&title.as_str()) {
                        findings.push(json!({ "severity": sev, "title": title, "file": file, "line": line_no, "evidence": "新增的这一行自己标出了问题" }));
                    }
                }
            }
            line_no += 1;
        } else if !l.starts_with('-') {
            line_no += 1;
        }
    }
    json!({ "findings": findings })
}

fn tests(user: &Value) -> Value {
    let dir = user["dir"].as_str().unwrap_or("tests").trim_end_matches('/');
    let out: Vec<Value> = user["accept"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .enumerate()
        .filter_map(|(i, a)| backticked(a).first().map(|cmd| json!({ "criterion": i + 1, "path": format!("{dir}/acw_c{}.sh", i + 1), "content": format!("#!/bin/sh\nset -e\n{cmd}\n") })))
        .collect();
    json!({ "tests": out })
}

async fn chat(State(st): State<Arc<DevLlm>>, Json(body): Json<Value>) -> Response {
    st.calls.fetch_add(1, Ordering::Relaxed);
    if st.fail_next.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_sub(1)).is_ok() {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "error": { "message": "overloaded (dev)" } }))).into_response();
    }
    let msgs = body["messages"].as_array().cloned().unwrap_or_default();
    let system = msgs.iter().find(|m| m["role"] == "system").and_then(|m| m["content"].as_str()).unwrap_or_default();
    let user_text = msgs.iter().rev().find(|m| m["role"] == "user").and_then(|m| m["content"].as_str()).unwrap_or_default();
    let user: Value = serde_json::from_str(user_text).unwrap_or(Value::Null);
    // a Worker conversation arriving as Chat Completions (through the gateway's translation)
    if body["tools"].as_array().is_some_and(|t| t.iter().any(|x| x["function"]["name"] == "exec_command")) {
        let ran = msgs.last().is_some_and(|m| m["role"] == "tool");
        let cmd = std::env::var("ACW_DEVLLM_CMD").unwrap_or_else(|_| "printf 'changed by the agent\\n' >> README.md".into());
        let message = if ran {
            json!({ "role": "assistant", "content": "已按需求改完，并跑过检查。" })
        } else {
            json!({ "role": "assistant", "content": null, "tool_calls": [{ "id": "call_dev", "type": "function", "function": { "name": "exec_command", "arguments": json!({ "cmd": cmd }).to_string() } }] })
        };
        return Json(json!({ "id": "dev", "object": "chat.completion", "model": body["model"], "choices": [{ "index": 0, "finish_reason": if ran { "stop" } else { "tool_calls" }, "message": message }], "usage": { "prompt_tokens": body.to_string().len() / 4, "completion_tokens": 30 } })).into_response();
    }
    let reply = if system.contains("没有登记为成员") {
        "你还没有登记为成员，我只能回答问题。要改代码的话，请先让管理员登记。".to_owned()
    } else if system.contains("Router") && body["model"] == "dev-tiny" {
        // a deliberately worse router, to have something for the eval set to catch
        json!({ "decision": "ask", "confidence": "low", "reply": "这个需求属于哪个项目？", "why": "dev-tiny 什么都问" }).to_string()
    } else if system.contains("Router") {
        route(&user).to_string()
    } else if system.contains("项目记忆") {
        let lessons: Vec<Value> = user["confirmed_findings"].as_array().into_iter().flatten().filter_map(|f| Some(json!({ "text": format!("改 {} 时注意：{}", f["file"].as_str()?, f["title"].as_str()?), "why": "审查里被证实并修复过" }))).collect();
        json!({ "lessons": lessons }).to_string()
    } else if system.contains("复核") {
        let unsure = user["finding"]["title"].as_str().unwrap_or_default().contains("不确定");
        json!({ "confirmed": !unsure, "reason": if unsure { "说不出具体的触发路径" } else { "diff 里能看到这条路径" } }).to_string()
    } else if system.contains("代码审查者") {
        review(&user).to_string()
    } else if system.contains("测试编写者") {
        tests(&user).to_string()
    } else {
        "（演示模型）".to_owned()
    };
    let usage = json!({ "prompt_tokens": (system.len() + user_text.len()) / 4, "completion_tokens": reply.len() / 4 });
    Json(json!({ "id": "dev", "object": "chat.completion", "model": body["model"], "choices": [{ "index": 0, "finish_reason": "stop", "message": { "role": "assistant", "content": reply } }], "usage": usage })).into_response()
}

fn sse(events: &[Value]) -> Response {
    let body: String = events.iter().map(|e| format!("event: {}\ndata: {}\n\n", e["type"].as_str().unwrap_or_default(), e)).collect();
    ([(header::CONTENT_TYPE, "text/event-stream")], body).into_response()
}

/// The Responses API as codex uses it: first turn, call a shell tool; after the tool output, finish.
async fn responses(State(st): State<Arc<DevLlm>>, Json(body): Json<Value>) -> Response {
    st.calls.fetch_add(1, Ordering::Relaxed);
    if let Ok(dir) = std::env::var("ACW_DEVLLM_DUMP") {
        let _ = std::fs::write(format!("{dir}/responses-{}.json", st.calls.load(Ordering::Relaxed)), serde_json::to_vec_pretty(&body).unwrap_or_default());
    }
    if st.fail_next.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_sub(1)).is_ok() {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "error": { "message": "overloaded (dev)" } }))).into_response();
    }
    let input = body["input"].as_array().cloned().unwrap_or_default();
    // mid-turn (the last item is a tool result) means the command has run: finish. A new user message starts a new turn.
    let done = input.last().is_some_and(|i| matches!(i["type"].as_str(), Some("function_call_output") | Some("custom_tool_call_output") | Some("local_shell_call_output")));
    let usage = json!({ "input_tokens": body.to_string().len() / 4, "input_tokens_details": null, "output_tokens": 40, "output_tokens_details": null, "total_tokens": body.to_string().len() / 4 + 40 });
    let completed = json!({ "type": "response.completed", "response": { "id": "resp_dev", "usage": usage } });
    let created = json!({ "type": "response.created", "response": { "id": "resp_dev" } });
    if done {
        let item = json!({ "type": "message", "role": "assistant", "id": "msg_dev", "content": [{ "type": "output_text", "text": "已按需求改完，并跑过检查。" }] });
        return sse(&[created, json!({ "type": "response.output_item.done", "output_index": 0, "item": item }), completed]);
    }
    let cmd = std::env::var("ACW_DEVLLM_CMD").unwrap_or_else(|_| "printf 'changed by the agent\\n' >> README.md".into());
    let names: Vec<&str> = body["tools"].as_array().into_iter().flatten().filter_map(|t| t["name"].as_str()).collect();
    // codex has shipped several shell tools over time; use whichever this version offers
    let (name, args) = if names.contains(&"exec_command") {
        ("exec_command", json!({ "cmd": cmd }))
    } else if names.contains(&"shell_command") {
        ("shell_command", json!({ "command": cmd }))
    } else {
        ("shell", json!({ "command": ["bash", "-lc", cmd] }))
    };
    let item = json!({ "type": "function_call", "id": "fc_dev", "call_id": "call_dev", "name": name, "arguments": args.to_string() });
    sse(&[created, json!({ "type": "response.output_item.done", "output_index": 0, "item": item }), completed])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reviewer_rule_reads_added_lines_only() {
        let diff = "diff --git a/x.sh b/x.sh\n--- a/x.sh\n+++ b/x.sh\n@@ -1,2 +1,3 @@\n keep\n-old BUG: gone\n+new # BUG: 空输入没有处理\n+fine\n";
        let v = review(&json!({ "diff": diff, "ignore": [] }));
        assert_eq!(v["findings"].as_array().unwrap().len(), 1);
        assert_eq!(v["findings"][0]["title"], "空输入没有处理");
        assert_eq!(v["findings"][0]["line"], 2);
        assert!(review(&json!({ "diff": diff, "ignore": ["空输入没有处理"] }))["findings"].as_array().unwrap().is_empty());
    }

    #[test]
    fn tester_rule_uses_quoted_commands() {
        let v = tests(&json!({ "dir": "tests/", "accept": ["1. 运行 `sh greet.sh Kai` 输出问候语", "2. 文档更新"] }));
        assert_eq!(v["tests"].as_array().unwrap().len(), 1);
        assert_eq!(v["tests"][0]["path"], "tests/acw_c1.sh");
    }
}
