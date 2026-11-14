//! Feishu inbound: the event subscription endpoint of a self-built app. A text message to the bot
//! (direct, or an @ in a group) goes to the Router like a console message, and the Router's reply
//! is sent back as a reply to that message.
//!
//! What is trusted: with an encrypt key, the request signature (sha256 of timestamp, nonce, key
//! and body) and the decrypted payload; in every case the verification token inside the payload.
//! With neither configured, nothing is accepted.
//!
//! The sender is the message's open_id. A member whose `feishu` field holds that id acts with
//! their roles; anyone else is a visitor and only gets answers.

use crate::engine::*;
use crate::router::Incoming;
use acw_core::*;
use aes::cipher::{block_padding::Pkcs7, BlockModeDecrypt, BlockModeEncrypt, KeyIvInit};
use anyhow::{anyhow, bail, Result};
use base64::Engine as _;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::time::{Duration, Instant};

type Dec = cbc::Decryptor<aes::Aes256>;
type Enc = cbc::Encryptor<aes::Aes256>;

/// AES-256-CBC, key = sha256(encrypt key), the first 16 bytes of the decoded text are the IV.
pub fn decrypt(encrypt_key: &str, encrypted: &str) -> Result<String> {
    let raw = base64::engine::general_purpose::STANDARD.decode(encrypted.trim())?;
    if raw.len() < 32 || raw.len() % 16 != 0 {
        bail!("密文长度不对");
    }
    let key = Sha256::digest(encrypt_key.as_bytes());
    let (iv, body) = raw.split_at(16);
    let mut buf = body.to_vec();
    let iv: [u8; 16] = iv.try_into()?;
    let key: [u8; 32] = key.into();
    let plain = Dec::new(&key.into(), &iv.into()).decrypt_padded::<Pkcs7>(&mut buf).map_err(|_| anyhow!("解密失败：密钥不对或密文被改过"))?;
    Ok(String::from_utf8(plain.to_vec())?)
}

/// The inverse of `decrypt`, for tests and for trying the endpoint by hand.
pub fn encrypt(encrypt_key: &str, plain: &str, iv: [u8; 16]) -> String {
    let key: [u8; 32] = Sha256::digest(encrypt_key.as_bytes()).into();
    let mut buf = vec![0u8; plain.len() + 16];
    buf[..plain.len()].copy_from_slice(plain.as_bytes());
    let n = Enc::new(&key.into(), &iv.into()).encrypt_padded::<Pkcs7>(&mut buf, plain.len()).expect("buffer has room for padding").len();
    let mut out = iv.to_vec();
    out.extend_from_slice(&buf[..n]);
    base64::engine::general_purpose::STANDARD.encode(out)
}

pub fn signature(timestamp: &str, nonce: &str, encrypt_key: &str, body: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(timestamp.as_bytes());
    h.update(nonce.as_bytes());
    h.update(encrypt_key.as_bytes());
    h.update(body);
    hex::encode(h.finalize())
}

fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub struct Headers<'a> {
    pub timestamp: &'a str,
    pub nonce: &'a str,
    pub signature: &'a str,
}

/// What to answer the platform with.
pub enum Answer {
    Challenge(String),
    Accepted,
    Refused(String),
}

/// A text message for the bot.
#[derive(Debug, PartialEq)]
pub struct Message {
    pub message_id: String,
    pub sender: String,
    pub chat: String,
    pub thread: String,
    pub text: String,
}

/// Pull the message out of an `im.message.receive_v1` event. None: not something to act on.
pub fn parse_message(v: &Value, bot_name: &str) -> Option<Message> {
    if v["header"]["event_type"] != "im.message.receive_v1" {
        return None;
    }
    let (ev, msg) = (&v["event"], &v["event"]["message"]);
    if ev["sender"]["sender_type"].as_str().is_some_and(|t| t != "user") || msg["message_type"] != "text" {
        return None;
    }
    let mentions = msg["mentions"].as_array().cloned().unwrap_or_default();
    if msg["chat_type"] == "group" {
        let at_bot = if bot_name.is_empty() { !mentions.is_empty() } else { mentions.iter().any(|m| m["name"] == bot_name) };
        if !at_bot {
            return None;
        }
    }
    let content: Value = serde_json::from_str(msg["content"].as_str()?).ok()?;
    let mut text = content["text"].as_str()?.to_owned();
    for m in &mentions {
        if let Some(key) = m["key"].as_str() {
            // the bot's own mention goes; other people's become their names
            let name = m["name"].as_str().unwrap_or_default();
            let with = if (bot_name.is_empty() && m == &mentions[0]) || name == bot_name { String::new() } else { format!("@{name}") };
            text = text.replace(key, &with);
        }
    }
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return None;
    }
    let message_id = msg["message_id"].as_str()?.to_owned();
    let chat = msg["chat_id"].as_str()?.to_owned();
    let root = msg["root_id"].as_str().filter(|r| !r.is_empty()).unwrap_or(&message_id).to_owned();
    Some(Message { sender: ev["sender"]["sender_id"]["open_id"].as_str()?.to_owned(), thread: format!("feishu:{chat}:{root}"), chat, message_id, text })
}

