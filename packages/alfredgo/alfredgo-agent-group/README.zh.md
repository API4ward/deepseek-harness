---
description: "AlfredGo 组群：长期存在的 agent 由无环的隶属关系图连接，分派和汇报在它们的会话之间投递。"
kind: "package-reference"
---

# @deepseek-ai/dsh-alfredgo-agent-group

[English](README.md) | 中文

## 概述

这个 Host 服务保存 agent 组群。组群里有长期存在的成员，每个成员对应一个会话，成员之间有带方向的隶属关系。这些关系构成一张无环的图：一个成员可以有多个上级和多个下级。上级把任务分派给直接下级，下级向分派任务的那个上级汇报。服务保存组群、检查每次修改，并把分派和汇报作为消息投递到成员会话。[组群工具](../alfredgo-tool-agent-group/README.zh.md)让模型分派和汇报，[组群页面](../alfredgo-client-agent-group/README.zh.md)让用户编辑组群。

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

用 overlay 在 profile 中加载组群的三个包：

```yaml
- insert:
    - id: alfredgo-agent-group
      name: '@deepseek-ai/dsh-alfredgo-agent-group'
    - id: alfredgo-tool-agent-group
      name: '@deepseek-ai/dsh-alfredgo-tool-agent-group'
    - id: alfredgo-client-agent-group
      name: '@deepseek-ai/dsh-alfredgo-client-agent-group'
```

仓库把这几行放在 [`alfredgo/overlays/agent-group.overlay.yml`](../../../alfredgo/overlays/agent-group.overlay.yml)；`pnpm dsh web --patch alfredgo/overlays/agent-group.overlay.yml` 启动带组群的 Web 客户端。

### 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `maxMembersPerGroup` | `50` | 一个组群最多有多少成员。 |
| `maxOpenAssignmentsPerMember` | `20` | 一个成员最多有多少个还没汇报的任务；超过后再向它 `assign` 会被拒绝。 |
| `assignmentHistoryRecords` | `200` | 每个组群为活动列表保留多少条已汇报的任务。 |

### 成员

成员可以在组群里新建，也可以由已有会话加入。新建的成员在用户第一次打开它、或上级第一次给它分派任务时才创建会话；会话使用组群的工作目录和成员的 agent 预设。已有会话原样加入，保留自己的历史和工作目录。一个会话只能是一个组群的成员。已归档的会话和子 agent 的会话不能加入。

移除成员或删除组群后，会话保留为普通会话。重置成员会给它一个新的空会话，并清除它收到但还没汇报的任务。

### 隶属关系

`setEdges` 替换一个组群的全部关系。它拒绝成员指向自己的关系、指向未知成员的关系，以及任何含有循环的集合；拒绝信息会列出循环上的成员。请求带着编辑器读到的组群版本号，版本过期时以 `conflict` 拒绝。

### 分派与汇报

`assign(sessionId, to, task)` 只接受调用方成员的直接下级。它先保存任务，再把任务投递到下级的会话：会话正在运行一轮时作为引导消息加入，否则作为一条开启新一轮的消息。`report(sessionId, report, assignmentId?)` 用同样的方式把汇报投递给分派任务的上级，并把任务标记为已汇报。用户也可以直接在任何成员的会话里发消息。

### 服务 API

`ctx.agentGroups` 提供 `snapshot`、`watch`、`membershipOf`、`isMember`、`memberView`、`create`、`update`、`remove`、`addMember`、`attachSession`、`updateMember`、`removeMember`、`resetMemberSession`、`openMember`、`setEdges`、`assign` 和 `report`。被拒绝的调用抛出 `AgentGroupError`，代码见 [`src/types.ts`](src/types.ts)。Remote 命名空间 `agentGroups` 提供管理方法和 `watch` 流。在那里 `create`、`update`、`remove` 的名字是 `createGroup`、`updateGroup`、`removeGroup`，因为每个 Remote 命名空间都保留了 `remove`。拒绝以 `agent-group/refused` 和同一个代码到达客户端。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

