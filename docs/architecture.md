# 架构

## 写入只有一条路

```
命令（HTTP、Router、流水线、webhook）
   │  在一个 SQLite 事务里：读投影 → 校验权限和状态 → 追加事件 → 更新投影 → 副作用入队
   ▼
事件日志 events（只追加）──► 投影 doc / cost（可随时重建）
   │ 提交后
   ├──► 广播给订阅者（SSE、调度器被叫醒）
   └──► 副作用队列 outbox ──► 通知、销毁沙箱（至少一次，失败重试）
```

`Store::write` 是唯一的写入口。命令失败时事务回滚，什么都不会留下。事件里不放代码和完整输出，只放事实。

投影是文档型的：`doc(kind, id, body)`，按种类存 JSON（ticket、project、member、settings、endpoint、queue、sandbox、route、thread，以及 v0.2 的 plan、memory、memory_proposal、env、env_history、env_proposal、eval_case、eval_run、index、alert、inbound）。成本单独一张表，方便求和。时间线不是投影，直接按任务读事件。

## 任务的状态

```
mandate_pending ─确认─► queued ─有槽位─► provisioning ► working ► checking ► reviewing ► testing ► opening ► pr_open ─合并─► (rolling_out ─阶段都完成─►) done
                                              ▲            │           │           │
                                              └── 带着原因回去 ─┴───────────┴───────────┘
任何活动阶段都可能转到：blocked（等人决定）、waiting（模型不可用，稍后重试）、failed（等人重试）、dropped（停止）
```

流水线（`pipeline.rs`）是一个循环：读任务当前阶段，做这个阶段的事，写下一个阶段。Engine 重启后，调度器发现“阶段是活动的但没有在跑”的任务就重新拉起，从当前阶段继续；沙箱不在了就用模板和任务分支重建。任务的持久状态只有事件日志和远端任务分支。

## 三道边界

1. **权限**：每个命令先查角色（`Actor::require`）。系统角色（engine、router、github）只在 Engine 自己选择的代码路径里出现。
2. **凭证**：模型 key 和代码托管令牌只在 Engine 进程里。沙箱拿到的是每任务的网关令牌，任务不在运行时这个令牌没用。
3. **代码**：`GitGateway` 只接受声明为本任务分支的 bundle，并且 bundle 里只能有这一个引用；只推送任务分支。

## 模块对照

| 设计里的概念 | 代码 |
| --- | --- |
| Engine 单写者、事件与投影 | `acw-core/src/store.rs`、`projection.rs` |
| 副作用同事务入队 | `Tx::effect`，`background.rs` 的 `outbox` |
| Router 无状态、可重放 | `router.rs` 的 `decide`（不写库）和 `route`（执行决定） |
| 需确认规则、能力分档 | `create_ticket_tx`（需求单）、`gates.rs` 的 `classify_risks`（改动） |
| 完成条件 | `Ticket::contract_ok`，各关卡写 `ContractSet`，开 PR 前整体复核 |
| 审查收敛 | `gates.rs` 的 `review`，投影里的 `returned` 计数 |
| 人的队列与背压 | `open_queue` / `close_queue`、`background.rs` 的 `chase`、`scheduler.rs` 的 `held` |
| 模型按阶段配置、备用模型 | `models.rs` |
| 模型 key 由沙箱外注入 | `gateway.rs` |
| 来源标记 | `Input.trusted`，`agent.rs` 的 `compose_prompt` |
| 计划、任务图、叠放 PR、跨仓库 PR 组 | `plans.rs`；`pipeline.rs` 的 `mount_siblings`、`siblings_changed` |
| 分阶段上线、问题回流 | `rollout.rs` |
| 非功能验收的证据 | `gates.rs` 的 `measure`、`judge_perf` |
| 架构变化与 diff 核对 | `ArchDelta`、`gates.rs` 的 `arch_divergence` |
| 项目记忆 | `memory.rs` |
| 代码索引 | `index.rs`（索引本身是数据目录里的文件，日志里只记概况） |
| 环境计划 | `env.rs`、`EnvPlan::needs_person` |
| Router 评测集与换模型闸门 | `eval.rs`，`change_settings` 里调用 `eval_gate` |
| 飞书入站 | `feishu.rs` |
| 热备 | `standby.rs`，`Store` 的 `replicate`、只读开关、`meta` 表 |
| 远程沙箱主机 | `sandbox_host.rs` |

## v0.2 加进来的几条规则

- **Worker 只能提议，不能决定。** 改计划（`io/replan.json`）、改环境计划（`io/env.json`）、架构变化（`io/arch.json`）、问题（`io/question.md`）都是沙箱里的文件，Engine 读出来、校验、按规则处理：环境计划里只有白名单内的安装命令会自动采纳，其余都进审批人的待处理。
- **代码索引只往严的方向用。** 它是正则抽出来的，会误认。所以它只能让一条需求多命中模块（多触发确认规则），不能让任何检查放行。
- **评测集管着路由模型。** 评测集里有用例时，新模型要在现在这套用例上跑过、且通过数不比现在的模型少，才能换。管理员可以带理由越过，越过会留记录。
- **一个任务一个仓库不变。** 跨仓库是计划层面的事：每个仓库一个任务、一个 PR；依赖的仓库以只读检出的形式出现在沙箱里，依赖的分支动了，下游任务重新验证。
- **只有主机写。** 备机和被取代的机器在存储层（`Store::write` 直接报错）和 HTTP 层（非 GET 请求 503）两处都拒绝写入，后台循环空转。备机追加事件走单独的入口 `Store::replicate`，它要求序号连续，并且不产生副作用。
- **同一个仓库镜像同一时间只有一个写入者。** `GitGateway` 按项目加锁：fetch、接收 bundle、打 bundle、推送互斥。
