use acw_core::{Member, Role};
use acw_engine::{build, config::Config, demo, devllm, engine::Actor, serve};
use anyhow::Result;
use clap::{Parser, Subcommand};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Parser)]
#[command(name = "acw", version, about = "Auto-CodWorker Engine")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Run the Engine.
    Serve {
        #[arg(long, default_value = "acw.toml")]
        config: PathBuf,
    },
    /// Create the first admin and print their token.
    Init {
        #[arg(long, default_value = "acw.toml")]
        config: PathBuf,
        #[arg(long)]
        id: String,
        #[arg(long)]
        name: String,
        #[arg(long)]
        github: Option<String>,
    },
    /// Issue a new API token for a member.
    Token {
        #[arg(long, default_value = "acw.toml")]
        config: PathBuf,
        #[arg(long)]
        member: String,
    },
    /// Drop all projections and replay the event log.
    Rebuild {
        #[arg(long, default_value = "acw.toml")]
        config: PathBuf,
    },
    /// Run a sandbox host: this machine's sandboxes, for an Engine whose provider is `remote`.
    SandboxHost {
        #[arg(long, default_value = "acw.toml")]
        config: PathBuf,
        #[arg(long, default_value = "0.0.0.0:8790")]
        listen: String,
    },
    /// A rule-based stand-in for a model service, for trying things out offline.
    DevLlm {
        #[arg(long, default_value = "127.0.0.1:8799")]
        listen: String,
    },
    /// Everything on this machine with sample data: local sandbox, local forge, scripted Worker, rule-based models.
    Demo {
        #[arg(long, default_value = "./acw-demo")]
        dir: PathBuf,
        #[arg(long, default_value = "127.0.0.1:8787")]
        listen: String,
        #[arg(long, default_value = "./console")]
        console: PathBuf,
        /// Require member tokens, as in production. A token for the admin is printed.
        #[arg(long)]
        with_auth: bool,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())).init();
    match Cli::parse().cmd {
        Cmd::Serve { config } => serve(build(Config::load(&config)?)?).await,
        Cmd::Init { config, id, name, github } => {
            let eng = build(Config::load(&config)?)?;
            let member = Member { id: id.clone(), name, feishu: None, github, roles: BTreeMap::from([("*".to_owned(), Role::Admin)]), queue_limit: None, delegate: None };
            eng.upsert_member(&Actor::system("init"), member)?;
            println!("管理员 {id} 已创建。令牌只显示这一次：\n{}", eng.issue_token(&id)?);
            Ok(())
        }
        Cmd::Token { config, member } => {
            let eng = build(Config::load(&config)?)?;
            println!("{}", eng.issue_token(&member)?);
            Ok(())
        }
        Cmd::Rebuild { config } => {
            let eng = build(Config::load(&config)?)?;
            println!("重放了 {} 个事件", eng.store.rebuild()?);
            Ok(())
        }
        Cmd::SandboxHost { config, listen } => acw_engine::serve_sandbox_host(Config::load(&config)?, &listen).await,
        Cmd::DevLlm { listen } => {
            let listener = tokio::net::TcpListener::bind(&listen).await?;
            println!("演示模型服务在 http://{listen}/v1");
            axum::serve(listener, devllm::router(Arc::new(devllm::DevLlm::default()))).await?;
            Ok(())
        }
        Cmd::Demo { dir, listen, console, with_auth } => demo::run(dir, listen, console, with_auth).await,
    }
}
