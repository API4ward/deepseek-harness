---
description: "AlfredGo 组群工具：组群成员查看自己的隶属关系，给直接下级分派任务，并向分派任务的上级汇报。"
kind: "package-reference"
---

# @deepseek-ai/dsh-alfredgo-tool-agent-group

[English](README.md) | 中文

## 概述

这个插件把[组群](../alfredgo-agent-group/README.zh.md)的工具交给模型。在属于某个组群的会话里，模型可以用 `group_members` 查看自己的位置，用 `group_assign` 给直接下级分派任务，用 `group_report` 回复一项分派。系统提示里有一段说明介绍组群。不是成员的会话既看不到工具，也看不到说明。

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

和组群服务一起加载；它没有配置项：

```yaml
- insert:
    - id: alfredgo-agent-group
      name: '@deepseek-ai/dsh-alfredgo-agent-group'
    - id: alfredgo-tool-agent-group
      name: '@deepseek-ai/dsh-alfredgo-tool-agent-group'
```

| 工具 | 参数 | 结果 |
|---|---|---|
| `group_members` | 无 | JSON，包含 `group`、`description`、`name`、`role`、`superiors`、`subordinates`、`received` 和 `given`。每个相邻成员有 `name`、`role` 和 `running`；每项未完成的分派有 `id`、`member` 和 `summary`。 |
| `group_assign` | `to`、`task` | 任务送达下级会话后返回 `{"assignment_id":"<id>","delivered":true}`。 |
| `group_report` | `report`，可选 `assignment_id` | 汇报送达上级会话后返回 `{"assignment_id":"<id>","delivered":true}`。 |

被拒绝的调用以组群服务的消息失败，消息会说明下一步怎么做：例如分派给不是直接下级的成员时，消息列出调用者的下级；有多项未完成的分派却没给 `assignment_id` 时，消息列出这些 id。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节（点击展开）</summary>

[`src/index.ts`](src/index.ts) 注册一段系统提示和三个工具。每个注册都带条件 `ctx.agentGroups.isMember(agent.id)`，所以每次请求按成员身份决定模型能否看到它们；会话在两次请求之间退出组群后，这个条件也会拒绝它的调用。工具把调用会话的 id 传给 `ctx.agentGroups`，隶属关系由服务自己检查。这段系统提示排在团队策略之后一位。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [组群服务](../alfredgo-agent-group/README.zh.md)：分派和汇报的规则，以及它们投递的消息。
- [组群页面](../alfredgo-client-agent-group/README.zh.md)：用户编辑成员和隶属关系的地方。
- [工具管线](../../core/tools/README.zh.md)：带条件的工具注册。

-----

<a id="model-experience"></a>
## 模型体验

### 组群说明

#### 模型看到的内容

会话是组群成员期间，系统提示在团队策略位置之后包含下面的文本。

##### 说明文本

```markdown
This conversation is a member of an agent group that the user set up.

Members are long-lived agents joined by reporting lines the user defines and may change at any time. A member can have several superiors and several subordinates. Call group_members to see your role, your direct superiors, your direct subordinates, and your open assignments; call it again before assigning, because the lines may have changed.

Use group_assign to give a task to one of your direct subordinates. The call returns when the task reached that member, not when it is done; the member's report arrives later as a message in this conversation. Write each task so it can be done without this conversation's history. Do work yourself when no subordinate's role fits it.

When a superior assigns you a task, do it, then call group_report with the outcome: what you did, what you found, and anything left open. Report failure the same way. You cannot assign to or report to members that are not your direct subordinates or superiors.
```

#### Token 影响

固定的说明给成员会话的每次请求增加约 230 个 token，对其他会话没有影响。

#### KV Cache 影响

成员身份不变时，说明是稳定前缀。加入或退出组群会添加或移除它，使该会话的系统提示变化一次。

### 组群工具

#### 模型看到的内容

会话是组群成员期间，工具列表包含 `group_members`（无参数）、`group_assign`（`to`、`task`）和 `group_report`（`report`，可选 `assignment_id`），结果见上表。隶属关系不写在提示里；模型通过 `group_members` 读取，结果反映调用时的关系。

#### Token 影响

三个工具定义给成员会话的每次请求增加约 300 个 token。`group_members` 的结果随直接相邻成员和未完成分派的数量增长；另外两个结果是一个很短的 JSON 对象。

#### KV Cache 影响

成员身份不变时，工具定义是稳定前缀；加入或退出会使该会话的工具列表变化一次。修改隶属关系既不改变提示，也不改变工具列表。结果只追加。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 成员看不到直接上级和直接下级以外的成员，所以它没法按名字请用户给某个较远的成员加一条关系。
- `group_assign` 不等待汇报。上级如果在同一轮里需要结果，只能先结束这一轮，等汇报消息到达后继续。
- 成员启动的子 agent 得不到这些工具；只有成员自己的会话能分派和汇报。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文（点击展开）</summary>

`tests/tools.spec.ts` 让工具在真实的 agent 循环里运行，模型回复按脚本给出，组群服务是真实的。`tests/loader-composition.spec.ts` 通过 Loader 从 `cordis.yml` 启动组群服务和工具。

</details>
