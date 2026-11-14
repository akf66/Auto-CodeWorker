//! Engine behaviour around the pipeline: admission, settings, recovery, the HTTP surface,
//! time limits, and a person taking a branch over.

mod common;
use acw_core::*;
use acw_engine::demo::WORKER;
use common::*;
use serde_json::{json, Value};

const SLOW: &str = "#!/bin/sh\necho 'cmd: sleep'\nsleep 120\n";

fn patch(pairs: &[(&str, Value)]) -> serde_json::Map<String, Value> {
    pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
}

fn mandate(goal: &str) -> Mandate {
    Mandate { goal: goal.into(), accept: vec!["现有测试通过".into()], ..Default::default() }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn slots_go_by_priority_and_full_queues_hold_new_work() {
    let h = Harness::new(SLOW).await;
    let kai = h.actor("kai");
    h.eng.change_settings(&kai, &patch(&[("workers", json!(1))]), "一次只跑一个").unwrap();
    let a = h.eng.create_ticket(&kai, "hello", mandate("问候语改成中文"), "测试", "a").unwrap().id;
    h.until(&a, 30, "第一个任务开工", |t| t.stage.is_active()).await;
    let b = h.eng.create_ticket(&kai, "hello", mandate("加一个 --help"), "测试", "b").unwrap().id;
    let c = h.eng.create_ticket(&kai, "hello", mandate("修一个线上问题"), "测试", "c").unwrap().id;
    h.eng.set_priority(&kai, &c, Priority::High).unwrap();
    let tb = h.until(&b, 20, "第二个任务排队并写明原因", |t| t.stage == Stage::Queued && t.why.contains("槽位满了")).await;
    assert_eq!(tb.state, "排队中");

    // the slot frees: the high-priority task takes it although it was created later
    h.eng.stop(&kai, &a, "让路").unwrap();
    h.until(&c, 30, "高优先级的先开工", |t| t.stage.is_active()).await;
    assert_eq!(h.ticket(&b).stage, Stage::Queued);

    // back-pressure: every approver of the project already has a full queue
    h.eng.stop(&kai, &c, "让路").unwrap();
    h.eng.stop(&kai, &b, "让路").unwrap();
    h.eng.change_settings(&kai, &patch(&[("queue_limit", json!(1))]), "每人一件").unwrap();
    let guarded = h.say("yue", "hello 的计费模块加一个导出").await.ticket.unwrap();
    assert_eq!(h.ticket(&guarded).stage, Stage::MandatePending);
    let d = h.eng.create_ticket(&kai, "hello", mandate("改 README"), "测试", "d").unwrap().id;
    let td = h.until(&d, 20, "审批人满了，新任务不开工", |t| t.stage == Stage::Queued && t.why.contains("审批人待处理都到了上限")).await;
    assert!(td.sandbox.is_none());
    // one approver clears an item: there is room again, and the held task starts by itself
    h.eng.stop(&kai, &guarded, "不做了").unwrap();
    h.until(&d, 30, "有空位后自动开工", |t| t.stage.is_active()).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn settings_are_versioned_validated_and_can_be_rolled_back() {
    let h = Harness::new(WORKER).await;
    let kai = h.actor("kai");
    let v0 = h.eng.settings().unwrap();
    let v1 = h.eng.change_settings(&kai, &patch(&[("workers", json!(4)), ("budget", json!(120.0))]), "收紧").unwrap();
    assert_eq!((v1.version, v1.workers, v1.budget), (v0.version + 1, 4, 120.0));
    assert_eq!(h.eng.change_settings(&kai, &patch(&[("workers", json!(4))]), "没变").unwrap().version, v1.version, "no change, no new version");

    assert!(h.eng.change_settings(&kai, &patch(&[("workers", json!(0))]), "").is_err());
    assert!(h.eng.change_settings(&kai, &patch(&[("stages.reviewer.model", json!("not-in-the-list"))]), "").is_err(), "a model must come from the connection's pulled list");
    assert!(h.eng.change_settings(&h.actor("lin"), &patch(&[("workers", json!(9))]), "").is_err(), "settings need an admin");
    assert_eq!(h.eng.settings().unwrap(), v1, "refused changes leave nothing behind");

    let v2 = h.eng.rollback_settings(&kai, v0.version).unwrap();
    assert_eq!((v2.version, v2.workers, v2.budget), (v1.version + 1, v0.workers, v0.budget), "a rollback is a new version with the old values");
    let view = h.eng.view_settings().unwrap();
    let hist = view["history"].as_array().unwrap();
    assert_eq!(hist[0]["note"], format!("回滚到第 {} 版", v0.version));
    assert!(hist[1]["changes"].as_array().unwrap().iter().any(|c| c["key"] == "workers" && c["to"] == 4));

    // pulling again keeps the list current; a connection in use cannot be removed
    let ep = view["endpoints"][0]["id"].as_str().unwrap().to_owned();
    let (pulled, fresh) = h.eng.pull_endpoint(&kai, &ep).await.unwrap();
    assert_eq!((pulled.models, fresh.len()), (vec!["dev-large".to_owned(), "dev-small".to_owned(), "dev-tiny".to_owned()], 0));
    assert!(h.eng.remove_endpoint(&kai, &ep).is_err());
    assert!(h.eng.add_endpoint(&kai, "坏的", "https://127.0.0.1:1/v1", "k", "chat").await.is_err(), "a connection whose models cannot be pulled is not saved");
    assert!(h.eng.add_endpoint(&kai, "内网", "http://10.0.3.12:8000/v1", "k", "chat").await.is_err(), "only https endpoints");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_task_survives_losing_its_run_and_its_sandbox() {
    let h = Harness::new(SLOW).await;
    let id = h.say("kai", SHOUT).await.ticket.unwrap();
    h.until(&id, 30, "Worker 在跑", |t| t.stage == Stage::Working && t.sandbox.is_some()).await;

    // what an Engine crash plus a dead host leaves behind: the stage says Working, nothing is running, the sandbox is gone.
    // Draining keeps the scheduler from picking the task up again while we break things.
    let kai = h.actor("kai");
    h.eng.set_drain(&kai, true).unwrap();
    h.eng.cancel_run(&id);
    for _ in 0..100 {
        if !h.eng.is_running(&id) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    assert!(!h.eng.is_running(&id));
    h.eng.sandbox.destroy(&format!("sb-{id}")).await.unwrap();
    std::fs::write(h.tmp.path().join("worker.sh"), WORKER).unwrap();
    assert_eq!(h.ticket(&id).stage, Stage::Working, "draining stops work without changing what the task is doing");

    h.eng.set_drain(&kai, false).unwrap();
    let t = h.until(&id, 90, "重建沙箱后走完", |t| t.stage == Stage::PrOpen).await;
    assert!(t.contract_ok());
    let rebuilt = h.eng.store.read(|v| v.events_for(&id)).unwrap().iter().filter(|e| matches!(e.event, Event::SandboxCreated { .. })).count();
    assert_eq!(rebuilt, 2, "the sandbox was built a second time from the template and the branch");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_http_api_checks_who_is_calling() {
    let h = Harness::new(SLOW).await;
    let http = reqwest::Client::new();
    let url = |p: &str| format!("{}{p}", h.base);
    assert_eq!(http.get(url("/api/overview")).send().await.unwrap().status(), 403, "no token, no data");
    let kai = h.eng.issue_token("kai").unwrap();
    let yue = h.eng.issue_token("yue").unwrap();

    let r = http.post(url("/api/router/messages")).bearer_auth(&yue).json(&json!({ "text": SHOUT })).send().await.unwrap();
    assert_eq!(r.status(), 200);
    let id = r.json::<Value>().await.unwrap()["ticket"].as_str().unwrap().to_owned();
    h.until(&id, 30, "Worker 在跑", |t| t.stage == Stage::Working && t.sandbox.is_some()).await;

    let r = http.patch(url("/api/settings")).bearer_auth(&yue).json(&json!({ "changes": { "workers": 50 } })).send().await.unwrap();
    assert_eq!(r.status(), 403, "a requester cannot change settings");
    let r = http.post(url(&format!("/api/tickets/{id}/priority"))).bearer_auth(&yue).json(&json!({ "priority": "high" })).send().await.unwrap();
    assert_eq!(r.status(), 403);
    let r = http.post(url("/api/model-endpoints")).bearer_auth(&kai).json(&json!({ "name": "x", "base": "ftp://nope", "key": "k" })).send().await.unwrap();
    assert_eq!(r.status(), 400);

    let v: Value = http.get(url(&format!("/api/tickets/{id}"))).bearer_auth(&yue).send().await.unwrap().json().await.unwrap();
    assert_eq!(v["ticket"]["by"], "yue");
    assert!(v["timeline"].as_array().unwrap().len() >= 4);
    assert_eq!((v["can"]["approve"].as_bool(), v["can"]["request"].as_bool()), (Some(false), Some(true)));
    let ov: Value = http.get(url("/api/overview")).bearer_auth(&kai).send().await.unwrap().json().await.unwrap();
    assert_eq!(ov["stats"]["workers_used"], 1);

    // the model gateway: the task's token works while it runs, is priced, and is useless otherwise
    let token = h.eng.gateway_token(&id).unwrap();
    let r = http.post(url("/llm/not-a-token/v1/chat/completions")).json(&json!({})).send().await.unwrap();
    assert_eq!(r.status(), 401);
    let before = h.ticket(&id).cost;
    let r = http.post(url(&format!("/llm/{token}/v1/chat/completions"))).json(&json!({ "model": "anything", "messages": [{ "role": "user", "content": "hi" }] })).send().await.unwrap();
    assert_eq!(r.status(), 200);
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["model"], "dev-large", "the gateway runs the configured model, whatever the agent asked for");
    let t = h.until(&id, 10, "网关记下了成本", |t| t.cost > before).await;
    assert!(t.cost > before);
    let r = http.post(url(&format!("/llm/{token}/v1/embeddings"))).json(&json!({})).send().await.unwrap();
    assert_eq!(r.status(), 404);
    h.eng.stop(&h.actor("yue"), &id, "够了").unwrap();
    let r = http.post(url(&format!("/llm/{token}/v1/chat/completions"))).json(&json!({ "messages": [] })).send().await.unwrap();
    assert_eq!(r.status(), 403, "a stopped task's token no longer reaches a model");

    // a forged webhook is refused and recorded
    let r = http.post(url("/webhooks/github")).header("x-github-event", "pull_request").header("x-hub-signature-256", "sha256=00").body("{}").send().await.unwrap();
    assert_eq!(r.status(), 401);
    assert!(h.security().iter().any(|(k, _)| k == "webhook 验签失败"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn items_past_their_time_limit_are_escalated_once() {
    let h = Harness::new(WORKER).await;
    let kai = h.actor("kai");
    h.eng.change_settings(&kai, &patch(&[("sla.mandate", json!(0))]), "马上超时").unwrap();
    let id = h.say("yue", "hello 的计费模块加一个导出").await.ticket.unwrap();
    h.eng.chase().unwrap();
    h.eng.chase().unwrap();
    let q = h.eng.store.read(|v| v.queue_item(&format!("{id}:mandate"))).unwrap().unwrap();
    assert!(q.escalated);
    assert_eq!(h.kinds(&id).iter().filter(|k| *k == "queue_escalated").count(), 1, "escalating twice would be noise");
    // the notifications were written with the events and delivered afterwards (no webhook configured: recorded as not sent)
    tokio::time::sleep(std::time::Duration::from_millis(1800)).await;
    let sent = h.eng.view_log("notified").unwrap();
    let texts: Vec<&str> = sent.as_array().unwrap().iter().filter_map(|e| e["text"].as_str()).collect();
    assert!(texts.iter().any(|t| t.starts_with("超时未处理")) && texts.iter().any(|t| t.contains("需求单") || t.contains("计费")), "{texts:?}");
    assert!(sent.as_array().unwrap().iter().all(|e| e["sent"] == false));

    // handing the item to one person restarts its clock and hides it from the others
    h.eng.hand_queue_item(&kai, &q.id, "lin").unwrap();
    let ov_kai = h.eng.view_overview(&h.actor("lin")).unwrap();
    assert_eq!(ov_kai["queue"].as_array().unwrap().len(), 1);
    assert!(h.eng.hand_queue_item(&kai, &q.id, "yue").is_err(), "the receiver must be able to act on it");
}

/// Round one leaves the marked bug; when the findings come back, this Worker hangs.
const HANGS_ON_FIX: &str = "#!/bin/sh\nset -e\nif grep -q '任务分支上提交了改动' ../io/prompt.md; then echo 'read: 读别人的提交，没有要补的'; exit 0; fi\nif grep -q '审查发现' ../io/prompt.md; then echo 'cmd: 卡住'; sleep 120; fi\nprintf '#!/bin/sh\\nname=\"$1\"\\n# BUG: 没有名字时输出了空的问候\\necho \"Hello, $name\"\\n' > greet.sh\necho 'edit: 改 greet.sh'\n";

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_person_can_take_the_branch_over_and_their_commits_win() {
    let h = Harness::new(HANGS_ON_FIX).await;
    let id = h.say("kai", "hello 的 greet.sh 整理一下变量").await.ticket.unwrap();
    let t = h.until(&id, 60, "Worker 在修审查发现的问题", |t| t.stage == Stage::Working && t.review.round == 1 && t.head_sha.is_some()).await;
    let branch = t.branch.clone().unwrap();

    h.eng.handover(&h.actor("lin"), &id).unwrap();
    let t = h.until(&id, 20, "Worker 停下", |t| t.handed && t.stage == Stage::Blocked).await;
    assert!(!h.eng.is_running(&id) && t.state.contains("接手中"));

    // the person fixes it by hand and pushes to the task branch
    let work = h.tmp.path().join("human");
    let run = |cmd: String| {
        let out = std::process::Command::new("sh").arg("-c").arg(&cmd).output().unwrap();
        assert!(out.status.success(), "{cmd}: {}", String::from_utf8_lossy(&out.stderr));
    };
    run(format!("git clone -q -b {branch} {} {}", h.repo.display(), work.display()));
    run(format!("cd {} && git config user.email lin@x && git config user.name lin && printf '#!/bin/sh\\nname=\"${{1:-there}}\"\\necho \"Hello, $name\"\\n' > greet.sh && git commit -qam 'handle missing name' && git push -q origin {branch}", work.display()));

    h.eng.handback(&h.actor("lin"), &id).unwrap();
    let t = h.until(&id, 90, "交还后走完", |t| t.stage == Stage::PrOpen).await;
    assert!(!t.handed && t.contract_ok());
    let out = std::process::Command::new("git").arg("-C").arg(&h.repo).args(["show", &format!("{branch}:greet.sh")]).output().unwrap();
    let greet = String::from_utf8_lossy(&out.stdout);
    assert!(greet.contains("${1:-there}") && !greet.contains("BUG:"), "the person's commit is what the pull request carries:\n{greet}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_agent_session_outlives_its_sandbox() {
    use acw_sandbox::{CancellationToken, ExecSpec, SandboxSpec};
    let h = Harness::new(WORKER).await;
    let sb = &h.eng.sandbox;
    sb.create(&SandboxSpec { id: "sb-T-9".into(), ..Default::default() }).await.unwrap();
    sb.put_file("sb-T-9", "home/.codex/sessions/2026/rollout-1.jsonl", b"{\"type\":\"session_meta\"}\n").await.unwrap();
    h.eng.export_session("T-9", "sb-T-9", CancellationToken::new()).await;
    sb.destroy("sb-T-9").await.unwrap();

    sb.create(&SandboxSpec { id: "sb-T-9".into(), ..Default::default() }).await.unwrap();
    assert!(h.eng.restore_session("T-9", "sb-T-9", CancellationToken::new()).await);
    assert_eq!(sb.get_file("sb-T-9", "home/.codex/sessions/2026/rollout-1.jsonl").await.unwrap(), b"{\"type\":\"session_meta\"}\n");
    let seen = sb.exec("sb-T-9", ExecSpec::new("test -d ../home/.codex/sessions"), None, CancellationToken::new()).await.unwrap();
    assert!(seen.ok(), "the pipeline resumes the conversation when it finds the session");
    assert!(!h.eng.restore_session("T-404", "sb-T-9", CancellationToken::new()).await, "nothing saved, nothing restored");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_delegate_sees_and_can_act_on_the_absent_members_items() {
    let h = Harness::new(WORKER).await;
    let id = h.say("yue", "hello 的计费模块加一个导出").await.ticket.unwrap();
    // yue is a requester: the mandate is not hers to confirm, and not in her queue
    assert!(h.eng.view_overview(&h.actor("yue")).unwrap()["queue"].as_array().unwrap().is_empty());
    assert!(h.eng.set_delegate(&h.actor("lin"), Some("lin"), 3).is_err());
    h.eng.set_delegate(&h.actor("lin"), Some("yue"), 3).unwrap();
    let q = h.eng.view_overview(&h.actor("yue")).unwrap();
    assert_eq!(q["queue"].as_array().unwrap().len(), 1, "the delegate sees what lin would see");
    assert!(h.security().iter().any(|(k, _)| k == "代理"));
    h.eng.set_delegate(&h.actor("lin"), None, 0).unwrap();
    assert!(h.eng.view_overview(&h.actor("yue")).unwrap()["queue"].as_array().unwrap().is_empty());
    let _ = id;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn operators_get_metrics_alerts_and_old_artifacts_are_swept() {
    let h = Harness::new(WORKER).await;
    let kai = h.actor("kai");
    let id = h.say("kai", SHOUT).await.ticket.unwrap();
    h.until(&id, 60, "PR 开出来", |t| t.stage == Stage::PrOpen).await;
    let m = h.eng.metrics().unwrap();
    assert!(m.contains("acw_tickets{stage=\"pr_open\"} 1") && m.contains("acw_queue_items{kind=\"pr\"} 1") && m.contains("acw_workers_total 6"), "{m}");

    // a project at 80% of its daily allowance raises one alert, and clears when the allowance is raised
    h.eng.change_settings(&kai, &patch(&[("project_day", json!(0.001))]), "很小的额度").unwrap();
    h.eng.watch().unwrap();
    h.eng.watch().unwrap();
    let ops = h.eng.view_ops().unwrap();
    assert_eq!(ops["alerts"].as_array().unwrap().len(), 1, "{ops}");
    assert_eq!(ops["alerts"][0]["key"], "quota:hello");
    h.eng.change_settings(&kai, &patch(&[("project_day", json!(600.0))]), "恢复").unwrap();
    h.eng.watch().unwrap();
    assert!(h.eng.view_ops().unwrap()["alerts"].as_array().unwrap().is_empty());

    // generated tests are kept outside the log; they go once the finished task is past retention
    let dir = h.eng.artifacts(&id);
    assert!(dir.exists());
    h.eng.stop(&kai, &id, "结束").unwrap();
    assert_eq!(h.eng.sweep_artifacts().await.unwrap(), 0, "inside the retention period");
    h.eng.change_settings(&kai, &patch(&[("fail_keep_days", json!(0))]), "马上过期").unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    assert_eq!(h.eng.sweep_artifacts().await.unwrap(), 1);
    assert!(!dir.exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_late_pipeline_write_cannot_undo_a_persons_command() {
    let h = Harness::new(SLOW).await;
    let id = h.say("kai", SHOUT).await.ticket.unwrap();
    h.until(&id, 30, "任务开工", |t| t.stage.is_active()).await;
    h.eng.stop(&h.actor("kai"), &id, "不做了").unwrap();
    // what a pipeline that was already past its checks would do next
    assert!(h.eng.stage(&id, Stage::Provisioning, "准备沙箱", "").is_err());
    assert_eq!(h.ticket(&id).stage, Stage::Dropped, "the stop stands");
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    assert!(!h.eng.is_running(&id), "and nothing brings the task back");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_code_index_ties_a_symbol_to_its_module_and_its_rules() {
    let h = Harness::new(SLOW).await;
    // the repository gains a billing module and a web module
    let work = h.tmp.path().join("seed2");
    let cmd = format!("git clone -q {} {w} && cd {w} && git config user.email a@b && git config user.name a && mkdir -p billing web && printf 'package billing\\n\\nfunc DeductBalance(uid string, n int64) error {{\\n\\t_, err := db.Exec(\"UPDATE wallets SET balance = balance - ? WHERE uid = ?\", n, uid)\\n\\treturn err\\n}}\\n' > billing/wallet.go && printf \"app.get('/api/wallet', showWallet)\\nfunction showWallet(req, res) {{}}\\n\" > web/server.js && git add -A && git commit -qm modules && git push -q origin main", h.repo.display(), w = work.display());
    let out = std::process::Command::new("sh").arg("-c").arg(&cmd).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));

    assert!(h.eng.hint_modules("hello", "DeductBalance 偶尔失败").is_empty(), "no index yet");
    let info = h.eng.build_index("hello").await.unwrap();
    assert!(info.symbols >= 2 && info.access >= 2, "{info:?}");
    let idx = h.eng.load_index("hello").unwrap();
    assert!(idx.symbols["billing/wallet.go"].contains(&"DeductBalance".to_owned()));
    assert!(idx.access.iter().any(|a| a.kind == "table" && a.name == "wallets" && a.file == "billing/wallet.go"));
    assert!(idx.access.iter().any(|a| a.kind == "route" && a.name == "/api/wallet"));
    assert_eq!(h.eng.index_behind("hello").await.unwrap(), Some(0));

    // the message never says "计费", but it names a function that lives there: the guarded-module rule applies
    let id = h.say("yue", "hello 里 DeductBalance 偶尔返回错误，查一下").await.ticket.unwrap();
    let t = h.ticket(&id);
    assert_eq!(t.modules, ["计费"]);
    assert_eq!((t.stage, t.mandate.need_confirm.as_deref()), (Stage::MandatePending, Some("计费与金额")));
    let map = idx.repo_map(&acw_engine::demo::sample_project(&h.repo), 20);
    assert!(map.contains("模块“计费”（改动要确认：计费与金额）") && map.contains("billing/wallet.go：DeductBalance；访问 table wallets"), "{map}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_router_model_changes_only_after_the_eval_set_agrees() {
    let h = Harness::new(SLOW).await;
    let (kai, lin, yue) = (h.actor("kai"), h.actor("lin"), h.actor("yue"));
    let ep = h.eng.store.read(|v| v.endpoints()).unwrap().remove(0).id;
    let to = |model: &str| patch(&[("stages.router", json!({ "endpoint": ep, "model": model, "fallback": null }))]);
    // no cases yet: the model can be changed freely
    h.eng.change_settings(&kai, &to("dev-large"), "").unwrap();
    h.eng.change_settings(&kai, &to("dev-small"), "").unwrap();

    let r1 = h.say("yue", "给 hello 的 greet.sh 加一个参数").await;
    let r2 = h.say("yue", "现在进度怎么样？").await;
    let r3 = h.say("yue", "把登录页的按钮改成蓝色").await;
    assert_eq!((r1.output.decision.as_str(), r2.output.decision.as_str(), r3.output.decision.as_str()), ("new_ticket", "answer", "ask"));
    assert!(h.eng.save_eval_case(&yue, &r1.id, None, None, "").is_err(), "the eval set is the approvers'");
    h.eng.save_eval_case(&kai, &r1.id, None, None, "写了项目名").unwrap();
    h.eng.save_eval_case(&kai, &r2.id, None, None, "").unwrap();
    // r3 was judged wrong by a person: it should have opened a task in hello
    h.eng.save_eval_case(&kai, &r3.id, Some("new_ticket"), Some("hello"), "登录页在 hello 里").unwrap();
    assert!(h.eng.save_eval_case(&kai, &r3.id, Some("guess"), None, "").is_err());
    let before = h.eng.store.read(|v| Ok(v.tickets()?.len())).unwrap();

    // without a run of the new model on this set, the change is refused
    let e = h.eng.change_settings(&kai, &to("dev-tiny"), "").unwrap_err().to_string();
    assert!(e.contains("还没有在现在这套用例上跑过"), "{e}");
    let cmp = h.eng.compare_eval(&kai, (ep.clone(), "dev-small".into()), (ep.clone(), "dev-tiny".into())).await.unwrap();
    assert_eq!((cmp["a"]["passed"].as_u64(), cmp["b"]["passed"].as_u64()), (Some(2), Some(0)), "{cmp}");
    assert_eq!((cmp["only_a"].as_u64(), cmp["only_b"].as_u64()), (Some(2), Some(0)));
    assert_eq!(cmp["a"]["misses"][0]["want"], "new_ticket → hello");
    assert_eq!(h.eng.store.read(|v| Ok(v.tickets()?.len())).unwrap(), before, "a run decides, it does not open tasks");
    // the worse model is refused; an admin can still insist, with a reason, and that is logged
    let e = h.eng.change_settings(&kai, &to("dev-tiny"), "").unwrap_err().to_string();
    assert!(e.contains("新模型更差"), "{e}");
    let mut forced = to("dev-tiny");
    forced.insert("_eval_override".into(), json!("供应商下线了 dev-small"));
    assert_eq!(h.eng.change_settings(&kai, &forced, "").unwrap().stages["router"].model, "dev-tiny");
    assert!(h.security().iter().any(|(k, _)| k == "越过评测"));
    // going back to the better model passes the gate on its own run
    h.eng.change_settings(&kai, &to("dev-small"), "").unwrap();
    // a changed set makes old runs stale
    h.eng.remove_eval_case(&kai, &format!("C-{}", r2.id)).unwrap();
    assert!(h.eng.change_settings(&kai, &to("dev-large"), "").is_err());
    assert!(h.eng.run_eval(&lin, None).await.is_err(), "lin approves for one project; the eval set is global");
    assert_eq!(h.eng.run_eval(&kai, Some((ep.clone(), "dev-large".into()))).await.unwrap().cases, 2);
    h.eng.change_settings(&kai, &to("dev-large"), "").unwrap();
}
