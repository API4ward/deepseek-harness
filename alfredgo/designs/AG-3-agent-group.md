# AG-3 组群：agents 的层级隶属关系

看板卡片：AG-3「组群：agents 的层级隶属关系（graph）」。本文是 G2 通过的设计（2026-11-28）在仓库内的记录；关卡结论以卡片为准。

## 背景与目标

Jian 的需求（2026-11-28）：给 DSH 增加组群功能，可以控制 agents 的层级结构，定义上下级的从属关系；类似 Claude 的 project，但成员之间不是平级的 threads，而是层级关系；在组群设置中可以看到、修改 agents 的隶属关系；这个关系是 graph，不是 tree。

DSH 现有的两种多 agent 组织方式都不满足：

| 现有机制 | 为什么不够 |
|:--|:--|
| 会话列表与 Workspace | 会话之间平级，没有关系 |
| 子 agent 树与 Team 模式 | 上下级由父 agent 在一次会话运行时临时创建，每个子 agent 只有一个创建者，是严格的树；`send_message` 只在同一棵树内有效；用户不能事先定义或修改结构 |

目标：用户建立一个持久的组群，往里放若干长期存在的 agent，在组群设置里查看和修改谁是谁的上级；上级 agent 能把任务分派给直接下级，下级向上级汇报；一个 agent 可以有多个上级。

## 关卡决定

| 关卡 | 日期 | 结论 |
|:--|:--|:--|
| G1 | 2026-11-28 | Jian 选定上下级的含义为“分派与汇报”：上级只能给直接下级派任务，下级向上级汇报，用户可以和任何成员直接对话 |
| G2 | 2026-11-28 | 通过，一处修改：支持把已有会话拉进组群作为成员。其余按设计：禁止成环、一期做完、组群设置为独立页面、汇报只回给派任务的上级 |

## 概念

| 概念 | 含义 |
|:--|:--|
| 组群 | 持久记录：名称、说明、工作目录、成员、隶属关系 |
| 成员 | 组群里一个长期存在的 agent：组内唯一的名称、职责说明、一个常驻会话。成员有两种来源：在组群里新建（选 agent preset，会话在首次使用时创建），或者把一个已有会话拉进来 |
| 隶属关系 | 有向边“上级 → 下级”。一个成员可以有多个上级和多个下级。整张图必须无环 |
| 分派记录 | 上级给下级派的一次任务：编号、双方、摘要、状态（进行中、已汇报） |

没有上级的成员是组群的入口，用户通常把任务交给它们；用户也可以直接打开任何成员的会话对话。

## 方案

三个新包，全部放在 `packages/alfredgo/`，只使用已有扩展点。整体做法与上游的 Schedule（`packages/schedule/`）和 Team（`packages/team/`）一致：Schedule 已经实现了“把一条指令送进另一个会话的 inbox，必要时先创建或恢复该会话”，Team 已经实现了“全局挂载、按会话条件启用的工具和提示”。

### 1. `alfredgo-agent-group`（Host，服务 `ctx.agentGroups`）

数据用 `ctx.storageDomain` 的 `agent-group` 域保存，随 Host 启动载入内存，写入在持久化后才返回。

```ts
type AgentGroupId = Branded<'AgentGroupId'>
type AgentGroupMemberId = Branded<'AgentGroupMemberId'>
type AgentGroupAssignmentId = Branded<'AgentGroupAssignmentId'>

interface AgentGroup {
  id: AgentGroupId
  title: string
  description: string
  cwd: string                      // 成员会话的工作目录
  members: AgentGroupMember[]
  edges: AgentGroupEdge[]
  revision: number                 // 每次修改加一，用于并发编辑检查
  createdAt: string
  updatedAt: string
}

interface AgentGroupMember {
  id: AgentGroupMemberId
  name: string                     // 组内唯一，模型用它指代成员
  role: string                     // 职责说明，模型和用户都能看到
  origin: 'created' | 'attached'   // 在组群里新建，或由已有会话加入
  agentPreset?: string             // 仅 created：不填时用 Host 默认 preset
  sessionId: SessionId             // created：添加时预留，首次使用时创建；attached：已有会话的 id
}

interface AgentGroupEdge {
  superior: AgentGroupMemberId
  subordinate: AgentGroupMemberId
}

interface AgentGroupAssignment {
  id: AgentGroupAssignmentId
  groupId: AgentGroupId
  from: AgentGroupMemberId
  to: AgentGroupMemberId
  summary: string
  status: 'open' | 'reported'
  createdAt: string
  reportedAt?: string
}
```

