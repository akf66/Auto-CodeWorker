//! Plans: one confirmation, tasks started by dependency, stacked pull requests, plan changes.

mod common;
use acw_core::*;
use common::*;

/// Each task adds one file named after itself; T-1's Worker also proposes a change to the plan.
const ADDS_A_FILE: &str = r#"#!/bin/sh
set -e
echo "edit: 加 feature-$ACW_TICKET.txt"
echo "$ACW_TICKET" > "feature-$ACW_TICKET.txt"
if [ "$ACW_TICKET" = "T-1" ] && [ -n "$REPLAN" ]; then
  cat > ../io/replan.json <<'JSON'
{"why": "少了一个更新文档的任务", "tasks": [
  {"title": "接口", "deps": [], "covers": [1], "est": 10},
  {"title": "页面", "deps": [1], "covers": [2], "stacked": true, "est": 10},
  {"title": "文档", "deps": [], "covers": [2], "est": 5}]}
JSON
fi
"#;

fn task(title: &str, deps: &[usize], covers: &[u32], stacked: bool) -> PlanTask {
    PlanTask { title: title.into(), deps: deps.to_vec(), covers: covers.to_vec(), stacked, est: 10.0, ..Default::default() }
}

async fn merge(h: &Harness, id: &str) {
    let t = h.ticket(id);
    h.eng.local_forge.as_ref().unwrap().merge(&h.repo.to_string_lossy(), "demo/hello", t.pr.unwrap().number).await.unwrap();
    h.eng.poll_prs().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_plan_is_confirmed_once_and_its_tasks_start_by_dependency() {
    let h = Harness::new(ADDS_A_FILE).await;
    let accept = vec!["接口返回按月汇总".to_owned(), "页面能看到汇总".to_owned(), "旧接口保持不变".to_owned()];
    let tasks = vec![task("接口", &[], &[1], false), task("页面", &[1], &[2], true), task("清理", &[1, 2], &[3], false)];

    let err = h.eng.create_plan(&h.actor("yue"), "hello", "按月汇总", accept.clone(), tasks[..2].to_vec()).unwrap_err();
    assert!(err.to_string().contains("验收标准 3 没有任务覆盖"), "{err}");
    let plan = h.eng.create_plan(&h.actor("yue"), "hello", "按月汇总", accept, tasks).unwrap();
    assert!(h.eng.store.read(|v| v.tickets()).unwrap().is_empty(), "nothing starts before an approver confirms");
    assert!(h.eng.confirm_plan(&h.actor("yue"), &plan.id).is_err());
    let started = h.eng.confirm_plan(&h.actor("lin"), &plan.id).unwrap();
    assert_eq!(started, ["T-1"], "only the task without dependencies starts");

    // the stacked task starts when its dependency has an open pull request, on top of that branch
    let t1 = h.until("T-1", 60, "任务 1 开出 PR", |t| t.stage == Stage::PrOpen).await;
    let t2 = h.until("T-2", 60, "叠放的任务 2 开出 PR", |t| t.stage == Stage::PrOpen).await;
    assert_eq!(t2.stack_on.as_deref(), Some("T-1"));
    assert_eq!(t2.base_sha, t1.head_sha, "it was built on the first task's commit");
    let lf = h.eng.local_forge.clone().unwrap();
    assert_eq!(lf.base_of("demo/hello", t2.pr.as_ref().unwrap().number).await, t1.branch, "its pull request targets the first task's branch");
    assert_eq!(h.eng.store.read(|v| v.plan(&plan.id)).unwrap().unwrap().tasks[2].ticket, None, "the third task waits for both to merge");

    // the first merges: the stacked task moves onto main by itself and retargets its pull request
    merge(&h, "T-1").await;
    h.eng.poll_prs().await.unwrap();
    let t2 = h.until("T-2", 90, "任务 2 改到 main 上", |t| t.stage == Stage::PrOpen && t.base_sha != t1.head_sha).await;
    assert_eq!(lf.base_of("demo/hello", t2.pr.as_ref().unwrap().number).await.as_deref(), Some("main"));
    assert!(t2.contract_ok());

    merge(&h, "T-2").await;
    let t3 = h.until("T-3", 60, "任务 3 在前两个合并后开工并开出 PR", |t| t.stage == Stage::PrOpen).await;
    assert_eq!((t3.plan.as_deref(), t3.plan_task), (Some(plan.id.as_str()), 2));
    assert_eq!(t3.mandate.accept, ["旧接口保持不变"], "a task is accountable for the criteria it covers");
    merge(&h, "T-3").await;
    assert_eq!(h.eng.store.read(|v| v.plan(&plan.id)).unwrap().unwrap().status, "done");
    let out = std::process::Command::new("git").arg("-C").arg(&h.repo).args(["ls-tree", "--name-only", "main"]).output().unwrap();
    let files = String::from_utf8_lossy(&out.stdout);
    assert!(["feature-T-1.txt", "feature-T-2.txt", "feature-T-3.txt"].iter().all(|f| files.contains(f)), "{files}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_worker_can_propose_a_plan_change_but_not_make_it() {
    std::env::set_var("REPLAN", "1");
    let h = Harness::with(ADDS_A_FILE, |cfg| cfg.worker.scripted_cmd = format!("REPLAN=1 {}", cfg.worker.scripted_cmd)).await;
    let plan = h.eng.create_plan(&h.actor("kai"), "hello", "按月汇总", vec!["接口返回按月汇总".into(), "页面能看到汇总".into()], vec![task("接口", &[], &[1], false), task("页面", &[1], &[2], true)]).unwrap();
    h.eng.confirm_plan(&h.actor("lin"), &plan.id).unwrap();
    h.until("T-1", 60, "任务 1 开出 PR", |t| t.stage == Stage::PrOpen).await;

    let p = h.eng.store.read(|v| v.plan(&plan.id)).unwrap().unwrap();
    let change = p.change.clone().expect("the Worker's proposal is recorded");
    assert_eq!((p.version, p.tasks.len(), change.tasks.len()), (1, 2, 3), "proposing changes nothing");
    assert_eq!(change.tasks[0].ticket.as_deref(), Some("T-1"), "tasks that already started keep their ticket");
    assert!(h.eng.store.read(|v| v.queue()).unwrap().iter().any(|q| q.id == format!("{}:plan", plan.id)));
    assert!(h.eng.decide_plan_change(&h.actor("yue"), &plan.id, true, "").is_err());

    let started = h.eng.decide_plan_change(&h.actor("lin"), &plan.id, true, "").unwrap();
    let p = h.eng.store.read(|v| v.plan(&plan.id)).unwrap().unwrap();
    assert_eq!((p.version, p.tasks.len(), p.change.is_none()), (2, 3, true));
    assert!(started.iter().any(|id| h.ticket(id).title == "文档"), "the new task without dependencies starts at once: {started:?}");
}

/// The task in `lib` adds a marker file; the task in `hello` only passes when it can see that
/// marker in the sibling checkout, and records which version of it it saw.
const CROSS_REPO: &str = r##"#!/bin/sh
set -e
if grep -q "同组的其它仓库" ../io/prompt.md; then
  echo "read: 看 ../deps/lib 里的导出"
  test -f ../deps/lib/export.txt
  echo "uses $(tail -n 1 ../deps/lib/export.txt)" > uses.txt
else
  echo "edit: lib 加导出"
  n=$(cat export.txt 2>/dev/null | wc -l)
  echo "export v$((n + 1))" >> export.txt
fi
"##;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_plan_over_two_repositories_makes_a_pull_request_group() {
    let h = Harness::new(CROSS_REPO).await;
    let (kai, lin, yue) = (h.actor("kai"), h.actor("lin"), h.actor("yue"));
    // a second repository and project
    let lib_repo = h.repo.parent().unwrap().join("lib.git");
    let out = std::process::Command::new("cp").arg("-r").arg(&h.repo).arg(&lib_repo).output().unwrap();
    assert!(out.status.success());
    let mut lib = acw_engine::demo::sample_project(&lib_repo);
    lib.id = "lib".into();
    lib.name = "lib".into();
    lib.aliases = vec![];
    lib.channels = vec![];
    lib.slug = "demo/lib".into();
    h.eng.upsert_project(&kai, lib).unwrap();

    let accept = vec!["库导出新接口".to_owned(), "hello 用上新接口".to_owned()];
    let mut t1 = task("库里加导出", &[], &[1], false);
    t1.project = Some("lib".into());
    let t2 = task("hello 用新导出", &[1], &[2], true);
    let mut ghost = t1.clone();
    ghost.project = Some("nope".into());
    assert!(h.eng.create_plan(&yue, "hello", "跨仓库", accept.clone(), vec![ghost, t2.clone()]).is_err(), "an unknown project is refused");
    let plan = h.eng.create_plan(&yue, "hello", "跨仓库", accept, vec![t1, t2]).unwrap();
    // lin approves for hello only: a plan that also touches lib is not hers alone to confirm
    let e = h.eng.confirm_plan(&lin, &plan.id).unwrap_err().to_string();
    assert!(e.contains("涉及项目 lib"), "{e}");
    assert_eq!(h.eng.confirm_plan(&kai, &plan.id).unwrap(), ["T-1"]);

    let a = h.until("T-1", 60, "lib 的任务开出 PR", |t| t.stage == Stage::PrOpen).await;
    assert_eq!(a.project, "lib");
    // the dependent task starts once the first has an open pull request, in its own repository,
    // with the first one's branch checked out beside it
    let b = h.until("T-2", 60, "hello 的任务开出 PR", |t| t.stage == Stage::PrOpen).await;
    assert_eq!((b.project.as_str(), b.stack_on.as_deref(), b.siblings.as_slice()), ("hello", None, &["T-1".to_owned()][..]));
    assert_eq!(b.siblings_sha.get("T-1"), a.head_sha.as_ref(), "it saw the first task's commit");
    assert!(b.files.contains(&"uses.txt".to_owned()) && !b.files.iter().any(|f| f.starts_with("deps/")), "{:?}", b.files);
    let lf = h.eng.local_forge.clone().unwrap();
    let view = h.eng.view_plan(&kai, &plan.id).unwrap();
    assert_eq!((view["group"]["ready"].as_bool(), view["group"]["next"].as_str(), view["group"]["order"].as_array().map(Vec::len)), (Some(true), Some("T-1"), Some(2)), "{}", view["group"]);

    // the first task's branch moves (an approver asks for a change): the dependent verifies again
    h.eng.on_pr_feedback("T-1", "kai", "导出再加一个版本", true).unwrap();
    let a2 = h.until("T-1", 60, "lib 的任务改完", |t| t.stage == Stage::PrOpen && t.head_sha != a.head_sha).await;
    let b2 = h.until("T-2", 60, "hello 的任务对着新提交重新验证", |t| t.stage == Stage::PrOpen && t.siblings_sha.get("T-1") == a2.head_sha.as_ref()).await;
    assert_ne!(b2.head_sha, b.head_sha, "uses.txt now records the newer export");

    // merging the dependent first is allowed, and flagged
    lf.merge(&h.repo.to_string_lossy(), "demo/hello", b2.pr.as_ref().unwrap().number).await.unwrap();
    h.eng.poll_prs().await.unwrap();
    h.until("T-2", 30, "hello 的任务合并", |t| t.stage == Stage::Done).await;
    assert!(h.security().iter().any(|(k, _)| k == "合并顺序"), "{:?}", h.security());
    lf.merge(&lib_repo.to_string_lossy(), "demo/lib", a2.pr.as_ref().unwrap().number).await.unwrap();
    h.eng.poll_prs().await.unwrap();
    h.until("T-1", 30, "lib 的任务合并", |t| t.stage == Stage::Done).await;
    assert_eq!(h.eng.store.read(|v| v.plan(&plan.id)).unwrap().unwrap().status, "done");
}
