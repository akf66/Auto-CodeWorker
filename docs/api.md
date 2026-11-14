# HTTP 接口

除 `/healthz`、`/webhooks/…`、`/llm/…`、`/replica/…` 和静态文件外，都要 `Authorization: Bearer <成员令牌>`。错误返回 `{"error": "…"}`：400 输入不对，403 没有权限，404 不存在，409 状态不允许，503 这台不是主机（备机或已被取代，只读）。

## 视图（GET）

| 路径 | 内容 |
| --- | --- |
| `/api/me` | 当前成员 |
| `/api/overview` | 我的待处理、统计、在跑和排队的任务 |
| `/api/tickets`、`/api/tickets/{id}` | 任务列表；任务详情（含时间线、完成条件、待处理、沙箱） |
| `/api/routing` | 路由记录（输入和输出） |
| `/api/projects`、`/api/members`、`/api/settings` | 项目卡、成员、设置与接入与历史版本 |
| `/api/cost`、`/api/security`、`/api/notifications`、`/api/ops` | 成本、安全日志、通知记录、运行状态（含告警） |
| `/api/plans`、`/api/plans/{id}` | 计划列表；计划详情（任务状态、预算、跨仓库时的 PR 组和合并顺序） |
| `/api/memory` | 项目记忆和等审核的提议 |
| `/api/eval` | 评测集：用例、评测记录、路由现在用的模型（全局审批角色） |
| `/api/projects/{id}/index` | 代码索引：概况、落后多少提交、访问层、模块预判的命中情况 |
| `/api/projects/{id}/env` | 环境计划：当前版本、历史、等确认的提议 |
| `/api/standby` | 这台的角色、任期、事件序号、落后多少 |
| `/metrics` | Prometheus 文本格式的指标 |
| `/api/events?since=<seq>&token=<令牌>` | SSE。每个事件只带 `seq`、`ticket`、`kind`，客户端据此重新读视图；断线重连带上最后的 `seq` |

## 命令

| 方法和路径 | 作用 | 需要 |
| --- | --- | --- |
| `POST /api/router/messages` `{text}` | 以自己的身份发一条消息给 Router | 成员 |
| `POST /api/router/inbound` `{sender, channel, thread, text}` | 聊天集成代发消息 | 管理 |
| `POST /api/tickets` `{project, goal}` 或 `{project, mandate}` | 直接开任务 | 提需求 |
| `POST /api/tickets/{id}/confirm` `{answer?, rel?}` | 确认需求单；`rel` 为 `par`、`after`、`merge` | 审批 |
| `POST /api/tickets/{id}/answer` `{text}` | 回答问题；来回改或轮数用完时空字符串表示继续修，`false_positive` 表示标为误报 | 审批 |
| `POST /api/tickets/{id}/budget` `{extra}` | 提高预算 | 审批 |
| `POST /api/tickets/{id}/approve-risks` | 批准中风险改动 | 审批 |
| `POST /api/tickets/{id}/stop`、`/retry` | 停止、重试 | 提需求的人或审批 |
| `POST /api/tickets/{id}/handover`、`/handback` | 接手分支、交还 | 审批 |
| `POST /api/tickets/{id}/priority` `{priority}`、`/move` `{project}`、`/finding` `{fingerprint, status}` | 优先级、换项目、标记审查发现 | 审批 |
| `POST /api/tickets/{id}/merge` | 合并（只有本地代码托管时可用） | 审批 |
| `POST /api/queue/{id}/hand` `{to}` | 把一件待处理转给某人 | 能处理这件事的人 |
| `POST /api/routing/{id}/replay` `{endpoint?, model?, prompt?}`、`/feedback` `{wrong}` | 重放、标记判断有误 | 审批、提需求 |
| `PUT /api/projects/{id}`、`PUT /api/members/{id}`、`POST /api/members/{id}/token` | 项目卡、成员、签发令牌 | 管理 |
| `PATCH /api/settings` `{changes, note}`、`POST /api/settings/rollback` `{version}` | 改设置（`changes` 的键是点分路径）、回滚 | 管理 |
| `POST /api/model-endpoints` `{name, base, key, api}`、`POST …/{id}/pull`、`DELETE …/{id}` | 模型接入 | 管理 |
| `POST /api/ops/drain` `{on}`、`POST /api/ops/rebuild` | 排空、重建投影 | 管理 |
| `PUT /api/me/delegate` `{to, days}` | 设代理人；`to` 为 null 取消 | 成员本人 |
| `POST /api/tickets/{id}/rollout-advance`、`/rollout-back` `{reason}` | 当前上线阶段完成并进入下一阶段；回退当前阶段 | 审批 |
| `POST /api/tickets/{id}/fix-issue` `{index}` | 给合并后报上来的第几个问题开修复任务 | 审批 |
| `POST /api/tickets/{id}/answer` `{text: "waive"}` | 没法自动取证的验收标准，这次按人工确认处理 | 审批 |
| `POST /api/plans` `{project, goal, accept, tasks}` | 提计划。任务：`{title, goal, deps, covers, stacked, est, project?}`，`project` 写别的项目编号时任务在那个仓库里做 | 涉及的每个项目的提需求角色 |
| `POST /api/plans/{id}/confirm`、`/drop`、`/change` `{accept, reason}` | 确认、放弃、决定 Worker 提议的改动 | 涉及的每个项目的审批角色 |
| `POST /api/memory/{id}/accept` `{text?}`、`/reject` `{reason}`、`/remove` | 采纳（可改文字）、不采纳提议；删除一条记忆 | 审批 |
| `POST /api/eval/cases` `{route, decision?, project?, note}`、`DELETE /api/eval/cases/{id}` | 把一条路由记录加入评测集（被标为判错的要写应该判成什么）；移出 | 全局审批 |
| `POST /api/eval/run` `{target?: {endpoint, model}}`、`POST /api/eval/compare` `{a, b}` | 跑评测；在同一套用例上比较两个模型 | 全局审批 |
| `POST /api/projects/{id}/index` | 建或重建代码索引 | 审批 |
| `PUT /api/projects/{id}/env` `{setup, services, env, note}` | 把环境计划改成新版本 | 审批 |
| `POST /api/projects/{id}/env/rollback` `{version}`、`/env/detect` | 回到某一版的内容；按仓库里的文件生成草稿（不保存） | 审批 |
| `POST /api/env/{提议编号}/accept`、`/reject` `{reason}` | 决定 Worker 提议的环境计划改动 | 审批 |
| `POST /api/standby/promote` | 把这台备机提升为主机 | 管理 |

改设置时，`changes` 里可以带 `_eval_override`（一句理由）：评测集不同意换路由模型时，管理员用它越过，会记进安全日志。

## 给机器用的

- `POST /webhooks/github`：GitHub webhook，校验 `X-Hub-Signature-256`。
- `POST /webhooks/issues` `{project, title, file, source, url}`：监控把线上问题报进来，请求头 `X-ACW-Token` 带 `ACW_ISSUE_TOKEN` 的值。问题会挂到这个项目里近 14 天合并的、改过这个文件的任务上，返回 `{matched: [任务编号]}`。
- `POST /webhooks/feishu`：飞书事件订阅地址，见 [feishu.md](feishu.md)。
- `/replica/status`、`/replica/events?after=<seq>&limit=<n>`、`/replica/secrets`、`POST /replica/fence` `{epoch}`：热备用，带复制令牌，见 [standby.md](standby.md)。
- `/llm/<任务令牌>/v1/{responses,chat/completions,models}`：模型网关，只给沙箱里的 Worker 用。
