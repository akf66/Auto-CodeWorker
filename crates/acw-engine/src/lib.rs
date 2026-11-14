//! Auto-CodWorker Engine.

pub mod agent;
pub mod background;
pub mod commands;
pub mod config;
pub mod demo;
pub mod devllm;
pub mod engine;
pub mod env;
pub mod eval;
pub mod feishu;
pub mod gates;
pub mod gateway;
pub mod http;
pub mod index;
pub mod memory;
pub mod models;
pub mod pipeline;
pub mod plans;
pub mod rollout;
pub mod router;
pub mod sandbox_host;
pub mod scheduler;
pub mod standby;
pub mod views;

use acw_core::Store;
use acw_git::{Forge, GitGateway, GitHub, LocalForge};
use acw_sandbox::{firecracker::{FirecrackerCfg, FirecrackerProvider}, local::LocalProvider, SandboxProvider};
use anyhow::{bail, Context, Result};
use config::Config;
use engine::Engine;
use std::sync::Arc;

/// The sandbox provider the configuration names.
pub fn make_provider(cfg: &Config) -> Result<Arc<dyn SandboxProvider>> {
    Ok(match cfg.sandbox.provider.as_str() {
        "local" => Arc::new(LocalProvider::new(cfg.data_dir.join("sandboxes"))?),
        "firecracker" => {
            let f = &cfg.sandbox.firecracker;
            Arc::new(FirecrackerProvider::new(FirecrackerCfg {
                bin: f.bin.clone(), kernel: f.kernel.clone(), templates: f.templates.clone(), default_template: f.default_template.clone(),
                run_dir: cfg.data_dir.join("vms"), ssh_key: f.ssh_key.clone(), vcpus: f.vcpus, mem_mib: f.mem_mib, net_prefix: f.net_prefix.clone(), host_name: f.host_name.clone(),
            })?)
        }
        "remote" => {
            let r = &cfg.sandbox.remote;
            Arc::new(sandbox_host::RemoteProvider::new(r.hosts.clone(), std::env::var(&r.token_env).unwrap_or_default(), cfg.sandbox.allow_unisolated)?)
        }
        other => bail!("不认识的沙箱提供方：{other}"),
    })
}

/// Run a sandbox host: this machine's provider behind the sandbox host API.
pub async fn serve_sandbox_host(cfg: Config, listen: &str) -> Result<()> {
    if cfg.sandbox.provider == "remote" {
        bail!("沙箱主机自己要用 local 或 firecracker，不能再转给别的主机");
    }
    let token = std::env::var(&cfg.sandbox.remote.token_env).unwrap_or_default();
    if token.is_empty() {
        bail!("环境变量 {} 里没有沙箱主机的令牌", cfg.sandbox.remote.token_env);
    }
    std::fs::create_dir_all(&cfg.data_dir).with_context(|| format!("创建数据目录 {}", cfg.data_dir.display()))?;
    let provider = make_provider(&cfg)?;
    let listener = tokio::net::TcpListener::bind(listen).await.with_context(|| format!("监听 {listen}"))?;
    tracing::info!("沙箱主机在 http://{listen} 上运行（提供方 {}，{}）", provider.name(), if provider.isolated() { "有隔离" } else { "没有隔离" });
    axum::serve(listener, sandbox_host::host_app(provider, &token, &cfg.sandbox.firecracker.host_name)).await?;
    Ok(())
}

/// Wire the Engine up from its configuration. Nothing starts running yet.
pub fn build(cfg: Config) -> Result<Arc<Engine>> {
    std::fs::create_dir_all(&cfg.data_dir).with_context(|| format!("创建数据目录 {}", cfg.data_dir.display()))?;
    let store = Store::open(&cfg.data_dir.join("acw.db"))?;
    let sandbox = make_provider(&cfg)?;
    let (forge, local_forge): (Arc<dyn Forge>, Option<Arc<LocalForge>>) = match cfg.forge.kind.as_str() {
        "local" => {
            let lf = Arc::new(LocalForge::new(cfg.data_dir.join("forge"))?);
            (lf.clone(), Some(lf))
        }
        "github" => {
            let token = std::env::var(&cfg.forge.token_env).with_context(|| format!("环境变量 {} 里没有 GitHub 令牌", cfg.forge.token_env))?;
            (Arc::new(GitHub::new(&cfg.forge.api, &token)), None)
        }
        other => bail!("不认识的代码托管类型：{other}"),
    };
    let eng = Arc::new(Engine {
        git: GitGateway::new(cfg.data_dir.join("mirrors"))?,
        store,
        llm: acw_llm::LlmClient::new(),
        http: reqwest::Client::new(),
        sandbox,
        forge,
        local_forge,
        runs: Default::default(),
        merged: Default::default(),
        feishu_token: Default::default(),
        standby: Default::default(),
        wake: tokio::sync::Notify::new(),
        cfg,
    });
    eng.init_role()?;
    if eng.is_primary() {
        eng.init()?;
    }
    Ok(eng)
}

/// Start the background loops. Tasks that held a slot before a restart are picked up by the scheduler.
pub fn start(eng: &Arc<Engine>) {
    tokio::spawn(eng.clone().scheduler());
    tokio::spawn(eng.clone().outbox());
    tokio::spawn(eng.clone().clock());
    tokio::spawn(eng.clone().follow());
}

pub async fn serve(eng: Arc<Engine>) -> Result<()> {
    start(&eng);
    let listener = tokio::net::TcpListener::bind(&eng.cfg.listen).await.with_context(|| format!("监听 {}", eng.cfg.listen))?;
    tracing::info!("Auto-CodWorker Engine 在 http://{} 上运行（沙箱 {}，代码托管 {}，Worker {}）", eng.cfg.listen, eng.sandbox.name(), eng.forge.name(), eng.cfg.worker.agent);
    axum::serve(listener, http::app(eng)).await?;
    Ok(())
}
