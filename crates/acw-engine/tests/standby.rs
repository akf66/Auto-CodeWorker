//! Hot standby: a follower keeps up, is read-only, takes over under a new epoch, and the old
//! primary stops taking commands.
mod common;
use acw_core::*;
use acw_engine::{build, config::Config, standby::NodeRole, start};
use common::*;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;

async fn follower_of(h: &Harness, name: &str, token_env: &str) -> (Arc<acw_engine::engine::Engine>, String) {
    let dir = h.tmp.path().join(name);
    let api = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", api.local_addr().unwrap());
    let mut cfg = Config { data_dir: dir.join("data"), auth: "token".into(), public_url: base.clone(), gateway_url: base.clone(), ..Default::default() };
    cfg.forge.kind = "local".into();
    cfg.sandbox.provider = "local".into();
    cfg.sandbox.allow_unisolated = true;
    cfg.worker.agent = "scripted".into();
    cfg.worker.scripted_cmd = "sleep 60".into();
    cfg.standby.primary = h.base.clone();
    cfg.standby.token_env = token_env.into();
    let eng = build(cfg).unwrap();
    start(&eng);
    let app = acw_engine::http::app(eng.clone());
    tokio::spawn(async move { axum::serve(api, app).await.unwrap() });
    (eng, base)
}

