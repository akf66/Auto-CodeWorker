//! Environment plans: versions, services with health checks, and what a Worker may change alone.
mod common;
use acw_core::*;
use common::*;
use serde_json::json;

const WORKER: &str = r##"#!/bin/sh
set -e
echo "read: 读需求单"
[ "$GREETING_LANG" = zh ] || { echo "GREETING_LANG 没有传进来"; exit 1; }
test -f ../io/prepared.txt
test -f ../io/stub.up
if grep -q "加服务" ../io/prompt.md; then
  cat > ../io/env.json <<'J'
{"why":"集成测试要连缓存","setup":["echo prepared > ../io/prepared.txt"],"services":[{"name":"stub","start":"touch ../io/stub.up; sleep 20","health":"test -f ../io/stub.up","wait_s":5},{"name":"cache","start":"sleep 20","health":"true"}],"env":{"GREETING_LANG":"zh"}}
J
else
  cat > ../io/env.json <<'J'
{"why":"测试要用到 jq","setup":["echo prepared > ../io/prepared.txt","echo jq-installed"],"services":[{"name":"stub","start":"touch ../io/stub.up; sleep 20","health":"test -f ../io/stub.up","wait_s":5}],"env":{"GREETING_LANG":"zh"}}
J
fi
echo "# touched" >> greet.sh
echo "say: 改完了。"
"##;

fn plan() -> EnvPlan {
    EnvPlan {
        setup: vec!["echo prepared > ../io/prepared.txt".into()],
        services: vec![Service { name: "stub".into(), start: "touch ../io/stub.up; sleep 20".into(), health: "test -f ../io/stub.up".into(), wait_s: 5 }],
        env: [("GREETING_LANG".to_owned(), "zh".to_owned())].into(),
        ..Default::default()
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_sandbox_is_prepared_by_the_plan_and_a_worker_can_only_add_plain_installs() {
    let h = Harness::new(WORKER).await;
    let (kai, lin, yue) = (h.actor("kai"), h.actor("lin"), h.actor("yue"));
    // who may change it, and what may be in it
    assert!(h.eng.set_env_plan(&yue, "hello", plan(), "").is_err(), "a requester cannot change the plan");
    let mut bad = plan();
    bad.env.insert("NPM_TOKEN".into(), "abc".into());
    assert!(h.eng.set_env_plan(&lin, "hello", bad, "").unwrap_err().to_string().contains("凭据"));
    assert_eq!(h.eng.set_env_plan(&lin, "hello", plan(), "第一版").unwrap().version, 1);
    h.eng.change_settings(&kai, &[("env_auto".to_string(), json!(["echo "]))].into_iter().collect(), "测试").unwrap();

    // the Worker script exits non-zero unless the setup ran, the service is up and the variable is set
    let id = h.say("yue", SHOUT).await.ticket.unwrap();
    h.until(&id, 30, "Worker 的环境提议被自动采纳", |_| h.eng.store.read(|v| v.env_plan("hello")).unwrap().is_some_and(|p| p.version == 2)).await;
    let now = h.eng.store.read(|v| v.env_plan("hello")).unwrap().unwrap();
    assert_eq!((now.by.as_str(), now.setup.len()), ("worker", 2), "a plain allow-listed install is applied without a person");
    assert!(now.note.contains(&id));
    let sandboxes = h.eng.store.read(|v| v.events_for(&id)).unwrap();
    assert!(sandboxes.iter().any(|e| matches!(&e.event, Event::SandboxEnv { version: 1, .. })), "the sandbox records the version that built it");

    // a new service is not the Worker's to decide
    let id2 = h.say("yue", "hello 的 greet.sh 加服务探活，验收：现有测试通过").await.ticket.unwrap();
    h.until(&id2, 30, "环境提议进了待处理", |_| !h.eng.store.read(|v| v.env_proposals()).unwrap().is_empty()).await;
    let pr = h.eng.store.read(|v| v.env_proposals()).unwrap().remove(0);
    assert_eq!((pr.from.as_str(), pr.need.as_str()), (id2.as_str(), "改了服务"));
    assert_eq!(h.eng.store.read(|v| v.env_plan("hello")).unwrap().unwrap().version, 2, "nothing changed yet");
    assert!(h.eng.store.read(|v| v.queue_item(&format!("{}:env", pr.id))).unwrap().is_some());
    assert!(h.eng.decide_env_change(&yue, &pr.id, true, "").is_err());
    h.eng.decide_env_change(&lin, &pr.id, false, "缓存用内存桩就够了").unwrap();
    assert!(h.eng.store.read(|v| v.env_proposals()).unwrap().is_empty());
    assert_eq!(h.eng.store.read(|v| v.env_plan("hello")).unwrap().unwrap().version, 2);

    // roll back: version 1's content comes back as version 3
    let back = h.eng.rollback_env_plan(&lin, "hello", 1).unwrap();
    assert_eq!((back.version, back.setup.len()), (3, 1));
    assert_eq!(h.eng.store.read(|v| v.env_history("hello")).unwrap().len(), 3);

    // the HTTP view shows the plan, its history and what a proposal would change
    let token = h.eng.issue_token("lin").unwrap();
    let v: serde_json::Value = reqwest::Client::new().get(format!("{}/api/projects/hello/env", h.base)).bearer_auth(&token).send().await.unwrap().json().await.unwrap();
    assert_eq!((v["plan"]["version"].as_u64(), v["history"].as_array().map(Vec::len)), (Some(3), Some(3)));
    let draft: serde_json::Value = reqwest::Client::new().post(format!("{}/api/projects/hello/env/detect", h.base)).bearer_auth(&token).send().await.unwrap().json().await.unwrap();
    assert!(draft["note"].as_str().unwrap().contains("没有认出依赖清单"), "{draft}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_service_that_never_gets_healthy_fails_the_task_with_its_output() {
    let h = Harness::new(WORKER).await;
    let mut p = plan();
    p.services[0] = Service { name: "db".into(), start: "echo 'port 5432 already in use'; sleep 20".into(), health: "false".into(), wait_s: 1 };
    h.eng.set_env_plan(&h.actor("lin"), "hello", p, "").unwrap();
    let id = h.say("yue", SHOUT).await.ticket.unwrap();
    let t = h.until(&id, 60, "任务失败", |t| t.stage == Stage::Failed).await;
    assert!(t.why.contains("服务 db 在 1 秒内没有通过健康检查") && t.why.contains("port 5432 already in use"), "{}", t.why);
}
