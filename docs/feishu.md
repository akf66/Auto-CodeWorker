# 飞书

两条路，互不依赖：

- **出站通知**：群自定义机器人的 webhook（`FEISHU_WEBHOOK`）。需要人处理的事发到群里。v0.1 就有。
- **入站消息**：自建应用的事件订阅。在飞书里给机器人发消息（私聊，或者在群里 @ 它），等同于在控制台的“对话”里发；Router 的回复作为对那条消息的回复发回去。v0.2 新增。

## 协议核对过文档，还没接过真实应用

入站部分最初是凭记忆写的。2026-11-14 逐条对过飞书开放平台的文档和官方 SDK（`larksuite/oapi-sdk-go`、`oapi-sdk-python`）的源码，结论如下。还没有用真实的飞书应用走过一遍，第一次接的时候按“验证过什么”一节后面的清单试。

| 代码里的做法 | 在哪里 | 核对结果 |
| --- | --- | --- |
| 配了 Encrypt Key 时，请求体是 `{"encrypt": "<base64>"}`；解密是 AES-256-CBC，密钥是 Encrypt Key 的 SHA-256，密文解码后前 16 字节是 IV，PKCS7 填充 | `feishu.rs` 的 `decrypt` | 一致 |
| 签名在请求头 `X-Lark-Signature`，值是 `sha256(时间戳 + 随机串 + Encrypt Key + 原始请求体)` 的小写十六进制（不是 HMAC）；时间戳和随机串在 `X-Lark-Request-Timestamp`、`X-Lark-Request-Nonce` | `signature`、`http.rs` 的 `feishu_webhook` | 一致 |
| 地址校验请求解密后是 `{"type": "url_verification", "challenge": "…", "token": "…"}`，应答 `{"challenge": "…"}` | `feishu_event` | 一致。文档要求 1 秒内应答 |
| 地址校验请求没带签名头时，只按校验令牌判断 | `feishu_event` | 文档没说这种请求带不带签名；官方 SDK 对它也不验签、只比对令牌，做法相同 |
| 事件是 2.0 格式：`header.event_id`、`header.event_type`、`header.token`；消息事件的类型是 `im.message.receive_v1` | `parse_message` | 一致 |
| 消息在 `event.message`：`message_id`、`root_id`、`chat_id`、`chat_type`（`group` 或 `p2p`）、`message_type`、`content`（一个 JSON 字符串，文字消息是 `{"text": "…"}`）、`mentions[].key` 和 `mentions[].name`；发送人在 `event.sender.sender_id.open_id` | `parse_message` | 一致。@ 在文字里是 `@_user_1` 这样的占位符，对应 `mentions[].key`；`root_id` 只在回复里有 |
| 取应用令牌：`POST /open-apis/auth/v3/tenant_access_token/internal`，请求 `{app_id, app_secret}`，返回 `{code: 0, tenant_access_token, expire}` | `feishu_tenant_token` | 一致。返回值是平铺的，没有 `data` 一层 |
| 回复：`POST /open-apis/im/v1/messages/{message_id}/reply`，带 `Authorization: Bearer <应用令牌>`，请求 `{"msg_type": "text", "content": "{\"text\": \"…\"}"}`，返回 `{code: 0}` | `feishu_reply` | 一致 |
| 重发的事件按消息编号去重 | `feishu_event` | **改过**：原来按 `event_id`，消息事件的文档写明要用 `message_id` 去重，不要依赖 `event_id` |
| 出站通知：群自定义机器人 webhook，请求 `{"msg_type": "text", "content": {"text": "…"}}` | `background.rs` | 一致。成功时返回里 `code` 为 0 |

## 配置

```toml
[feishu]
webhook_env = "FEISHU_WEBHOOK"            # 出站：群机器人的 webhook
base = "https://open.feishu.cn"           # Lark 租户用 https://open.larksuite.com
app_id_env = "FEISHU_APP_ID"              # 入站：自建应用
app_secret_env = "FEISHU_APP_SECRET"
verify_token_env = "FEISHU_VERIFY_TOKEN"  # 事件订阅页上的 Verification Token
encrypt_key_env = "FEISHU_ENCRYPT_KEY"    # 事件订阅页上的 Encrypt Key，建议配
bot_name = "Auto-CodWorker"               # 机器人的显示名。配了以后，群里只有 @ 这个名字才算
```

校验令牌和加密密钥都没配时，`/webhooks/feishu` 拒绝一切请求。

在飞书开放平台上：建自建应用，开机器人能力；事件订阅的请求地址填 `https://<你的域名>/webhooks/feishu`，订阅“接收消息”事件；权限要有读取发给机器人的消息、以应用身份回复消息。

## 谁是谁

- 发送人按 `open_id` 对成员：在“成员与权限”里填成员的飞书 open_id。对不上的人按访客处理：只回答，不开任务。
- 群按 `chat_id` 对项目：把 chat_id 写进项目卡的 `channels`，这个群里的消息不写项目名也会归到这个项目。
- 同一个话题（回复链）里的消息算一个对话。

## 行为

- 飞书在 3 秒内收不到应答会重发事件（15 秒、5 分钟、1 小时、6 小时后各一次）。Engine 先应答再处理，并按 `message_id` 去重（记两天）。
- 只处理文字消息。图片、文件、卡片不处理，也不回复。
- 群里没有 @ 机器人的消息不处理。
- 回复发送失败会记在“通知”页里（类别 `feishu-reply`，没有发送）。
- 验签或校验令牌不对的请求返回 401，记进安全日志。

## 验证过什么

`crates/acw-engine/tests/feishu.rs`：对着一个本地的假平台（按上表实现的）：地址校验；令牌不对、签名不对、该加密没加密都被拒并记日志；成员在绑定了项目的群里 @ 机器人开出任务并收到回复；同一事件重发不会开第二个任务；不是成员的人私聊只得到回答；群里没 @ 的消息被忽略。

第一次接真实应用时要试的：事件订阅页上的地址校验能通过；配了 Encrypt Key 的事件能解开；群里 @ 机器人能开出任务并收到回复；私聊能得到回答；群机器人 webhook 的通知格式和 @ 符合预期。
