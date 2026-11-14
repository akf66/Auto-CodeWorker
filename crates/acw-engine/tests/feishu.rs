//! Feishu inbound, against a local stand-in for the open platform.
mod common;
use acw_engine::feishu::{encrypt, signature};
use axum::{extract::{Path, State}, routing::post, Json, Router};
use common::*;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

type Sent = Arc<Mutex<Vec<(String, String, String)>>>;

/// Hands out a token and records replies as (message id, bearer, text).
async fn platform() -> (String, Sent) {
    let sent: Sent = Default::default();
    let app = Router::new()
        .route("/open-apis/auth/v3/tenant_access_token/internal", post(|Json(b): Json<Value>| async move {
            if b["app_id"] == "cli_test" && b["app_secret"] == "sec" { Json(json!({ "code": 0, "msg": "ok", "tenant_access_token": "t-123", "expire": 7200 })) } else { Json(json!({ "code": 10003, "msg": "invalid param" })) }
        }))
        .route("/open-apis/im/v1/messages/{id}/reply", post(|State(sent): State<Sent>, Path(id): Path<String>, h: axum::http::HeaderMap, Json(b): Json<Value>| async move {
            let text = serde_json::from_str::<Value>(b["content"].as_str().unwrap_or("{}")).unwrap()["text"].as_str().unwrap_or_default().to_owned();
            sent.lock().unwrap().push((id, h.get("authorization").and_then(|v| v.to_str().ok()).unwrap_or_default().to_owned(), text));
            Json(json!({ "code": 0, "msg": "success", "data": {} }))
        }))
        .with_state(sent.clone());
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", l.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
    (base, sent)
}

fn message(event_id: &str, open_id: &str, chat: &str, chat_type: &str, text: &str) -> Value {
    json!({ "schema": "2.0", "header": { "event_id": event_id, "event_type": "im.message.receive_v1", "token": "vt", "app_id": "cli_test" },
        "event": { "sender": { "sender_id": { "open_id": open_id }, "sender_type": "user" },
            "message": { "message_id": format!("om_{event_id}"), "root_id": "", "chat_id": chat, "chat_type": chat_type, "message_type": "text",
                "content": json!({ "text": text }).to_string(), "mentions": if chat_type == "group" { json!([{ "key": "@_user_1", "name": "ACW" }]) } else { json!([]) } } } })
}

async fn post_event(h: &Harness, key: &str, payload: &Value, tamper: bool) -> reqwest::Response {
    let body = json!({ "encrypt": encrypt(key, &payload.to_string(), [3; 16]) }).to_string();
    let sig = signature("1700000000", "nonce", if tamper { "other" } else { key }, body.as_bytes());
    reqwest::Client::new().post(format!("{}/webhooks/feishu", h.base)).header("x-lark-request-timestamp", "1700000000").header("x-lark-request-nonce", "nonce").header("x-lark-signature", sig).body(body).send().await.unwrap()
}

async fn wait_for(sent: &Sent, n: usize) -> Vec<(String, String, String)> {
    for _ in 0..100 {
        if sent.lock().unwrap().len() >= n {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    sent.lock().unwrap().clone()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_feishu_message_is_routed_once_and_answered_in_place() {
    let (fs, sent) = platform().await;
    for (k, v) in [("ACW_T1_APP", "cli_test"), ("ACW_T1_SEC", "sec"), ("ACW_T1_VT", "vt"), ("ACW_T1_EK", "ek")] {
        std::env::set_var(k, v);
    }
    let h = Harness::with("#!/bin/sh\nsleep 60\n", |c| {
        c.feishu.base = fs.clone();
        c.feishu.app_id_env = "ACW_T1_APP".into();
        c.feishu.app_secret_env = "ACW_T1_SEC".into();
        c.feishu.verify_token_env = "ACW_T1_VT".into();
        c.feishu.encrypt_key_env = "ACW_T1_EK".into();
        c.feishu.bot_name = "ACW".into();
    })
    .await;
    let kai = h.actor("kai");
    let mut lin = h.eng.store.read(|v| v.member("lin")).unwrap().unwrap();
    lin.feishu = Some("ou_lin".into());
    h.eng.upsert_member(&kai, lin).unwrap();
    let mut p = h.eng.project("hello").unwrap();
    p.channels.push("oc_hello".into());
    h.eng.upsert_project(&kai, p).unwrap();

    // the address check the platform does when the subscription is saved
    let r = post_event(&h, "ek", &json!({ "challenge": "c-42", "token": "vt", "type": "url_verification" }), false).await;
    assert_eq!(r.json::<Value>().await.unwrap()["challenge"], "c-42");
    // wrong token, wrong signature, unencrypted: all refused and logged
    assert_eq!(post_event(&h, "ek", &json!({ "challenge": "c", "token": "nope", "type": "url_verification" }), false).await.status(), 401);
    assert_eq!(post_event(&h, "ek", &message("e0", "ou_lin", "oc_hello", "group", "@_user_1 加个参数"), true).await.status(), 401);
    let plain = reqwest::Client::new().post(format!("{}/webhooks/feishu", h.base)).json(&message("e0", "ou_lin", "oc_hello", "group", "@_user_1 加个参数")).send().await.unwrap();
    assert_eq!(plain.status(), 401);
    assert_eq!(h.security().iter().filter(|(k, _)| k == "webhook 验签失败").count(), 3);
    assert!(h.eng.store.read(|v| v.tickets()).unwrap().is_empty());

    // a member @s the bot in the group bound to the project: no project name needed
    let ev = message("e1", "ou_lin", "oc_hello", "group", "@_user_1 greet.sh 加一个 --shout 参数");
    assert_eq!(post_event(&h, "ek", &ev, false).await.status(), 200);
    let got = wait_for(&sent, 1).await;
    assert_eq!(got.len(), 1, "{got:?}");
    assert_eq!((got[0].0.as_str(), got[0].1.as_str()), ("om_e1", "Bearer t-123"));
    assert!(got[0].2.starts_with("已开任务 T-1"), "{}", got[0].2);
    let t = h.ticket("T-1");
    assert_eq!((t.by.as_str(), t.project.as_str(), t.via.as_str()), ("lin", "hello", "oc_hello"));
    // the platform delivers the same event again: nothing happens twice
    assert_eq!(post_event(&h, "ek", &ev, false).await.status(), 200);
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    assert_eq!((h.eng.store.read(|v| v.tickets()).unwrap().len(), sent.lock().unwrap().len()), (1, 1));

    // someone who is not a member writes to the bot directly: an answer, never a task
    assert_eq!(post_event(&h, "ek", &message("e2", "ou_stranger", "oc_p2p", "p2p", "帮我给 hello 加个功能"), false).await.status(), 200);
    let got = wait_for(&sent, 2).await;
    assert!(got[1].2.contains("没有登记为成员"), "{}", got[1].2);
    assert_eq!(h.eng.store.read(|v| v.tickets()).unwrap().len(), 1);
    // a group message that does not @ the bot is not for it
    let mut chatter = message("e3", "ou_lin", "oc_hello", "group", "中午吃什么");
    chatter["event"]["message"]["mentions"] = json!([]);
    assert_eq!(post_event(&h, "ek", &chatter, false).await.status(), 200);
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    assert_eq!(sent.lock().unwrap().len(), 2);
}