impl Engine {
    fn feishu_env(&self, name: &str) -> String {
        std::env::var(name).unwrap_or_default()
    }

    /// Handle one request to the event subscription address.
    pub fn feishu_event(self: &Arc<Self>, h: Headers, body: &[u8]) -> Result<Answer> {
        let token = self.feishu_env(&self.cfg.feishu.verify_token_env);
        let key = self.feishu_env(&self.cfg.feishu.encrypt_key_env);
        if token.is_empty() && key.is_empty() {
            return Ok(Answer::Refused("没有配置飞书的校验令牌或加密密钥，不接收事件".into()));
        }
        let outer: Value = serde_json::from_slice(body).map_err(|_| invalid("不是 JSON"))?;
        let v: Value = match outer.get("encrypt").and_then(Value::as_str) {
            Some(enc) => {
                if key.is_empty() {
                    return Ok(Answer::Refused("收到了加密的事件，但没有配置加密密钥".into()));
                }
                match decrypt(&key, enc) {
                    Ok(p) => serde_json::from_str(&p).map_err(|_| invalid("解密后不是 JSON"))?,
                    Err(e) => return Ok(Answer::Refused(e.to_string())),
                }
            }
            None if !key.is_empty() => return Ok(Answer::Refused("配置了加密密钥，但收到的事件没有加密".into())),
            None => outer,
        };
        let is_challenge = v["type"] == "url_verification";
        // an event carries a signature when an encrypt key is set; the address check may not
        if !key.is_empty() && !(is_challenge && h.signature.is_empty()) && !same(&signature(h.timestamp, h.nonce, &key, body), h.signature) {
            return Ok(Answer::Refused("签名不对".into()));
        }
        let got = v["token"].as_str().or_else(|| v["header"]["token"].as_str()).unwrap_or_default();
        if !token.is_empty() && !same(got, &token) {
            return Ok(Answer::Refused("校验令牌不对".into()));
        }
        if is_challenge {
            return Ok(Answer::Challenge(v["challenge"].as_str().unwrap_or_default().to_owned()));
        }
        let Some(msg) = parse_message(&v, &self.cfg.feishu.bot_name) else { return Ok(Answer::Accepted) };
        // the platform redelivers when it does not get an answer in time. Its docs say to deduplicate
        // message events by message id, not event id
        let first = self.store.write(|tx| {
            if tx.view().inbound_seen("feishu", &msg.message_id)? {
                return Ok(false);
            }
            tx.emit("feishu", None, Event::InboundSeen { source: "feishu".into(), id: msg.message_id.clone() })?;
            Ok(true)
        })?;
        if first {
            let eng = self.clone();
            tokio::spawn(async move {
                let reply = match eng.route(Incoming { sender: msg.sender.clone(), channel: msg.chat.clone(), thread: msg.thread.clone(), text: msg.text.clone() }).await {
                    Ok(r) => r.output.reply,
                    Err(e) => format!("这条消息没有处理成功：{e}"),
                };
                if reply.trim().is_empty() {
                    return;
                }
                let sent = match eng.feishu_reply(&msg.message_id, &reply).await {
                    Ok(()) => true,
                    Err(e) => {
                        tracing::warn!("飞书回复失败：{e}");
                        false
                    }
                };
                let _ = eng.store.write(|tx| tx.emit("engine", None, Event::Notified { kind: "feishu-reply".into(), to: msg.sender.clone(), text: reply.clone(), sent }).map(|_| ()));
            });
        }
        Ok(Answer::Accepted)
    }

