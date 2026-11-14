//! Which model a stage uses, and what each call cost. Keys are read from the secret table at
//! call time and go nowhere else.

use crate::engine::*;
use acw_core::*;
use acw_llm::{LlmError, Msg, Usage};
use anyhow::Result;

#[derive(Debug)]
pub enum StageError {
    /// No connection and model chosen for this stage in the settings.
    NotConfigured(String),
    /// Primary and fallback both failed in a way that may pass. The task waits; it has not failed.
    Unavailable(String),
    Rejected(String),
}

impl std::fmt::Display for StageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StageError::NotConfigured(s) => write!(f, "设置里没有给“{s}”阶段选模型"),
            StageError::Unavailable(s) | StageError::Rejected(s) => f.write_str(s),
        }
    }
}
impl std::error::Error for StageError {}

#[derive(Clone, Debug)]
pub struct Target {
    pub endpoint: Endpoint,
    pub model: String,
    pub key: Option<String>,
}

impl Engine {
    /// Primary first, then the fallback if one is set.
    pub fn stage_targets(&self, stage: &str) -> Result<Vec<Target>> {
        let s = self.settings()?;
        let Some(sm) = s.stages.get(stage) else { return Ok(vec![]) };
        let mut pairs = vec![(sm.endpoint.clone(), sm.model.clone())];
        if let Some((e, m)) = sm.fallback.as_deref().and_then(|f| f.split_once('|')) {
            pairs.push((e.to_owned(), m.to_owned()));
        }
        let mut out = Vec::new();
        for (ep, model) in pairs {
            if let Some(endpoint) = self.store.read(|v| v.endpoint(&ep))? {
                let key = self.store.secret(&format!("endpoint:{}", endpoint.id))?;
                out.push(Target { endpoint, model, key });
            }
        }
        Ok(out)
    }

    /// Record what a call used. Prices come from the catalog in the settings; a model that is not
    /// in the catalog is recorded with its tokens and an amount of zero, flagged as unpriced.
    pub fn record_cost(&self, ticket: Option<&str>, stage: &str, target: &Target, usage: Usage) -> Result<()> {
        if usage.input == 0 && usage.output == 0 {
            return Ok(());
        }
        let info = self.settings()?.catalog.get(&target.model).cloned();
        let amount = info.as_ref().map(|i| acw_llm::price(i.input_price, i.output_price, usage)).unwrap_or(0.0);
        self.store.write(|tx| {
            tx.emit(
                stage,
                ticket,
                Event::CostIncurred { stage: stage.to_owned(), endpoint: target.endpoint.id.clone(), model: target.model.clone(), input: usage.input, output: usage.output, amount, priced: info.is_some() },
            )?;
            Ok(())
        })
    }

    /// One chat completion for an Engine-side stage (router, reviewer, tester).
    pub async fn stage_chat(&self, stage: &str, ticket: Option<&str>, msgs: &[Msg], want_json: bool, only: Option<Target>) -> Result<String, StageError> {
        let targets = match only {
            Some(t) => vec![t],
            None => self.stage_targets(stage).map_err(|e| StageError::Rejected(e.to_string()))?,
        };
        if targets.is_empty() {
            return Err(StageError::NotConfigured(stage.to_owned()));
        }
        let mut last = StageError::Unavailable("没有可用的模型".into());
        for t in &targets {
            match self.llm.chat(&t.endpoint.base, t.key.as_deref(), &t.model, msgs, want_json).await {
                Ok(reply) => {
                    if let Err(e) = self.record_cost(ticket, stage, t, reply.usage) {
                        tracing::warn!("记录成本失败：{e}");
                    }
                    return Ok(reply.text);
                }
                Err(LlmError::Unavailable(m)) => last = StageError::Unavailable(format!("{} / {}：{m}", t.endpoint.name, t.model)),
                Err(LlmError::Rejected(m)) => last = StageError::Rejected(format!("{} / {}：{m}", t.endpoint.name, t.model)),
            }
        }
        Err(last)
    }
}