async fn caught_up(h: &Harness, f: &acw_engine::engine::Engine) {
    for _ in 0..200 {
        let (a, b) = (h.eng.store.read(|v| v.last_seq()).unwrap(), f.store.read(|v| v.last_seq()).unwrap());
        if a == b && a > 0 {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("备机没有追上：{}", f.standby_status().unwrap());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_follower_keeps_up_takes_over_and_the_old_primary_stops() {
    std::env::set_var("ACW_T2_REPL", "repl-secret");
    let h = Harness::with("#!/bin/sh\nsleep 60\n", |c| c.standby.token_env = "ACW_T2_REPL".into()).await;
    let token = h.eng.issue_token("kai").unwrap();
    let id = h.say("yue", "给 hello 的 greet.sh 加一个参数").await.ticket.unwrap();
    let http = reqwest::Client::new();

    // the replication endpoints do not take member tokens, or no token
    assert_eq!(http.get(format!("{}/replica/events?after=0", h.base)).bearer_auth(&token).send().await.unwrap().status(), 403);
    assert_eq!(http.get(format!("{}/replica/secrets", h.base)).send().await.unwrap().status(), 403);

    let (f, fbase) = follower_of(&h, "f1", "ACW_T2_REPL").await;
    assert_eq!(f.role(), NodeRole::Follower);
    caught_up(&h, &f).await;
    assert_eq!(f.store.read(|v| v.ticket(&id)).unwrap().unwrap().title, h.ticket(&id).title);
    assert_eq!(f.store.read(|v| v.settings()).unwrap(), h.eng.settings().unwrap());
    // it keeps following
    h.eng.change_settings(&h.actor("kai"), &[("budget".to_string(), json!(99.0))].into_iter().collect(), "").unwrap();
    caught_up(&h, &f).await;
    assert_eq!(f.store.read(|v| v.settings()).unwrap().budget, 99.0);

    // read-only: the admin's token works for reading (secrets came along), commands are refused
    let me: Value = http.get(format!("{fbase}/api/me")).bearer_auth(&token).send().await.unwrap().json().await.unwrap();
    assert_eq!(me["id"], "kai");
    let refused = http.post(format!("{fbase}/api/router/messages")).bearer_auth(&token).json(&json!({ "text": "给 hello 加个功能" })).send().await.unwrap();
    assert_eq!(refused.status(), 503);
    assert!(refused.json::<Value>().await.unwrap()["error"].as_str().unwrap().contains("备机"));
    assert!(f.store.write(|tx| tx.emit("x", None, Event::Promoted { epoch: 9, by: "x".into() })).is_err(), "the store itself refuses too");
    let st: Value = http.get(format!("{fbase}/api/standby")).bearer_auth(&token).send().await.unwrap().json().await.unwrap();
    assert_eq!((st["role"].as_str(), st["behind"].as_i64(), st["epoch"].as_u64()), (Some("follower"), Some(0), Some(1)));

    // promote: only an admin, only a follower
    let yue = h.eng.issue_token("yue").unwrap();
    caught_up(&h, &f).await;
    tokio::time::sleep(Duration::from_millis(700)).await; // let the follower pull the new token
    assert_eq!(http.post(format!("{fbase}/api/standby/promote")).bearer_auth(&yue).send().await.unwrap().status(), 403);
    assert_eq!(http.post(format!("{}/api/standby/promote", h.base)).bearer_auth(&token).send().await.unwrap().status(), 409);
    let p: Value = http.post(format!("{fbase}/api/standby/promote")).bearer_auth(&token).send().await.unwrap().json().await.unwrap();
    assert_eq!((p["epoch"].as_u64(), p["old_primary_fenced"].as_bool(), p["caught_up"].as_bool()), (Some(2), Some(true), Some(true)), "{p}");
    assert_eq!((f.role(), f.epoch()), (NodeRole::Primary, 2));

    // the old primary no longer takes commands, over HTTP or inside
    assert_eq!(h.eng.role(), NodeRole::Fenced);
    let old = http.post(format!("{}/api/router/messages", h.base)).bearer_auth(&token).json(&json!({ "text": "给 hello 加个功能" })).send().await.unwrap();
    assert_eq!(old.status(), 503);
    assert!(h.eng.change_settings(&h.actor("kai"), &[("budget".to_string(), json!(50.0))].into_iter().collect(), "").is_err());
    // the new primary does, and carries on where the log was
    let said: Value = http.post(format!("{fbase}/api/router/messages")).bearer_auth(&token).json(&json!({ "text": "给 hello 的 greet.sh 再加一个参数" })).send().await.unwrap().json().await.unwrap();
    assert_eq!(said["ticket"], "T-2", "{said}");
    assert!(f.store.read(|v| v.events_of_kind("promoted", 1)).unwrap().len() == 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_node_with_its_own_history_is_not_a_follower_and_a_primary_fences_itself() {
    std::env::set_var("ACW_T3_REPL", "repl-secret");
    let a = Harness::with("#!/bin/sh\nsleep 60\n", |c| c.standby.token_env = "ACW_T3_REPL".into()).await;
    a.say("yue", "给 hello 的 greet.sh 加一个参数").await;

    // a node that already has a log of its own is restarted as a follower of `a`
    let dir = a.tmp.path().join("other");
    let mut cfg = Config { data_dir: dir.join("data"), auth: "token".into(), ..Default::default() };
    cfg.forge.kind = "local".into();
    cfg.sandbox.provider = "local".into();
    cfg.sandbox.allow_unisolated = true;
    cfg.standby.token_env = "ACW_T3_REPL".into();
    let first = build(cfg.clone()).unwrap();
    first.upsert_member(&acw_engine::engine::Actor::system("setup"), acw_engine::demo::member("zed", "Zed", Role::Admin, &[])).unwrap();
    first.store.set_meta("role", "follower").unwrap();
    drop(first);
    cfg.standby.primary = a.base.clone();
    let b = build(cfg).unwrap();
    assert_eq!(b.role(), NodeRole::Follower);
    let before = b.store.read(|v| v.last_seq()).unwrap();
    let e = b.follow_once().await.unwrap_err().to_string();
    assert!(e.contains("分叉"), "{e}");
    assert_eq!(b.store.read(|v| v.last_seq()).unwrap(), before, "nothing was mixed in");
    // rows that do not continue a log are refused by the store as well
    let rows = a.eng.store.raw_events(before + 3, 2).unwrap();
    assert!(!rows.is_empty() && b.store.replicate(&rows).is_err());

    // a primary that learns of a newer epoch stops on its own
    assert!(!a.eng.fence(1).unwrap(), "the same epoch does not fence");
    assert!(a.eng.fence(2).unwrap());
    assert_eq!(a.eng.role(), NodeRole::Fenced);
    assert!(a.eng.standby_status().unwrap()["problem"].as_str().unwrap().contains("取代"));
    assert!(a.eng.change_settings(&a.actor("kai"), &[("budget".to_string(), json!(50.0))].into_iter().collect(), "").is_err());
}