服务方法（同时通过 Remote 命名空间 `agentGroups` 提供给客户端）：

- 组群：`list`、`get`、`create`、`update`、`delete`。
- 成员：`addMember`（新建）、`attachSession`（把已有会话拉进来）、`updateMember`、`removeMember`、`resetMemberSession`（给成员换一个新的常驻会话，旧会话留在历史里）。
- 关系：`setEdges(groupId, edges, expectedRevision)`，整组替换。校验：两端都是本组成员、没有自环、没有重复边、整张图无环。成环时返回 `agent-group/cycle`，并带上构成环的成员路径，界面据此提示。`expectedRevision` 不一致时返回 `agent-group/conflict`。
- 运行时：`memberOfSession(sessionId)`、`assign(...)`、`report(...)`、`assignments(groupId)`。
- 事件：`agent-group/changed`，客户端据此刷新。

把已有会话拉进组群的规则：

- 可加入的会话与 Schedule 的投递目标同一标准：已存在、未归档、不是子 agent 的会话。检查只读会话头，不激活会话。
- 一个会话同一时间只能是一个组群的一个成员；已是成员的会话再次加入会返回 `agent-group/session-in-use`。
- 加入的会话保留自己的历史、工作目录和已记录的 preset，这些不随组群改变；成员的名称和职责在加入时填写。
- 加入和移出时各向该会话写入一条说明消息（不唤醒 agent），所以工具和提示从哪一步开始变化可以从会话日志看出来。
- 移出成员不删除会话，会话变回普通会话。

投递消息的方式与 Schedule 相同：用 `sessionController.resolveAgent(sessionId)` 取得或恢复目标成员的会话（尚未创建时按组群的 `cwd` 和成员的 preset 创建），目标正在运行时用 `steer`，空闲时用 `followup`，然后等待会话持久化确认。消息带来源标记：

```ts
interface AgentGroupMessageSource {
  kind: 'agent-group'
  form: 'relay'
  groupId: AgentGroupId
  assignmentId: AgentGroupAssignmentId
  direction: 'assign' | 'report'
  senderMemberId: AgentGroupMemberId
  senderSessionId: SessionId
}
```

来源通过 `MessageSourceMap` 的声明合并登记。消息作为普通的 inbox 用户消息写入目标会话的日志，所以满足“模型可见的内容都能从会话日志重建”，不需要新增会话事件类型，也不改会话格式版本。

配置项（可在 `cordis.yml` 修改）：`maxMembersPerGroup`（默认 50）、`maxOpenAssignmentsPerMember`（默认 20，超过后新的分派被拒绝并说明原因）、`assignmentHistoryRecords`（默认 200）。

### 2. `alfredgo-tool-agent-group`（Host，面向模型）

全局挂载一次，工具和提示只在“调用者的会话是某个组群的成员”时启用（与 `tool-agent-team` 的 `when` 条件写法相同），其他会话看不到任何变化。

| 工具 | 作用 |
|:--|:--|
| `group_members` | 返回组群说明、自己的名称和职责、直接上级和直接下级（名称、职责、是否在运行）、自己名下进行中的分派 |
| `group_assign` | 参数 `to`（直接下级的名称）、`task`。创建分派记录并把任务送进下级会话。返回分派编号和“已送达”，不等待结果。目标不是直接下级时返回错误，并列出当前的直接下级 |
| `group_report` | 参数 `report`，可选 `assignment_id`。把汇报送回派任务的上级，并把分派记为已汇报。只有一个进行中的分派时可省略编号；有多个时必须指明 |

系统提示只加一段固定文字：说明本会话是组群成员、上下级关系由用户定义、分派和汇报用哪几个工具、动手分派前先用 `group_members` 查看当前关系。上下级名单不写进系统提示，原因有两个：关系被修改后，下一次工具调用就按新关系执行，不存在提示过期的问题；系统提示保持不变，不影响 KV cache。

分派和汇报沿边的方向各走一步，图又是无环的，所以任务不会在成员之间无限转派。一个成员同时收到多个上级的任务时，按到达顺序进入 inbox，首期不做优先级。

### 3. `alfredgo-client-agent-group`（Client）

