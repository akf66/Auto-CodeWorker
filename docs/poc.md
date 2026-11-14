# PoC 结论（2026-11-14）

## 1. codex 能不能在没有 key 的沙箱里，经我们的网关工作

能。用真实的 codex CLI 0.169.0 验证过，测试在 `crates/acw-engine/tests/codex.rs`：

```sh
ACW_CODEX_POC=1 cargo test -p acw-engine --test codex -- --nocapture
```

链路：codex（沙箱里，环境变量里只有每任务令牌）→ Engine 模型网关 `/llm/<令牌>/v1/responses` → 模型服务。网关换上真正的 key，把 `model` 改成设置里给“开发”阶段选的模型，转发流式响应，并从响应里读出用量计入任务成本。

模型用的是按规则回答的替身，所以这个 PoC 证明的是接线，不是模型效果。验证到的事：

- codex 用下面的参数能连上自定义的 Base URL，并执行模型要求的命令。
- 审查打回后，在同一个沙箱里 `codex exec resume --last` 能接着上一次的会话继续，提示从标准输入读。
- 网关记下了 codex 的用量；任务停止后同一个令牌被拒绝。

调用方式（`agent.rs`）：

```
codex exec [resume --last] --json --skip-git-repo-check \
  --dangerously-bypass-approvals-and-sandbox \        # 在 microVM 里；本地沙箱改用 -c sandbox_mode="workspace-write"
  -m <模型> -c model_provider=acw \
  -c 'model_providers.acw.base_url="<网关>/llm/<令牌>/v1"' \
  -c 'model_providers.acw.env_key="ACW_MODEL_KEY"' \
  -c 'model_providers.acw.wire_api="responses"' \
  -o ../io/last_message.txt - < ../io/prompt.md
```

## 2. codex 走哪种接口

只走 Responses。codex 0.169 的程序里写着：`wire_api = "chat"` is no longer supported，要求改成 `responses`。

实际发出的请求（抓包自 PoC）：`POST /responses`，`stream: true`，`store: false`；`input` 里是 developer 和 user 消息；`tools` 里有函数工具 `exec_command`、`write_stdin`、`request_user_input`、`view_image`、`get_goal` / `create_goal` / `update_goal`，一个 `namespace` 类型的 `multi_agent_v1`，和托管的 `web_search`。

对设计的影响：

- 给“开发”阶段用的接入要么自己支持 Responses 接口，要么由网关转换。
- 网关的转换已经写了（`gateway.rs` 的 `responses_to_chat` 和 `chat_to_sse`）：函数工具一一对应；`web_search` 和 `namespace` 工具被丢掉，因为 Chat Completions 服务跑不了它们；上游用非流式请求，再拼成 codex 能读的事件流。用真实 codex 对着替身的 Chat 接口跑通了：`ACW_CODEX_CHAT=1 ACW_CODEX_POC=1 cargo test -p acw-engine --test codex`。
- 转换没有在真实的 Chat 服务上跑过。已知的损失：推理模型的思考内容不会回传给 codex；codex 看不到逐字输出，只在一次请求结束时拿到结果。

**OrcaRouter 要确认的事**：它是否提供 `/v1/responses`。提供的话把接入的接口类型设成 Responses，请求原样转发，效果最好；不提供就设成 Chat Completions，走转换。

## 3. codex 的 `--json` 输出

每行一个 JSON。`item.completed` 里的 `command_execution`（命令、输出、退出码）、`file_change`、`agent_message` 被转成时间线上的步骤。codex 把一些警告（比如模型不在它的内置目录里）也作为 `error` 条目输出，这些按普通日志处理，只有 `turn.failed` 才算错误。

codex 不认识的模型名会提示 `Model metadata for … not found`，用后备的元数据继续跑。上下文窗口可能因此不准，长任务上要观察它的自动压缩是否正常。

## 4. 没有做的 PoC

- Firecracker 快照恢复耗时、暂停恢复：开发环境没有 KVM。
- Go 仓库用什么建符号索引：代码索引这一版没做。
- 云沙箱（E2B、Daytona）的快照和国内延迟：这一版没做云沙箱。
