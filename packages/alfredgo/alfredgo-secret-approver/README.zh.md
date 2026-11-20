---
description: "DHS Host 上的 AlfredGo relay 转发：把浏览器审批端的调用送到 AgentSecret relay。"
kind: "package-reference"
---

# @deepseek-ai/dsh-alfredgo-secret-approver

[English](README.md) | 中文

## 概述

这个 Host 插件把 DHS 客户端里的[密码审批端](../alfredgo-client-secret-approver/README.zh.md)转发到 [AgentSecret](https://github.com/API4ward/AgentSecret) relay。relay 只接受同源的浏览器请求，客户端无法直接调用它；因此由 Host 上的 Remote 命名空间 `secretApprover` 代为发出每次调用。请求和响应原样传递：其中只有签名文本和密封数据，从不含明文密码。

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

与客户端包一起加载，并设置 relay 地址：

```yaml
- insert:
    - id: alfredgo-secret-approver
      name: '@deepseek-ai/dsh-alfredgo-secret-approver'
      config:
        relayUrl: http://127.0.0.1:8780
    - id: alfredgo-client-secret-approver
      name: '@deepseek-ai/dsh-alfredgo-client-secret-approver'
```

`relayUrl` 是 `agentsecret relay serve` 打印的地址，默认 `http://127.0.0.1:8780`。relay 不可达或返回的不是 JSON 时，设置页提示 relay 无法连接。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节（点击展开）</summary>

[`src/index.ts`](src/index.ts) 是一个有两个方法的 `TypertRemoteService`。`info()` 返回配置的 relay 地址。`relay(call)` 只接受审批端路由（`/device/challenge`、`/device/login`、`/approver/rules`、`/approver/pending`、`/approver/decision`）和不超过 1 MiB 的请求体，以 JSON 发送请求体并附上可选的 bearer token，拒绝重定向，返回 relay 的状态码和响应文本。路由或请求体被拒时以 `gateway/bad-request` 失败；网络错误或非 JSON 响应以 `secret-approver/relay-unreachable` 失败。会话 token 和请求体不写入日志。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [密码审批端](../alfredgo-client-secret-approver/README.zh.md)：客户端部分。
- [AgentSecret 分离部署](https://github.com/API4ward/AgentSecret/blob/main/docs/split-architecture.md)：relay 路由和审批协议。

-----

<a id="model-experience"></a>
## 模型体验

无，转发只服务客户端，不向模型请求添加任何内容。

#### KV Cache 影响

无直接影响。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 每个 DHS Host 只连一个 relay，地址由配置固定。
- relay 使用 AgentSecret 的 Python relay；DHS 内置 relay 延后。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文（点击展开）</summary>

`tests/forwarder.spec.ts` 用假的 `fetch` 覆盖路由白名单、请求体上限、bearer 转发，以及 relay 不可达或返回非 JSON 的情况。设计记录在 `alfredgo/designs/AG-2-secret-manager.md`（设计 v3）。

</details>
