//! `acw demo`: the whole loop on one machine, with nothing external. A small sample repository,
//! the local forge, the local (unisolated) sandbox, a scripted Worker and the rule-based model
//! service. It exists to show the flow and to try the console; it proves nothing about real models.

use crate::config::Config;
use crate::engine::Actor;
use crate::{build, devllm, serve};
use acw_core::*;
use anyhow::{bail, Context, Result};
use serde_json::json;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

const GREET: &str = "#!/bin/sh\n# greet.sh NAME: prints a greeting\nname=\"$1\"\necho \"Hello, $name\"\n";
const UNIT: &str = "#!/bin/sh\nset -e\nout=$(sh greet.sh Kai)\n[ \"$out\" = \"Hello, Kai\" ] || { echo \"unexpected: $out\"; exit 1; }\necho \"unit ok\"\n";
const E2E: &str = "#!/bin/sh\nset -e\nsh greet.sh World | grep -q '^Hello, World$'\nsh -n greet.sh\necho \"e2e ok\"\n";
const AGENTS: &str = "# AGENTS.md\n\n- 这是一个演示仓库：`greet.sh` 输出问候语。\n- 改动后跑 `sh tests/greet_test.sh` 和 `sh tests/e2e.sh`。\n- 不要删除 tests/ 下的测试。\n";

/// The scripted Worker for the demo. Round one implements `--shout` and leaves a marked bug;
/// when the review findings come back it fixes it. Lines like `edit: …` become timeline steps.
pub const WORKER: &str = r#"#!/bin/sh
set -e
prompt=../io/prompt.md
echo "read: 读需求单和 AGENTS.md"
if grep -q "审查发现" "$prompt"; then
  echo "edit: 修掉审查指出的问题：没有名字时给出用法提示"
  cat > greet.sh <<'EOF'
#!/bin/sh
# greet.sh [--shout] NAME: prints a greeting
shout=0
if [ "$1" = "--shout" ]; then shout=1; shift; fi
name="$1"
if [ -z "$name" ]; then echo "usage: greet.sh [--shout] NAME" >&2; exit 2; fi
msg="Hello, $name"
if [ "$shout" = 1 ]; then msg=$(printf '%s' "$msg" | tr '[:lower:]' '[:upper:]'); fi
echo "$msg"
EOF
  printf -- '- [x] 读代码\n- [x] 加 --shout 参数\n- [x] 处理没有名字的情况\n' > ../io/progress.md
else
  echo "edit: 给 greet.sh 加 --shout 参数"
  cat > greet.sh <<'EOF'
#!/bin/sh
# greet.sh [--shout] NAME: prints a greeting
shout=0
if [ "$1" = "--shout" ]; then shout=1; shift; fi
name="$1"
# BUG: 没有名字时输出了空的问候
msg="Hello, $name"
if [ "$shout" = 1 ]; then msg=$(printf '%s' "$msg" | tr '[:lower:]' '[:upper:]'); fi
echo "$msg"
EOF
  printf -- '- [x] 读代码\n- [x] 加 --shout 参数\n- [ ] 处理没有名字的情况\n' > ../io/progress.md
fi
echo "cmd: sh tests/greet_test.sh"
sh tests/greet_test.sh
echo "say: 改完了，单元测试通过。"
"#;