[`src/index.ts`](src/index.ts) 是一个 `TypertRemoteService`。每次修改和投递都在同一条先进先出的队列上执行，所以两个上级同时给同一个下级分派时，任务按顺序保存和投递。组群和任务保存在存储域 `agent_group`（[`src/storage.ts`](src/storage.ts)）；组群每次修改都会让 `revision` 加一。[`src/graph.ts`](src/graph.ts) 是循环查找。`./client` 导出只有类型，因为浏览器包不能导入 Host 代码；组群页面自己做一次检查用于即时提示，最终由这个服务判定。

投递沿用 Schedule 服务的做法：服务通过 `sessionController` 找到成员的 Agent（新建成员在第一次使用时创建会话），追加一条 `source` 为 `{ kind: 'agent-group', form: 'relay', … }` 的用户消息，并等待会话日志落盘。已有会话加入或离开时会收到一条 `notice` 消息，让模型知道组群工具出现或消失。`watch` 在每次修改后给出完整快照，所以客户端不需要转发的 Host 事件。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [组群工具](../alfredgo-tool-agent-group/README.zh.md) — 面向模型的工具和指引。
- [组群页面](../alfredgo-client-agent-group/README.zh.md) — 设置页面和关系图编辑器。
- [Schedule 服务](../../schedule/schedule/README.zh.md) — 本服务沿用的投递方式。

-----

<a id="model-experience"></a>
## 模型体验

### 投递给下级的任务

#### 模型看到什么

下级的会话收到一条用户消息：`Your superior "<name>" in group "<group>" assigned you a task (assignment <id>).`，接着是 `You are member "<name>" of that group; your role: <role>`（成员没有职责时省略职责部分），再接着是 `When it is done or cannot be done, call group_report with assignment_id "<id>".`，一个空行，然后是上级写的任务内容。

#### Token 影响

每个任务一条消息，长度是任务内容加三行固定文字。它留在会话历史里。

#### KV Cache 影响

只追加：消息加在下级历史的末尾，不改动之前的内容。

### 投递给上级的汇报

#### 模型看到什么

上级的会话收到一条用户消息：`Your subordinate "<name>" in group "<group>" reported on assignment <id> (<summary>).`，一个空行，然后是汇报内容。

#### Token 影响

每次汇报一条消息，长度是汇报内容加一行固定文字。它留在会话历史里。

#### KV Cache 影响

只追加：消息加在上级历史的末尾，或作为引导消息加入正在运行的那一轮。

### 加入和离开的提示

#### 模型看到什么

已有会话加入组群时收到 `The user added this conversation to group "<group>" as member "<name>". Call group_members to see your superiors and subordinates.`。会话离开时收到 `The user removed this conversation from group "<group>". The group tools no longer apply here.`。这条消息加入历史，不开启新一轮。

#### Token 影响

每次加入或离开一条短消息。

#### KV Cache 影响

对历史是只追加。成员的工具列表和系统提示词同时通过[组群工具](../alfredgo-tool-agent-group/README.zh.md#model-experience)发生变化。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 汇报只发给分派任务的那个上级；这个成员的其他上级看不到。
- Web 会话里，分派和汇报显示为程序投递消息通用的折叠卡片，卡片上没有两个成员的名字。
- 成员的会话在组群页面之外被归档或删除后，它仍是成员；向它分派或汇报会以 `delivery-failed` 失败，错误信息告诉模型需要用户做什么。
- 任务没有截止时间，也不能取消；上级只能等汇报或再问一次。
- 组群只存在于一台 Host 上，不能导出或共享。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>给维护者的工作背景 — 点击展开</summary>

设计和评审决定记录在 `alfredgo/designs/AG-3-agent-group.md`。`tests/harness.ts` 用真实的 Session、Agent 和存储服务搭建本服务，存储用内存后端，`sessionController` 用替身。

</details>
