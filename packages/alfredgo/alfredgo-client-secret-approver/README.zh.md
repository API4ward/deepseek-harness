---
description: "DHS 客户端里的 AlfredGo 密码审批端：设备密钥、加密保存的密码、注入工具配对和 AgentSecret 审批卡片。"
kind: "package-reference"
---

# @deepseek-ai/dsh-alfredgo-client-secret-approver

[English](README.md) | 中文

## 概述

这个浏览器插件让 DHS 客户端成为 [AgentSecret](https://github.com/API4ward/AgentSecret) 的审批端。用户的密码保存在这个浏览器里，用不可导出的密钥加密；agent 每次使用前都询问用户。有待审批请求时，审批卡片浮在 DHS 界面上；设置里的**密码审批**页面管理设备、relay 连接、已配对的注入工具、密码和审批模式。它对 relay 的调用经 [relay 转发](../alfredgo-secret-approver/README.zh.md)送达。向 agent 注入是另一个可选插件 [secret-guard](../alfredgo-secret-guard/README.zh.md)。

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

用 overlay 在 profile 中加载两个包：

```yaml
- insert:
    - id: alfredgo-secret-approver
      name: '@deepseek-ai/dsh-alfredgo-secret-approver'
      config:
        relayUrl: http://127.0.0.1:8780
    - id: alfredgo-client-secret-approver
      name: '@deepseek-ai/dsh-alfredgo-client-secret-approver'
```

然后打开**设置 › 密码审批**：

1. 填 AgentSecret 用户名并生成设备密钥。注入工具只与同一用户的设备配对。
2. 复制页面上的命令，在 relay 和注入工具上登记本设备（`agentsecret relay device-register`、`agentsecret injector pair-approver`），然后连接。
3. 粘贴注入工具的配对信息（`agentsecret injector pairing`）并配对。
4. 保存密码。每次保存都会下发匹配器，注入工具凭它识别密码，但拿不到密码本身。

DHS 开着并已连接时，客户端每两秒取一次待审批请求。卡片显示项目、密码、工具、目标和操作，按钮为**拒绝**、**允许（1 次）**和**其他…**（允许 3 次、10 次，或 3 分钟、10 分钟、1 小时）。fill 和 MCP 使用请求可以选择返回保存的密码、同名副本、形状相同的 mock 值或手动输入的值。本设备永远不能批准的请求（如未知别名、未配对的注入工具）立即以签名的原因拒绝。全部同意模式和自动审批规则（类型、别名、工具、目标的通配）替用户作答，每个回答仍单独签名。

**设置 › 审批记录**按时间倒序列出这个浏览器里的每次作答：人工、全部同意模式、多次或限时允许、自动规则和自动拒绝。每条记录包含结果、方式、项目、任务、注入工具、别名、工具、目标、操作、返回值类型（保存的密码、副本、mock 或手动输入）、同时授权的次数或时长，以及签名的请求文本；从不包含密码或手动输入的内容。页面对别名、项目和工具做模糊搜索，对目标和操作做子串搜索，可按结果和方式筛选，可把匹配的记录导出为 JSON，也可清空。最多保留最新的 2000 条。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节（点击展开）</summary>

[`src/client/approver.ts`](src/client/approver.ts) 移植自 AgentSecret 的 `web/approver.js`；[`src/client/crypto.ts`](src/client/crypto.ts) 是 WebCrypto 原语（ECDSA P-256 签名，HKDF-SHA256 加 AES-256-GCM 的 ECIES 密封，PBKDF2 匹配器），与 AgentSecret 的 `seal.py`、`matcher.py` 一致。签名文本使用前缀 `secret-guard/request/v1:`、`secret-guard/decision/v3:` 和 `secret-guard/rules/v1:`。密封的值绑定请求文本的 SHA-256，只发给配对时记录的加密公钥，从不用 relay 提供的密钥。

[`src/client/store.ts`](src/client/store.ts) 把设备、密码、注入工具、模式和审批记录存在 IndexedDB 数据库 `alfredgo-secret-approver` 中（版本 2 新增 `history` 存储），与 AgentSecret 自己的页面分开。[`src/client/index.ts`](src/client/index.ts) 挂载转发器的 Remote 命名空间，注册两个 `settings.section` 页面和 `shell.overlay` 卡片，并管理轮询定时器。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [relay 转发](../alfredgo-secret-approver/README.zh.md)：Host 端。
- [secret-guard](../alfredgo-secret-guard/README.zh.md)：可选的 reveal、`secret_write_file` 和 MCP。
- [AgentSecret 拆分部署](https://github.com/API4ward/AgentSecret/blob/main/docs/split-architecture.md)：审批端、relay、注入工具和审批协议。

-----

<a id="model-experience"></a>
## 模型体验

无，审批端运行在浏览器中，不向模型请求添加任何内容。

#### KV Cache 影响

没有直接影响。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 密码只在这个浏览器配置中。清除站点数据会丢失密码；没有备份和恢复，每次批准也没有生物识别确认。
- 请求靠轮询获取，所以审批和审批模式只在 DHS 开着时生效。
- 设置页检测不到 `agentsecret injector pair-approver` 和 `injector serve`，只显示命令。
- `src/client/store.ts` 的 IndexedDB 访问和 React 视图还没有单元测试覆盖。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文（点击展开）</summary>

`tests/approver.client.spec.ts` 让审批端对接测试替身 relay 和注入工具，替身校验每个签名并打开每个密封包。设计记录在 `alfredgo/designs/AG-2-secret-manager.md`（设计 v3）。

</details>
