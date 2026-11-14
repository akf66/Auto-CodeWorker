//! The Router's eval set. Cases are real routing inputs with the decision they should lead to;
//! a run replays every case against one model and counts how many come out right. Two runs on the
//! same cases can be compared pair by pair. Changing the Router's model is held back until the new
//! model has a run on the current set that is not worse than the model in use.

use crate::engine::*;
use crate::models::Target;
use acw_core::*;
use anyhow::Result;
use futures::StreamExt;
use sha2::{Digest, Sha256};

pub fn set_fingerprint(cases: &[EvalCase]) -> String {
    let mut h = Sha256::new();
    for c in cases {
        h.update(format!("{}|{}|{}|{}\n", c.id, c.input.text, c.decision, c.project.as_deref().unwrap_or("")).as_bytes());
    }
    hex::encode(h.finalize())[..12].to_owned()
}

/// Why the Router's model may not be changed from `old` to `new`, or None.
pub fn eval_gate(v: &View, old: Option<&StageModel>, new: Option<&StageModel>) -> Result<Option<String>> {
    let Some(new) = new else { return Ok(None) };
    if old.is_some_and(|o| o.endpoint == new.endpoint && o.model == new.model) {
        return Ok(None);
    }
    let cases = v.eval_cases()?;
    if cases.is_empty() {
        return Ok(None);
    }
    let set = set_fingerprint(&cases);
    let runs = v.eval_runs()?;
    let of = |m: &StageModel| runs.iter().find(|r| r.set == set && r.endpoint == m.endpoint && r.model == m.model);
    let Some(candidate) = of(new) else {
        return Ok(Some(format!("评测集有 {} 条用例，{} 还没有在现在这套用例上跑过。先跑评测，再换路由模型", cases.len(), new.model)));
    };
    if let Some(current) = old.and_then(of) {
        if candidate.passed < current.passed {
            return Ok(Some(format!("{} 在评测集上通过 {}/{}，现在用的 {} 是 {}/{}。新模型更差，不换", new.model, candidate.passed, candidate.cases, current.model, current.passed, current.cases)));
        }
    }
    Ok(None)
}

impl Engine {
    /// Keep a routing record as a case. Without an explicit expectation the record's own decision
    /// is taken as right, which is refused for a record someone marked as wrong.
    pub fn save_eval_case(&self, actor: &Actor, route: &str, decision: Option<&str>, project: Option<&str>, note: &str) -> Result<EvalCase> {
        self.store.write(|tx| {
            actor.require(Role::Approver, None, "改评测集")?;
            let r = tx.view().route(route)?.ok_or_else(|| not_found("没有这条路由记录"))?;
            if decision.is_none() && (r.wrong || r.moved) {
                return Err(invalid("这条记录被标成了判错，要写上它应该判成什么"));
            }
            let decision = decision.unwrap_or(&r.output.decision).to_owned();
            if !["answer", "new_ticket", "route_to_ticket", "ask", "stop_ticket"].contains(&decision.as_str()) {
                return Err(invalid("判定只能是 answer、new_ticket、route_to_ticket、ask、stop_ticket"));
            }
            let project = match project {
                Some(p) => Some(p.to_owned()),
                None if decision == r.output.decision => r.output.project.clone(),
                None => None,
            };
            if let Some(p) = &project {
                tx.view().project(p)?.ok_or_else(|| not_found(format!("找不到项目 {p}")))?;
            }
            let case = EvalCase { id: format!("C-{route}"), input: r.input.clone(), decision, project, note: note.to_owned(), route: route.to_owned(), by: actor.id.clone(), at: tx.now() };
            tx.emit(&actor.id, None, Event::EvalCaseSaved { case: case.clone() })?;
            Ok(case)
        })
    }

    pub fn remove_eval_case(&self, actor: &Actor, id: &str) -> Result<()> {
        self.store.write(|tx| {
            actor.require(Role::Approver, None, "改评测集")?;
            tx.emit(&actor.id, None, Event::EvalCaseRemoved { id: id.to_owned() }).map(|_| ())
        })
    }

