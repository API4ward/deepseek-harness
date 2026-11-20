# AG-2 接入 Secret Manager（AgentSecret）

看板卡片：AG-2「接入 Secret Manager，支持密码管理」。本文是 G2 通过的设计（2026-11-20）在仓库内的记录；关卡结论以卡片为准。

## 背景与目标

Secret Manager 指 [API4ward/AgentSecret](https://github.com/API4ward/AgentSecret)。它的拆分部署有三部分：审批端保存密码明文并做人工审批；relay 只转发签名请求和密封包，可放在云端；注入工具与 agent 在同一台机器，提供 MCP 用的 agent API 和 `/scan`、`/hook`、`/take` 三个供 hook 使用的接口。

目标：AlfredGo 的 agent 能使用用户的密码，而**密码不进入 LLM**。密码出现在用户自己看到的界面里（例如 shell 实时输出）不算风险（Jian，2026-11-20）。

## 关卡决定

| 关卡 | 日期 | 结论 |
|:--|:--|:--|
| G1 | 2026-11-19 | 用 AgentSecret 管理密码；AlfredGo 连接审批端，并作为被注入的 agent；不做容器隔离 |
| G2 | 2026-11-20 | 首期做 reveal（检出密码换成引用）和配置文件 fill；fill 由 AlfredGo 自带的工具完成；审批端首期嵌入 AgentSecret 浏览器审批页；首期不做邮件和 IM |

## 方案

新包 `packages/alfredgo/alfredgo-secret-guard`（`@deepseek-ai/dsh-alfredgo-secret-guard`），只用已有扩展点：

1. 加载时探测注入工具，调用可信命令 `agentsecret injector task-create` 创建 task；卸载时 `revoke task` 并删除 token 文件。
2. 有 MCP manager 时注册 `secret_guard` stdio server（`secret-guard mcp --url … --token-file …`）。
3. `tools/post-execute`：把工具结果的文本块交给 `/scan`，命中则申请 `reveal` 审批；批准后换成 `{{secretref:<别名>}}`，否则换成扣留说明。扫描失败时扣留全部文本。
4. `tools/pre-execute`：参数中含注入工具状态目录、token 目录或可信命令名的调用直接拒绝。
5. `secret_write_file` 工具：内容中的引用经 `fill` 审批后，通过 `/take` 取值，用 `ctx.fs` 写入；参数、日志和结果只有引用。

### 为什么不复用 AgentSecret 的 Claude Code hook

DHS 的 `dsh-hooks-claude-code` 不支持 `updatedToolOutput`，并把 `updatedInput` 写进日志而不执行，直接套用会把明文写入会话日志。DHS 在执行前冻结并记录工具参数（上游提案 pre-tool-input-rewrite 仍是 proposed），所以通用 fill 做不到，改由 AlfredGo 自己的工具负责。

## 对上游文件的改动

见 [PATCHES.md](../PATCHES.md)：`tsconfig.host.json` 加一行项目引用；`tsconfig.base.json`、`pnpm-lock.yaml` 及生成的目录文件由生成器更新。

## 测试

- 单元测试 `packages/alfredgo/alfredgo-secret-guard/tests/plugin.spec.ts`（11 项）：真实工具管线和本地文件系统，注入工具与可信命令为测试替身。
- 本机联调（未纳入自动测试）：真实的 relay、注入工具和终端审批端，测试密码 `test_passwd`。读文件时换成引用，`secret_write_file` 写入真值，读回又是引用，读取注入工具状态目录被拒。
- 真实模型（DeepSeek，headless profile）：读含密码的文件，模型只看到引用；写配置文件，文件得到真值；会话日志中模型可见的内容只有引用。`read` 工具的展示元数据（`meta`）保留了明文，它不发给模型，但存入会话日志。

## 验收标准（G4）

1. agent 读到含测试密码的文件时出现审批；批准后 agent 看到的是引用，发给模型的内容中没有明文。
2. agent 用 `secret_write_file` 写配置文件时出现审批；批准后文件里是真实值，模型只看到引用。
3. agent 能通过 MCP 申请引用并完成一次使用（假 GitHub）。
4. 注入工具未运行时，AlfredGo 启动报出明确原因。
5. 退出后 task 被撤销。

## 后续

- 第二个 PR：AlfredGo 客户端的审批面板（嵌入 AgentSecret 浏览器审批页）。
- 二期：原生审批卡片、网站登录（浏览器工具 fill）。