- **侧边栏入口**（`sidebar.panellist`）：“组群”，点开后在主区域（`main`）显示组群页面。
- **组群列表**：新建、重命名、删除组群。
- **组群设置**，分三个页签：
  - **成员**：新建成员（名称、职责、preset），或从会话列表里选一个已有会话加入（填名称和职责）；编辑、移除成员，打开成员的会话，重置成员会话。会话侧边栏的行菜单里也有“加入组群”。
  - **隶属关系**：分层有向图，上级在上、下级在下，有多个上级的成员会有多条连线。两种等价的编辑方式：在图上从一个成员拖线到另一个成员来加边，点连线删除；或者选中一个成员，在侧栏用“上级”“下级”两个多选框修改。保存时如果会成环，高亮构成环的成员并拒绝保存。
  - **活动**：分派记录列表（谁派给谁、摘要、状态、时间），点一条跳到对应会话。
- **会话侧边栏标记**（`sidebar.session.row.leading`）：成员会话显示组群标记，悬停显示所属组群和上下级。
- **会话内**：带 `agent-group` 来源的消息显示为“来自上级 X 的分派”或“来自下级 Y 的汇报”，而不是普通用户消息。

关系图用 SVG 自己画，布局用最长路径分层。成员上限是几十个，这个规模不需要引入图布局依赖。界面文字走 typed locale 字典，中英文各一份。

## 与 DSH 现有机制的关系

- 不改子 agent 树和 Team。成员仍然可以在自己的会话里创建临时子 agent；组群关系是另一层由用户定义的持久关系。
- 成员的工具与人设复用 agent preset 和 persona，不另造一套。
- 成员会话就是普通会话：出现在会话列表里，可以归档、搜索、导出。归档成员会话后，向它分派会失败并提示用户恢复或重置该成员的会话。

## 对上游文件的改动

与 AG-2 同类，实现时逐项登记到 [PATCHES.md](../PATCHES.md)：`tsconfig.host.json` 和 `tsconfig.client.json` 的项目引用；`scripts/gen-cordis-catalog.ts`、`scripts/gen-doc-graphs.ts`、`scripts/product-package-policy.ts` 里的登记表；生成器产出的目录文件。不修改任何上游包的源码。启用方式是一个叠加配置（bundle patch），不改默认 profile。

## 测试计划

- **单元测试**（Host）：已有会话加入（归档、子 agent、已是成员的会话被拒绝；移出后变回普通会话）；图校验（自环、重复边、成环并返回环路径、多上级合法）；并发编辑冲突；分派只允许直接下级；汇报的默认目标与多分派时必须指明编号；进行中分派数上限；删除成员和删边时对进行中分派的处理；重启后记录仍在。
- **单元测试**（工具）：非成员会话看不到工具和提示；三个工具的参数校验和错误信息。
- **客户端测试**（`.client.spec.ts`）：分层布局；加边、删边；成环时的提示；多选框和图两种编辑方式结果一致。
- **会话快照**：一段录制的会话，上级调用 `group_assign`，下级会话收到分派并调用 `group_report`，上级会话收到汇报。
- **真实模型联调**（DeepSeek，云端环境）：三层、带一个双上级成员的组群，从入口成员下达任务，检查分派和汇报是否按关系走完。
- **界面录屏**：按仓库规定，改动用户可见界面的 PR 附一段真实运行的 GIF。

## 验收标准（G4）

1. 能创建组群，添加至少 4 个成员，其中至少一个是拉进来的已有会话，在组群设置的“隶属关系”里看到关系图。
2. 能给一个成员设置两个上级；保存并重启后关系仍在。
3. 试图形成环时保存被拒绝，界面指出构成环的成员。
4. 给入口成员一个任务，它能派给直接下级，下级的汇报回到它的会话；向非直接下级分派被拒绝，并提示当前的直接下级。
5. 在设置里修改隶属关系后，成员下一次查看或分派时按新关系执行，不需要重启或新开会话。
6. 不属于任何组群的会话，工具和系统提示没有任何变化。

## 首期不做

- 上下文继承和权限继承（G1 已排除）。
- 同级成员之间直接发消息；需要协作时经共同上级。
- 分派的优先级、截止时间、撤回。
- 跨设备或多人共享组群。
- 一个会话同时加入多个组群。

## 对后续上游同步的影响

新增代码都在 `packages/alfredgo/` 下，不与上游文件冲突。依赖的上游接口是 `sessionController.resolveAgent`、`agent.followup` 与 `agent.steer`、`storageDomain`、`MessageSourceMap`、工具的 `when` 条件，以及客户端的 `sidebar.panellist`、`main`、`sidebar.session.row.leading` 插槽。上游这些接口还未稳定，同步时如有改名，在同步 PR 内跟着改。