    fn eval_target(&self, target: Option<(String, String)>) -> Result<Target> {
        match target {
            Some((ep, model)) => {
                let endpoint = self.store.read(|v| v.endpoint(&ep))?.ok_or_else(|| not_found("没有这个接入"))?;
                if !endpoint.models.contains(&model) {
                    return Err(invalid("这个接入的模型列表里没有这个模型"));
                }
                let key = self.store.secret(&format!("endpoint:{ep}"))?;
                Ok(Target { endpoint, model, key })
            }
            None => self.stage_targets("router")?.into_iter().next().ok_or_else(|| invalid("设置里没有给 router 阶段选模型")),
        }
    }

    /// Replay every case against one model (the Router's current one when `target` is None).
    /// Nothing is created: `decide` only decides.
    pub async fn run_eval(&self, actor: &Actor, target: Option<(String, String)>) -> Result<EvalRun> {
        actor.require(Role::Approver, None, "跑评测")?;
        let cases = self.store.read(|v| v.eval_cases())?;
        if cases.is_empty() {
            return Err(invalid("评测集是空的。先在路由记录里把判对的、判错的记录加进来"));
        }
        let t = self.eval_target(target)?;
        let outs: Vec<(EvalCase, Result<RouteOutput>)> = futures::stream::iter(cases.iter().cloned())
            .map(|c| {
                let t = t.clone();
                async move {
                    let out = self.decide(&c.input, Some(t), None).await;
                    (c, out)
                }
            })
            .buffered(4)
            .collect()
            .await;
        let mut run = EvalRun { by: actor.id.clone(), endpoint: t.endpoint.id.clone(), model: t.model.clone(), set: set_fingerprint(&cases), cases: cases.len() as u32, ..Default::default() };
        for (c, out) in outs {
            let (ok, got) = match &out {
                Ok(o) => (c.passes(o), match &o.project { Some(p) => format!("{} → {p}", o.decision), None => o.decision.clone() }),
                Err(e) => {
                    run.errors += 1;
                    (false, format!("调用失败：{e}"))
                }
            };
            if ok {
                run.passed += 1;
            } else {
                run.misses.push(EvalMiss { case: c.id.clone(), want: c.want(), got });
            }
            run.results.insert(c.id, ok);
        }
        self.store.write(|tx| {
            run.id = format!("EV-{}", tx.view().last_seq()? + 1);
            run.at = tx.now();
            tx.emit(&actor.id, None, Event::EvalRan { run: run.clone() })?;
            Ok(run)
        })
    }

    /// Run two models on the same cases and compare them pair by pair.
    pub async fn compare_eval(&self, actor: &Actor, a: (String, String), b: (String, String)) -> Result<serde_json::Value> {
        let ra = self.run_eval(actor, Some(a)).await?;
        let rb = self.run_eval(actor, Some(b)).await?;
        let (only_a, only_b, p) = paired(&ra, &rb);
        let verdict = if only_a == only_b {
            "两个模型在这套用例上没有差别".to_owned()
        } else if p < 0.05 {
            format!("{} 更好，差别不像是偶然（p={p:.3}）", if only_a > only_b { &ra.model } else { &rb.model })
        } else {
            format!("{} 通过得多一些，但用例太少，差别可能是偶然（p={p:.3}）", if only_a > only_b { &ra.model } else { &rb.model })
        };
        Ok(serde_json::json!({ "a": ra, "b": rb, "only_a": only_a, "only_b": only_b, "p": p, "verdict": verdict }))
    }

    pub fn view_eval(&self, actor: &Actor) -> Result<serde_json::Value> {
        actor.require(Role::Approver, None, "看评测集")?;
        self.store.read(|v| {
            let cases = v.eval_cases()?;
            let set = set_fingerprint(&cases);
            let runs: Vec<EvalRun> = v.eval_runs()?.into_iter().take(30).collect();
            let current = v.settings()?.stages.get("router").cloned();
            Ok(serde_json::json!({ "cases": cases, "set": set, "runs": runs, "router": current }))
        })
    }
}
