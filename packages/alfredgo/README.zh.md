---
description: "AlfredGo 分组：只属于 DeepSeek Harness 的 AlfredGo 版本、不改动上游文件的插件。"
kind: "package-group"
---

# alfredgo/ — AlfredGo 插件

[English](README.md) | 中文

## 概述

这个分组存放属于 AlfredGo（DeepSeek Harness 的特殊版本）而不属于上游的插件。每个包都挂在已有的扩展点上，因此同步上游时不会与它冲突。开发流程、看板和上游文件修改台账在仓库根目录的 `alfredgo/` 目录。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 作用 | ctx 键 |
|---|---|---|
| [`alfredgo-secret-guard/`](alfredgo-secret-guard/README.zh.md) | 把 agent 接入 AgentSecret：工具结果中的凭据经批准后变成引用，`secret_write_file` 把引用填入文件，`secret_guard` MCP server 提供 AgentSecret 自己的操作 | 注册到 `ctx.tools`、`ctx.systemPrompt` 和 `ctx.mcpManager` |
| [`alfredgo-secret-approver/`](alfredgo-secret-approver/README.zh.md) | 把客户端审批端的调用转发到 AgentSecret relay | 提供 Remote 命名空间 `secretApprover` |
| [`alfredgo-client-secret-approver/`](alfredgo-client-secret-approver/README.zh.md) | 让 DHS 客户端成为 AgentSecret 审批端：设备密钥、加密保存的密码、注入工具配对和审批卡片 | 注册到客户端 `settings.section` 和 `shell.overlay` 插槽 |

-----

<a id="related-documentation"></a>
## 相关文档

- [AlfredGo 开发流程](../../alfredgo/docs/development-process.md)：分支、上游同步和特性关卡。
- [工具管线](../core/tools/README.zh.md)：插件使用的执行前后扩展点。
- [凭据子系统参考](../../docs/subsystems/credentials.zh.md)：DHS 自身如何把密钥值挡在配置之外；AgentSecret 的凭据不经过它。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文（点击展开）</summary>

无。

</details>
