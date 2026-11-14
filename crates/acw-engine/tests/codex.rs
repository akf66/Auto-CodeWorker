//! PoC: the real codex CLI as the Worker, inside a sandbox, with no model key of its own.
//! codex → the Engine's model gateway (per-task token) → a model service speaking the Responses API.
//! The model here is the rule-based stand-in, so this proves the plumbing, not the model.
//!
//! Needs `codex` on PATH. Run with: ACW_CODEX_POC=1 cargo test -p acw-engine --test codex -- --nocapture

mod common;
use acw_core::*;
use common::*;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn codex_works_through_the_gateway() {
    if std::env::var("ACW_CODEX_POC").is_err() {
        eprintln!("跳过：设置 ACW_CODEX_POC=1 并安装 codex CLI 后运行");
        return;
    }
    // round one leaves a marked bug, so the review sends the task back and codex is resumed in the same sandbox
    std::env::set_var("ACW_DEVLLM_CMD", "if grep -q BUG README.md; then sed -i '/BUG/d' README.md; printf 'changed by the agent\\n' >> README.md; else printf 'BUG: 说明写错了\\n' >> README.md; fi");
    let h = Harness::with("", |cfg| {
        cfg.worker.agent = "codex".into();
        cfg.worker.idle_minutes = 2;
    })
    .await;
    if std::env::var("ACW_CODEX_CHAT").is_ok() {
        // the same connection, declared as Chat Completions only: the gateway has to translate
        let mut ep = h.eng.store.read(|v| v.endpoints()).unwrap().remove(0);
        ep.api = "chat".into();
        h.eng.store.write(|tx| tx.emit("test", None, Event::EndpointUpserted { endpoint: ep }).map(|_| ())).unwrap();
    }
    let id = h.say("kai", "hello 的 README 加一行说明").await.ticket.unwrap();
    let t = h.until(&id, 240, "codex 改完并开出 PR", |t| t.stage == Stage::PrOpen || t.stage == Stage::Failed).await;
    let events = h.eng.store.read(|v| v.events_for(&id)).unwrap();
    for e in &events {
        if let Some((k, w, d)) = acw_engine::views::timeline_entry(e) {
            eprintln!("[{k}] {w} | {}", d.lines().next().unwrap_or_default());
        }
    }
    assert_eq!(t.stage, Stage::PrOpen, "{} / {}", t.state, t.why);
    assert_eq!(t.review.round, 2, "the first review found the bug, the resumed session fixed it");
    let cmds = events.iter().filter(|e| matches!(&e.event, Event::WorkerStep { kind, .. } if kind == "cmd")).count();
    assert_eq!(cmds, 2, "one command per codex run: the fresh one and the resumed one");
    let worker_cost: Vec<&StoredEvent> = events.iter().filter(|e| matches!(&e.event, Event::CostIncurred { stage, .. } if stage == "worker")).collect();
    assert!(!worker_cost.is_empty(), "the gateway counted codex's model usage");
    let readme = std::process::Command::new("git").arg("-C").arg(&h.repo).args(["show", &format!("{}:README.md", t.branch.as_deref().unwrap())]).output().unwrap();
    assert!(String::from_utf8_lossy(&readme.stdout).contains("changed by the agent"));
}