    async fn feishu_tenant_token(&self, fresh: bool) -> Result<String> {
        if !fresh {
            if let Some((t, until)) = self.feishu_token.lock().ok().and_then(|g| g.clone()) {
                if until > Instant::now() {
                    return Ok(t);
                }
            }
        }
        let (id, secret) = (self.feishu_env(&self.cfg.feishu.app_id_env), self.feishu_env(&self.cfg.feishu.app_secret_env));
        if id.is_empty() || secret.is_empty() {
            bail!("没有配置飞书应用的 app id 和 app secret，不能回复");
        }
        let url = format!("{}/open-apis/auth/v3/tenant_access_token/internal", self.cfg.feishu.base.trim_end_matches('/'));
        let v: Value = self.http.post(url).timeout(Duration::from_secs(15)).json(&json!({ "app_id": id, "app_secret": secret })).send().await?.json().await?;
        let token = v["tenant_access_token"].as_str().filter(|_| v["code"] == 0).ok_or_else(|| anyhow!("取飞书访问令牌失败：{}", v["msg"].as_str().unwrap_or("没有说明")))?.to_owned();
        let ttl = v["expire"].as_u64().unwrap_or(7200).saturating_sub(300).max(60);
        if let Ok(mut g) = self.feishu_token.lock() {
            *g = Some((token.clone(), Instant::now() + Duration::from_secs(ttl)));
        }
        Ok(token)
    }

    /// Reply to a message, as text.
    pub async fn feishu_reply(&self, message_id: &str, text: &str) -> Result<()> {
        if !message_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
            bail!("消息编号不合规");
        }
        let url = format!("{}/open-apis/im/v1/messages/{message_id}/reply", self.cfg.feishu.base.trim_end_matches('/'));
        let body = json!({ "msg_type": "text", "content": json!({ "text": text }).to_string() });
        let mut last = anyhow!("没有发出去");
        for fresh in [false, true] {
            let token = self.feishu_tenant_token(fresh).await?;
            let resp = self.http.post(&url).timeout(Duration::from_secs(15)).bearer_auth(token).json(&body).send().await?;
            let status = resp.status();
            let v: Value = resp.json().await.unwrap_or(Value::Null);
            if status.is_success() && v["code"] == 0 {
                return Ok(());
            }
            // an expired or revoked token: get a new one and try once more
            last = anyhow!("飞书返回 {}：{}", status.as_u16(), v["msg"].as_str().unwrap_or("没有说明"));
        }
        Err(last)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_is_encrypted_decrypts_and_a_wrong_key_does_not() {
        let enc = encrypt("key-1", "{\"challenge\":\"abc\"}", [7; 16]);
        assert_eq!(decrypt("key-1", &enc).unwrap(), "{\"challenge\":\"abc\"}");
        assert!(decrypt("key-2", &enc).is_err());
        assert!(decrypt("key-1", "AAAA").is_err());
        assert_eq!(signature("1", "n", "k", b"body"), hex::encode(Sha256::digest(b"1nkbody")));
    }

    fn event(chat_type: &str, text: &str, mentions: Value) -> Value {
        json!({ "schema": "2.0", "header": { "event_id": "ev1", "event_type": "im.message.receive_v1", "token": "t" },
            "event": { "sender": { "sender_id": { "open_id": "ou_1" }, "sender_type": "user" },
                "message": { "message_id": "om_1", "root_id": "", "chat_id": "oc_1", "chat_type": chat_type, "message_type": "text", "content": json!({ "text": text }).to_string(), "mentions": mentions } } })
    }

    #[test]
    fn a_group_message_counts_only_when_it_mentions_the_bot() {
        let at = json!([{ "key": "@_user_1", "name": "Auto-CodWorker" }, { "key": "@_user_2", "name": "林舟" }]);
        let m = parse_message(&event("group", "@_user_1 给 hello 加个参数，问 @_user_2", at.clone()), "Auto-CodWorker").unwrap();
        assert_eq!((m.text.as_str(), m.sender.as_str(), m.thread.as_str()), ("给 hello 加个参数，问 @林舟", "ou_1", "feishu:oc_1:om_1"));
        assert_eq!(parse_message(&event("group", "大家好", json!([])), ""), None);
        assert_eq!(parse_message(&event("group", "@_user_1 你好", json!([{ "key": "@_user_1", "name": "别人" }])), "Auto-CodWorker"), None);
        assert_eq!(parse_message(&event("p2p", "进度怎么样？", json!([])), "").unwrap().text, "进度怎么样？");
        let mut image = event("p2p", "x", json!([]));
        image["event"]["message"]["message_type"] = json!("image");
        assert_eq!(parse_message(&image, ""), None);
    }
}
