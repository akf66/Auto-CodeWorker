//! Sandboxes on another machine: the remote provider against a sandbox host (here on a local port).
mod common;
use acw_core::*;
use acw_engine::sandbox_host::{host_app, RemoteProvider};
use acw_sandbox::{local::LocalProvider, CancellationToken, ExecSpec, LineSink, SandboxProvider, SandboxSpec};
use common::*;
use std::sync::{Arc, Mutex};
use std::time::Duration;

async fn host(root: &std::path::Path, token: &str, name: &str) -> String {
    let provider: Arc<dyn SandboxProvider> = Arc::new(LocalProvider::new(root).unwrap());
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", l.local_addr().unwrap());
    let app = host_app(provider, token, name);
    tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
    base
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_remote_provider_does_what_a_local_one_does_over_the_wire() {
    let tmp = tempfile::tempdir().unwrap();
    let (h1, h2) = (host(&tmp.path().join("a"), "tok", "node-a").await, host(&tmp.path().join("b"), "tok", "node-b").await);

    // hosts without isolation are refused unless the configuration allows them; a wrong token gets nowhere
    let strict = RemoteProvider::new(vec![h1.clone()], "tok".into(), false).unwrap();
    let e = strict.create(&SandboxSpec { id: "sb-T-1".into(), ..Default::default() }).await.unwrap_err().to_string();
    assert!(e.contains("没有隔离"), "{e}");
    let wrong = RemoteProvider::new(vec![h1.clone()], "nope".into(), true).unwrap();
    assert!(wrong.create(&SandboxSpec { id: "sb-T-1".into(), ..Default::default() }).await.is_err());
    assert!(RemoteProvider::new(vec![], "tok".into(), true).is_err());

    let p = RemoteProvider::new(vec![h1.clone(), h2.clone()], "tok".into(), true).unwrap();
    assert!(!p.isolated());
    // sandboxes spread over the hosts
    let a = p.create(&SandboxSpec { id: "sb-T-1".into(), ..Default::default() }).await.unwrap();
    let b = p.create(&SandboxSpec { id: "sb-T-2".into(), ..Default::default() }).await.unwrap();
    assert_ne!(a.host, b.host, "the second sandbox went to the emptier host");
    assert!(p.exists("sb-T-1").await && !p.exists("sb-T-9").await);

    // files, environment, exit codes and streamed lines
    p.put_file("sb-T-1", "io/in.txt", b"hello").await.unwrap();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let s2 = seen.clone();
    let sink: LineSink = Arc::new(move |l| s2.lock().unwrap().push(l.to_owned()));
    let r = p.exec("sb-T-1", ExecSpec::new("cat ../io/in.txt; echo; echo \"[$GIVEN]\"; cat > ../io/out.txt; exit 3").env("GIVEN", "yes").stdin(b"from stdin".to_vec()), Some(sink), CancellationToken::new()).await.unwrap();
    assert_eq!((r.code, r.ok()), (3, false));
    assert_eq!(*seen.lock().unwrap(), ["hello", "[yes]"]);
    assert_eq!(p.get_file("sb-T-1", "io/out.txt").await.unwrap(), b"from stdin");
    assert!(p.get_file("sb-T-1", "io/missing").await.is_err());
    assert!(p.put_file("sb-T-1", "../escape", b"x").await.is_err());
    let r = p.exec("sb-T-1", ExecSpec::new("sleep 30").timeout(Duration::from_millis(300)), None, CancellationToken::new()).await.unwrap();
    assert!(r.timed_out);

    // cancelling on the Engine's side stops the command on the host
    let cancel = CancellationToken::new();
    let c2 = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        c2.cancel();
    });
    let began = std::time::Instant::now();
    let r = p.exec("sb-T-1", ExecSpec::new("echo started > ../io/run.txt; sleep 2; echo finished > ../io/run.txt"), None, cancel).await.unwrap();
    assert!(r.cancelled && began.elapsed() < Duration::from_secs(2));
    tokio::time::sleep(Duration::from_millis(2500)).await;
    assert_eq!(p.get_file("sb-T-1", "io/run.txt").await.unwrap(), b"started\n", "the command did not outlive its caller");

    // a restarted Engine (a fresh provider) finds its sandboxes by asking the hosts
    let again = RemoteProvider::new(vec![h1, h2], "tok".into(), true).unwrap();
    assert_eq!(again.get_file("sb-T-1", "io/in.txt").await.unwrap(), b"hello");
    again.destroy("sb-T-1").await.unwrap();
    assert!(!p.exists("sb-T-1").await);
    again.destroy("sb-T-404").await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_task_runs_to_a_pull_request_on_a_sandbox_host() {
    std::env::set_var("ACW_T4_SBX", "tok");
    let tmp = tempfile::tempdir().unwrap();
    let h1 = host(&tmp.path().join("a"), "tok", "node-a").await;
    let h = Harness::with(acw_engine::demo::WORKER, |c| {
        c.sandbox.provider = "remote".into();
        c.sandbox.remote.hosts = vec![h1.clone()];
        c.sandbox.remote.token_env = "ACW_T4_SBX".into();
    })
    .await;
    let id = h.say("yue", SHOUT).await.ticket.unwrap();
    let t = h.until(&id, 90, "在远程沙箱里跑到开出 PR", |t| t.stage == Stage::PrOpen).await;
    assert!(t.contract_ok());
    let sb = h.eng.store.read(|v| v.sandboxes()).unwrap();
    assert!(sb.iter().any(|s| s.provider == "remote" && s.host == "node-a"), "{sb:?}");
}
