---
description: "AlfredGo 插件：agent 经 AgentSecret 审批使用用户的凭据，模型只看到凭据引用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-alfredgo-secret-guard

[English](README.md) | 中文

## 概述

这个 AlfredGo 插件把 agent 接入 [AgentSecret](https://github.com/API4ward/AgentSecret)：凭据保存在审批端，每次使用前询问用户。插件加载期间，工具结果里出现的凭据在用户批准后以 `{{secretref:<别名>}}` 交给模型，未批准则扣留。`secret_write_file` 工具写入文件，批准后文件里的引用变成真实值。`secret_guard` MCP server 提供 AgentSecret 自己执行的操作；提到 AgentSecret 状态的工具调用会被拒绝。模型和会话日志里只有引用，没有凭据值。

## 目录

- [使用这个包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用这个包

### 准备 AgentSecret

在运行 AlfredGo 的机器上安装 AgentSecret，按它的[拆分部署说明](https://github.com/API4ward/AgentSecret/blob/main/docs/split-architecture.md)配对 relay、注入工具和审批端。凭据存在审批端，审批端保持运行，并在 AlfredGo 旁边用 `agentsecret injector serve` 启动注入工具。注入工具没有响应时插件拒绝加载。

### 加入 profile

```yaml
- id: alfredgo-secret-guard
  name: '@deepseek-ai/dsh-alfredgo-secret-guard'
  config:
    agentsecret: /opt/agentsecret/.venv/bin/agentsecret
    secretGuard: /opt/agentsecret/.venv/bin/secret-guard
    project: alfredgo
    tokenDir: /home/alice/.local/share/alfredgo/secret-guard
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `agentsecret` | 必填 | `agentsecret` 命令路径；插件加载时运行 `agentsecret injector task-create`，卸载时运行 `agentsecret injector revoke task` |
| `secretGuard` | 必填 | 运行 MCP bridge 的 `secret-guard` 命令路径 |
| `injectorUrl` | `http://127.0.0.1:8765` | 运行中的注入工具的 agent API 地址 |
| `injectorState` | `~/.local/share/agentsecret/injector` | 注入工具状态目录；作为 `--state` 传入，并对工具调用拒绝 |
| `project` | 必填 | task 的项目名；审批端的自动审批规则按它匹配 |
| `tokenDir` | 必填 | task token 文件所在目录，以 0700 权限创建，并对工具调用拒绝 |
| `approvalWaitMs` | `110000` | 一次审批最长等待时间，略短于 AgentSecret 请求的有效期 |
| `protect` | `[]` | 工具调用不得提到的其他路径 |

### 用户看到什么

工具结果中出现已保存的凭据时，审批端显示工具、目标和凭据别名，询问能否以引用形式交给 agent。每次 `secret_write_file` 调用显示目标文件，询问能否把引用换成凭据。回答方式、自动审批模式以及返回副本或 mock 值，都按审批端自己的设置。拒绝或无人应答的结果以扣留说明交给模型；被拒绝的写入直接失败，不改动文件。

### 可能出现的问题

- **注入工具停止**：所有文本结果都会被扣留，因为无法证明其中没有凭据；`secret_write_file` 失败。重新运行 `agentsecret injector serve`。
- **审批端没有运行**：审批约两分钟后过期，内容被扣留。
- **凭据被编码**：AgentSecret 只匹配原样字节；base64、URL 编码或拆开的值不会被替换。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节（点击展开）</summary>

[`src/index.ts`](src/index.ts) 先探测注入工具，再通过可信命令创建一个 task，从 `tokenDir` 下新建的文件读取 token；插件卸载时，一个 effect 撤销 task 并删除该文件。MCP manager 运行时，`ctx.inject(['mcpManager'])` 在插件生命周期内注册 `secret_guard` stdio server。指引通过一个 `interpolate: false` 的系统提示词段落加入，因为它包含字面的引用语法。

一个前置的 `tools/post-execute` 监听器能看到其他监听器给出的最终内容，它把文本块发给注入工具的 `/scan`（[`src/reveal.ts`](src/reveal.ts)）。命中时向 `/hook` 申请 `reveal` 审批并轮询 `/status`；批准后按 UTF-8 字节区间换成引用，未批准时含命中的文本换成扣留说明。插件自己的工具结果不扫描。一个 `tools/pre-execute` 监听器（[`src/protect.ts`](src/protect.ts)）拒绝参数字符串中含受保护路径或 AgentSecret 可信命令名的调用。

DHS 在执行前冻结并记录工具参数，监听器无法把引用填进其他工具的输入。所以由 [`src/write-tool.ts`](src/write-tool.ts) 负责填入：申请 `fill` 审批，通过 `/take` 一次性取回值，再经 `ctx.fs` 在 agent 的工作目录中写入。它的参数和结果只含引用。[`src/injector.ts`](src/injector.ts) 是 HTTP 客户端，拒绝重定向，并把注入工具不可达与请求被拒区分开。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [AlfredGo 包](../README.zh.md)：这个插件所属的分组。
- [工具管线](../../core/tools/README.zh.md)：`tools/pre-execute` 与 `tools/post-execute` 的语义。
- [MCP manager](../../mcp/mcp-manager/README.zh.md)：插件注册的 server 的生命周期。
- [AgentSecret 拆分部署](https://github.com/API4ward/AgentSecret/blob/main/docs/split-architecture.md)：审批端、relay、注入工具和审批协议。

-----

<a id="model-experience"></a>
## 模型体验

### 凭据指引

#### 模型看到的内容

插件加载期间，系统提示词在 MCP server 的位置包含下面的文字。

##### 指引文字

```markdown
The user's credentials are managed by AgentSecret, and the user approves each use on their approver. Text that held a credential reaches you with `{{secretref:<alias>}}` in its place. To put a credential into a file, call `secret_write_file` with the reference in `content`; the file receives the real value after approval. Use the `mcp__secret_guard__*` tools for operations AgentSecret performs itself. Never ask the user to paste a credential into the conversation.
```

#### Token 影响

插件加载期间，这段固定指引给每次请求增加约 100 个 token。

#### KV Cache 影响

指引在前缀中保持稳定，只在插件加载或卸载时变化。

### secret_write_file 工具

#### 模型看到的内容

工具 `secret_write_file`，参数为 `file_path` 和 `content`，描述为写入 UTF-8 文件、批准后其中的 `{{secretref:<alias>}}` 引用变成真实值。成功结果为 `Created <path> with the credentials for <aliases> filled in. Reading the file shows references again.`，文件已存在时为 `Updated`。

#### Token 影响

工具定义给每次请求增加约 120 个 token；每个结果是一句话。

#### KV Cache 影响

插件加载期间定义在前缀中保持稳定；结果追加在后面。

### 含凭据的工具结果

#### 模型看到的内容

含已批准凭据的文本块，每处凭据都换成 `{{secretref:<alias>}}`。凭据未放行的文本块换成 `[AgentSecret: this text contains a credential of the user and was withheld (<reason>). Do not try to read it another way.]`。提到 AgentSecret 状态的调用失败，返回 `AgentSecret: blocked (<what>). Credential state and task tokens are off limits to tools; use the mcp__secret_guard__* tools or secret_write_file instead. Do not retry with a different spelling.`

#### Token 影响

引用通常比它替换的凭据长几个 token；扣留说明替换整个文本块。

#### KV Cache 影响

替换发生在结果追加之前，不改变此前的请求 token。

### secret_guard MCP server

#### 模型看到的内容

MCP manager 运行时，AgentSecret server 的说明和 `mcp__secret_guard__*` 工具按 [MCP client](../../mcp/mcp-client/README.zh.md#model-experience) 所述出现。

#### Token 影响

工具集和说明由 AgentSecret 定义；撰写时提供三个工具。

#### KV Cache 影响

server 连接时其说明和工具出现，插件卸载时消失。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 只有 `secret_write_file` 会填入引用。shell 命令、浏览器表单等其他工具收到的是字面引用文本，因为 DHS 不允许监听器改写工具参数。
- 只扫描文本块。图片块、`meta` 展示数据和工具延后附加的上下文不扫描；下游监听器替换结果 `value` 的情况原样放过。`meta` 不会到达模型，但会存入会话日志并在客户端显示；例如 `read` 工具的行预览会保留模型看到的是引用的那个凭据。
- 工具的实时输出流（例如客户端里的 shell 输出）会在扫描之前把凭据显示给用户；模型看到的是扫描后的结果。
- 对 AgentSecret 状态的保护只匹配工具参数中的字符串。运行时拼出路径的进程，以及 agent 之外以同一系统用户运行的进程，都拦不住。
- 审批请求的摘要包含工具参数，由 relay 转发给审批端。
- 审批界面是 AgentSecret 自己的审批端；AlfredGo 客户端还不显示审批。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文（点击展开）</summary>

`tests/plugin.spec.ts` 在真实的工具管线和本地文件系统上运行插件，注入工具 agent API 和可信命令为测试替身。设计与关卡决定记录在 AlfredGo 看板卡片 AG-2 和 `alfredgo/designs/AG-2-secret-manager.md`。

</details>