async fn sh(dir: &Path, cmd: &str) -> Result<()> {
    let out = tokio::process::Command::new("sh").arg("-c").arg(cmd).current_dir(dir).output().await?;
    if !out.status.success() {
        bail!("`{cmd}` 失败：{}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(())
}

/// A bare repository with the sample project on `main`.
pub async fn sample_repo(root: &Path) -> Result<PathBuf> {
    let bare = root.join("repos").join("hello.git");
    if bare.exists() {
        return Ok(bare);
    }
    let work = root.join("repos").join("seed");
    tokio::fs::create_dir_all(work.join("tests")).await?;
    for (path, text) in [("greet.sh", GREET), ("tests/greet_test.sh", UNIT), ("tests/e2e.sh", E2E), ("AGENTS.md", AGENTS), ("README.md", "# hello\n\n演示仓库。\n")] {
        tokio::fs::write(work.join(path), text).await?;
    }
    sh(&root.join("repos"), "git init -q --bare -b main hello.git").await?;
    sh(&work, "git init -q -b main . && git config user.email demo@localhost && git config user.name demo && git add -A && git commit -q -m 'initial' && git push -q ../hello.git main").await?;
    tokio::fs::remove_dir_all(&work).await?;
    Ok(bare)
}

pub fn sample_project(repo: &Path) -> Project {
    Project {
        id: "hello".into(),
        name: "hello".into(),
        summary: "演示项目：一个输出问候语的脚本".into(),
        aliases: vec!["问候".into(), "greet".into()],
        channels: vec!["飞书群：hello 开发".into()],
        repo: repo.to_string_lossy().into_owned(),
        slug: "demo/hello".into(),
        base_branch: "main".into(),
        modules: vec![
            Module { name: "问候".into(), paths: vec!["greet.sh".into()], confirm: None },
            Module { name: "计费".into(), paths: vec!["billing/".into()], confirm: Some("计费与金额".into()) },
        ],
        commands: Commands { setup: vec![], build: Some("sh -n greet.sh".into()), lint: None, unit: Some("sh tests/greet_test.sh".into()), e2e: Some("sh tests/e2e.sh".into()) },
        protected_tests: vec!["tests/".into()],
        test_gen: Some(TestGen { dir: "tests".into(), command: "sh {file}".into(), hint: "POSIX sh 脚本，失败时以非零退出".into() }),
        sandbox: SandboxPref::default(),
        two_person: false,
        ..Default::default()
    }
}

pub fn member(id: &str, name: &str, global: Role, extra: &[(&str, Role)]) -> Member {
    let mut roles = BTreeMap::from([("*".to_owned(), global)]);
    roles.extend(extra.iter().map(|(k, r)| (k.to_string(), *r)));
    Member { id: id.into(), name: name.into(), feishu: None, github: Some(id.into()), roles, queue_limit: None, delegate: None }
}

/// Members, the sample project, a connection to the rule-based model service and stage models.
pub async fn seed(eng: &Arc<crate::engine::Engine>, repo: &Path, llm_base: &str) -> Result<()> {
    let sys = Actor::system("demo");
    if eng.store.read(|v| v.members())?.is_empty() {
        eng.upsert_member(&sys, member("kai", "KaifengAn", Role::Admin, &[]))?;
        eng.upsert_member(&sys, member("lin", "林舟", Role::Requester, &[("hello", Role::Approver)]))?;
        eng.upsert_member(&sys, member("yue", "赵悦", Role::Requester, &[]))?;
    }
    eng.upsert_project(&sys, sample_project(repo))?;
    let existing = eng.store.read(|v| v.endpoints())?;
    let ep = match existing.into_iter().find(|e| e.base == llm_base) {
        Some(e) => e,
        None => eng.add_endpoint(&sys, "演示模型（规则）", llm_base, "dev-key", "responses").await?,
    };
    let mut patch = serde_json::Map::new();
    for (stage, model) in [("router", "dev-small"), ("worker", "dev-large"), ("reviewer", "dev-large"), ("tester", "dev-small")] {
        patch.insert(format!("stages.{stage}"), json!({ "endpoint": ep.id, "model": model, "fallback": null }));
    }
    // made-up prices so the cost pages have something to show
    patch.insert("catalog.dev-small".into(), json!({ "context": 128000, "input_price": 1.0, "output_price": 4.0 }));
    patch.insert("catalog.dev-large".into(), json!({ "context": 200000, "input_price": 6.0, "output_price": 24.0 }));
    eng.change_settings(&sys, &patch, "演示数据")?;
    Ok(())
}

pub async fn run(dir: PathBuf, listen: String, console: PathBuf, with_auth: bool) -> Result<()> {
    tokio::fs::create_dir_all(&dir).await?;
    let dir = dir.canonicalize()?;
    let repo = sample_repo(&dir).await?;
    let worker = dir.join("worker.sh");
    tokio::fs::write(&worker, WORKER).await?;

    let (host, port) = listen.rsplit_once(':').context("listen 要写成 host:port")?;
    let llm_listen = format!("{host}:{}", port.parse::<u16>()? + 1);
    let llm = tokio::net::TcpListener::bind(&llm_listen).await.with_context(|| format!("监听 {llm_listen}"))?;
    tokio::spawn(async move {
        let _ = axum::serve(llm, devllm::router(Arc::new(devllm::DevLlm::default()))).await;
    });

    let mut cfg = Config { listen: listen.clone(), data_dir: dir.join("data"), public_url: format!("http://{listen}"), gateway_url: format!("http://{listen}"), auth: if with_auth { "token".into() } else { "none".into() }, console_dir: console, ..Default::default() };
    cfg.forge.kind = "local".into();
    cfg.forge.poll_seconds = 5;
    cfg.sandbox.provider = "local".into();
    cfg.sandbox.allow_unisolated = true;
    cfg.worker.agent = "scripted".into();
    cfg.worker.scripted_cmd = format!("sh {}", acw_sandbox::sh_quote(&worker.to_string_lossy()));
    let eng = build(cfg)?;
    seed(&eng, &repo, &format!("http://{llm_listen}/v1")).await?;
    println!("演示环境：控制台 http://{listen}  数据目录 {}", dir.display());
    if with_auth {
        println!("管理员 kai 的令牌（只显示这一次）：{}", eng.issue_token("kai")?);
    }
    println!("试试在“对话”里发：给 hello 的 greet.sh 加一个 --shout 参数，验收：`sh greet.sh --shout kai | grep -q 'HELLO, KAI'`");
    serve(eng).await
}
