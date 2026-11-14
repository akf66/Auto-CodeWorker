//! Client for any OpenAI-compatible service: `GET {base}/models` and `POST {base}/chat/completions`.
//! The Router, Reviewer and Tester use this. The Worker (codex) does not: it talks to the
//! Engine's model gateway, which forwards its requests and injects the key.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Msg {
    pub role: String,
    pub content: String,
}

impl Msg {
    pub fn system(s: impl Into<String>) -> Self {
        Msg { role: "system".into(), content: s.into() }
    }
    pub fn user(s: impl Into<String>) -> Self {
        Msg { role: "user".into(), content: s.into() }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Usage {
    pub input: u64,
    pub output: u64,
}

#[derive(Clone, Debug)]
pub struct ChatReply {
    pub text: String,
    pub usage: Usage,
}

/// Why a call failed. Only `Unavailable` is worth retrying or sending to the fallback model.
#[derive(Debug)]
pub enum LlmError {
    /// Timeout, connection error, 408, 429 or 5xx.
    Unavailable(String),
    /// The service understood and refused: bad key, unknown model, bad request.
    Rejected(String),
}

impl std::fmt::Display for LlmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LlmError::Unavailable(s) => write!(f, "模型暂时不可用：{s}"),
            LlmError::Rejected(s) => write!(f, "模型服务拒绝了请求：{s}"),
        }
    }
}
impl std::error::Error for LlmError {}

#[derive(Clone)]
pub struct LlmClient {
    http: reqwest::Client,
}

impl Default for LlmClient {
    fn default() -> Self {
        Self::new()
    }
}

fn classify(status: reqwest::StatusCode, body: &str) -> LlmError {
    let brief: String = body.chars().take(300).collect();
    let msg = format!("HTTP {}：{}", status.as_u16(), brief);
    if status.as_u16() == 408 || status.as_u16() == 429 || status.is_server_error() {
        LlmError::Unavailable(msg)
    } else {
        LlmError::Rejected(msg)
    }
}

impl LlmClient {
    pub fn new() -> Self {
        LlmClient { http: reqwest::Client::builder().connect_timeout(Duration::from_secs(10)).build().expect("http client") }
    }

    fn url(base: &str, path: &str) -> String {
        format!("{}/{}", base.trim_end_matches('/'), path)
    }

    /// The model list is whatever the service returns. Nobody types a model name.
    pub async fn models(&self, base: &str, key: Option<&str>) -> Result<Vec<String>, LlmError> {
        let mut req = self.http.get(Self::url(base, "models")).timeout(Duration::from_secs(20));
        if let Some(k) = key {
            req = req.bearer_auth(k);
        }
        let resp = req.send().await.map_err(|e| LlmError::Unavailable(e.to_string()))?;
        let status = resp.status();
        let body = resp.text().await.map_err(|e| LlmError::Unavailable(e.to_string()))?;
        if !status.is_success() {
            return Err(classify(status, &body));
        }
        let v: Value = serde_json::from_str(&body).map_err(|e| LlmError::Rejected(format!("/models 返回的不是 JSON：{e}")))?;
        let list = v.get("data").and_then(Value::as_array).or_else(|| v.as_array());
        let mut ids: Vec<String> = list
            .map(|a| a.iter().filter_map(|m| m.get("id").and_then(Value::as_str).or_else(|| m.as_str())).map(str::to_owned).collect())
            .unwrap_or_default();
        ids.sort();
        ids.dedup();
        if ids.is_empty() {
            return Err(LlmError::Rejected("/models 没有返回任何模型".into()));
        }
        Ok(ids)
    }

    async fn chat_once(&self, base: &str, key: Option<&str>, body: &Value, timeout: Duration) -> Result<ChatReply, LlmError> {
        let mut req = self.http.post(Self::url(base, "chat/completions")).timeout(timeout).json(body);
        if let Some(k) = key {
            req = req.bearer_auth(k);
        }
        let resp = req.send().await.map_err(|e| LlmError::Unavailable(e.to_string()))?;
        let status = resp.status();
        let text = resp.text().await.map_err(|e| LlmError::Unavailable(e.to_string()))?;
        if !status.is_success() {
            return Err(classify(status, &text));
        }
        let v: Value = serde_json::from_str(&text).map_err(|e| LlmError::Unavailable(format!("响应不是 JSON：{e}")))?;
        let content = v.pointer("/choices/0/message/content").and_then(Value::as_str).unwrap_or_default().to_owned();
        let usage = Usage {
            input: v.pointer("/usage/prompt_tokens").and_then(Value::as_u64).unwrap_or(0),
            output: v.pointer("/usage/completion_tokens").and_then(Value::as_u64).unwrap_or(0),
        };
        Ok(ChatReply { text: content, usage })
    }

    /// One chat completion with up to two retries on `Unavailable`. With `want_json`, asks for a
    /// JSON object and, if the service rejects `response_format`, asks again without it.
    pub async fn chat(&self, base: &str, key: Option<&str>, model: &str, messages: &[Msg], want_json: bool) -> Result<ChatReply, LlmError> {
        let mut body = json!({ "model": model, "messages": messages, "stream": false });
        if want_json {
            body["response_format"] = json!({ "type": "json_object" });
        }
        let mut last = LlmError::Unavailable("没有发出请求".into());
        for attempt in 0..3u32 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(600 * 2u64.pow(attempt))).await;
            }
            match self.chat_once(base, key, &body, Duration::from_secs(180)).await {
                Ok(r) => return Ok(r),
                Err(LlmError::Rejected(m)) if want_json && m.contains("response_format") && body.get("response_format").is_some() => {
                    body.as_object_mut().map(|o| o.remove("response_format"));
                    last = LlmError::Rejected(m);
                }
                Err(e @ LlmError::Rejected(_)) => return Err(e),
                Err(e) => last = e,
            }
        }
        Err(last)
    }
}

/// Pull the JSON object out of a model reply: tolerates code fences and prose around it.
pub fn extract_json(text: &str) -> Result<Value> {
    let t = text.trim();
    if let Ok(v) = serde_json::from_str::<Value>(t) {
        return Ok(v);
    }
    let start = t.find('{').ok_or_else(|| anyhow!("回复里没有 JSON 对象"))?;
    let end = t.rfind('}').ok_or_else(|| anyhow!("回复里没有 JSON 对象"))?;
    if end <= start {
        return Err(anyhow!("回复里没有 JSON 对象"));
    }
    Ok(serde_json::from_str(&t[start..=end])?)
}

/// Amount for one call, from per-million-token prices.
pub fn price(input_price: f64, output_price: f64, usage: Usage) -> f64 {
    (usage.input as f64 * input_price + usage.output as f64 * output_price) / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_json_from_fenced_reply() {
        let v = extract_json("好的：\n```json\n{\"decision\": \"answer\", \"n\": 2}\n```\n").unwrap();
        assert_eq!(v["decision"], "answer");
        assert!(extract_json("没有对象").is_err());
    }

    #[test]
    fn price_is_per_million_tokens() {
        assert!((price(3.0, 15.0, Usage { input: 1_000_000, output: 200_000 }) - 6.0).abs() < 1e-9);
    }
}
