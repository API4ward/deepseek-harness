# Agent Teams

[English](agent-team.md) | 中文

共享任务板、模型工具和 host 适配器共享的类型。[任务板等待决策](../../.agents/notes/implemented/architecture/2026-10-19-team-task-board-inbox.zh.md)负责协调语义；本页记录 [`packages/team/agent-team/src/types.ts`](../../packages/team/agent-team/src/types.ts) 中的持久化和客户端可见形式。

## 身份与历史名册

`TeamId` 品牌化根 `SessionId`；`TeamTaskId` 使用 `task-<n>`。`TeamMessageId` 和名册记录为历史解码保留。subagent 运行时解析树，并发现任意深度的有效任务所有者；历史名册条目不授予权限。

```ts type-equiv
/** Historical roster value written by earlier Team builds on every teammate lifecycle change. */
interface TeamMemberSnapshot {
  readonly id: SessionId
  readonly name: string
  readonly description: string
  readonly provider: string
  readonly context: 'fresh' | 'fork'
  readonly phase: TeamMemberPhase
  readonly error?: string
}
```

历史记录保留其记录的 `provisioning`、`active` 或 `failed` 阶段。当前轮次活动属于普通 subagent 发现和 Session 状态，与任务完成相互独立。

## 消息与历史 mailbox

成员交换普通 [subagent 消息](subagent.zh.md)，保留真实发送方 Session id。任务变更不会结束收件箱等待、添加收件箱消息或启动空闲 agent。需要 agent 处理任务更新时，发送明确消息。下列历史邮箱类型保持可读；Team 绝不投递其待处理记录。

```ts type-equiv
/** One peer message recorded by the historical Team mailbox. */
interface TeamMessageSnapshot {
  readonly id: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
  readonly targetId: SessionId
  readonly content: ContentBlock[]
}
```

历史 `team-message` source 保留旧消息 id 与发送者归属；客户端用它们展示消息标题和图标。

```ts type-equiv
/** Source recorded by a target Session for one historical Team mailbox delivery. */
interface TeamMessageSource {
  readonly kind: 'team-message'
  readonly teamId: TeamId
  readonly messageId: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
}
```

## 共享任务 DAG

每条 task event 都存储完整快照。`revision` 是 compare-and-set 值，每次变更递增 1。`blockedBy` edge 必须指向未删除任务，并维持无环图。`writeScopes` 是规范化的提示性路径前缀，不是锁。

```ts type-equiv
/** Whole durable task snapshot; every mutation increments {@link revision}. */
interface TeamTaskSnapshot {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly ownerId?: SessionId
  /** Immutable agent path captured at assignment; absent on unnamed historical owners. */
  readonly ownerName?: string
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
}
```

`pending` 表示未开始或已释放，`in_progress` 携带负责人，`completed` 满足依赖，`deleted` 是保留的墓碑记录。视图提供 `ownerId`、就绪性和写入范围重叠提示，不改变持久快照。

<a id="web-projection"></a>

## Web 投影

`agentTeam.enabled` 提供根 Session 保存的选择。新 Session 默认为 false；`team/mode` 记录显式选择。历史任务在显式选择前视为开启。仅根可调用 `setEnabled`；后代共享该模式。Web 菜单通过 `remote.agentTeams.setEnabled` 调用同一方法，Gateway 将根 Session id 解析为其存活 Agent。模式写入先立即生效，再等待刷盘。工具在步骤准备时确定可用性；提示词提供方在求值时读取选择。任务修改在排队操作开始时检查当前模式；已获准的修改可继续完成。模式变更不会结束收件箱等待。刷盘失败时已追加的选择仍然生效；重试相同选择会再次刷盘，不重复追加事件。

根 Session 通过 `SessionProjectionMap.agentTeam` 发布未删除任务视图。`failure` 在最后有效状态旁报告被拒绝的持久化任务或模式记录。历史名册与邮箱记录不参与投影。视图以 Session id 标识每个负责人；任务面板和任务工具显示负责人的 agent 名称，负责人没有名称时显示其 Session id。

```ts type-equiv
/** Runtime-enriched task view returned to tools and hosts. */
interface TeamTaskView {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
  readonly ownerId?: SessionId
  /** Immutable agent path captured at assignment; absent on unnamed historical owners. */
  readonly ownerName?: string
  readonly ready: boolean
  readonly writeScopeWarnings: string[]
}
```

```ts type-equiv
/**
 * Durable Team state published to browser clients through the Lead Session's
 * `agentTeam` projection. `failure` names the first rejected persisted Team
 * record; tasks then stay at the last valid state.
 */
interface TeamProjection {
  readonly enabled: boolean
  readonly tasks: TeamTaskView[]
  readonly failure?: string
}
```

## 回放

`agentTeam` 投影按 `TeamId` 重放任务记录，并重放 Session 自身的模式选择。subagent 发现负责当前树成员关系，不将继承目录作为权限来源。Session 事件的 `seq` 和 `time` 负责排序和时间。已提交的持久化代次保持不变。[包 README](../../packages/team/agent-team/README.zh.md)定义任务操作和限制。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxagentgroups--agentgroupservice"></a>

### `ctx.agentGroups` — `AgentGroupService`

Durable groups and the delivery of assignments and reports between members. Management reads and writes never activate a Session; assigning, reporting, and joining or leaving with an existing Session do.

```ts cordis-catalog
/**
 * Read every group and retained assignment.
 * @returns groups by creation time and assignments newest first.
 */
@Remote async snapshot(): Promise<AgentGroupSnapshot>

/**
 * Follow every group and retained assignment.
 * @param signal - cancellation owned by the Remote stream carrier.
 * @returns the current snapshot, then one snapshot after each change.
 */
@Remote({ mode: 'stream' }) async *watch(signal: AbortSignal): AsyncIterable<AgentGroupSnapshot>

/**
 * Find the group membership of one Session without activating it.
 * @param sessionId - Session to look up.
 * @returns the group and member whose resident Session it is, or `undefined`.
 */
async membershipOf(sessionId: SessionId): Promise<AgentGroupMembership | undefined>

/**
 * Whether a Session is a group member, read synchronously from loaded state.
 * @param sessionId - Session to look up.
 * @returns `false` until storage has loaded.
 */
isMember(sessionId: SessionId): boolean

/**
 * Describe a member's own position: its group, superiors, subordinates, and open assignments.
 * @param sessionId - the calling member's Session.
 * @returns the member's current view.
 * @throws {AgentGroupError} `not-a-member` when the Session belongs to no group.
 */
async memberView(sessionId: SessionId): Promise<AgentGroupMemberView>

/**
 * Create an empty group.
 * @param request - title, description, and working directory of created member Sessions.
 * @returns the stored group.
 */
@Remote('createGroup') remoteCreate(request: AgentGroupCreateRequest): Promise<AgentGroup>

/**
 * Create an empty group.
 * @param request - title, description, and working directory of created member Sessions.
 * @returns the stored group.
 * @throws {AgentGroupError} `invalid-input` for an empty or overlong title.
 */
create(request: AgentGroupCreateRequest): Promise<AgentGroup>

/**
 * Change a group's title, description, or working directory.
 * @param request - group and its changed fields.
 * @returns the stored group.
 */
@Remote('updateGroup') remoteUpdate(request: AgentGroupUpdateRequest): Promise<AgentGroup>

/**
 * Change a group's title, description, or working directory.
 * @param request - group and its changed fields; an empty `cwd` clears it.
 * @returns the stored group.
 * @throws {AgentGroupError} `group-not-found` or `invalid-input`.
 */
update(request: AgentGroupUpdateRequest): Promise<AgentGroup>

/**
 * Delete a group and its assignments. Member Sessions remain as ordinary Sessions.
 * @param request - group to delete.
 */
@Remote('removeGroup') remoteRemove(request: AgentGroupRef): Promise<void>

/**
 * Delete a group and its assignments. Member Sessions remain as ordinary Sessions.
 * @param request - group to delete.
 * @throws {AgentGroupError} `group-not-found`.
 */
async remove(request: AgentGroupRef): Promise<void>

/**
 * Add a member whose Session is created on first use.
 * @param request - group, member name, role, and optional preset.
 * @returns the stored group.
 */
@Remote('addMember') remoteAddMember(request: AgentGroupAddMemberRequest): Promise<AgentGroup>

/**
 * Add a member whose Session is created on first use.
 * @param request - group, member name, role, and optional preset.
 * @returns the stored group.
 * @throws {AgentGroupError} `group-not-found`, `invalid-input`, `name-in-use`, or `limit`.
 */
addMember(request: AgentGroupAddMemberRequest): Promise<AgentGroup>

/**
 * Add an existing Session as a member. The Session keeps its history, directory, and preset.
 * @param request - group, Session, member name, and role.
 * @param signal - cancellation of the stored Session header read.
 * @returns the stored group.
 */
@Remote('attachSession') remoteAttachSession(request: AgentGroupAttachRequest, signal?: AbortSignal): Promise<AgentGroup>

/**
 * Add an existing Session as a member. The Session keeps its history, directory, and preset.
 * @param request - group, Session, member name, and role.
 * @param signal - cancellation of the stored Session header read.
 * @returns the stored group.
 * @throws {AgentGroupError} `session-unavailable` for a missing, archived, or subagent Session;
 * `session-in-use` when the Session already is a member of a group.
 */
async attachSession(request: AgentGroupAttachRequest, signal?: AbortSignal): Promise<AgentGroup>

/**
 * Rename a member, change its role, or change the preset of a member whose Session does not exist yet.
 * @param request - member and its changed fields.
 * @returns the stored group.
 */
@Remote('updateMember') remoteUpdateMember(request: AgentGroupUpdateMemberRequest): Promise<AgentGroup>

/**
 * Rename a member, change its role, or change the preset of a member whose Session does not exist yet.
 * @param request - member and its changed fields; an empty `agentPreset` selects the Host default.
 * @returns the stored group.
 * @throws {AgentGroupError} `group-not-found`, `member-not-found`, `invalid-input`, or `name-in-use`.
 */
updateMember(request: AgentGroupUpdateMemberRequest): Promise<AgentGroup>

/**
 * Remove a member, its reporting lines, and its assignments. Its Session remains as an ordinary Session.
 * @param request - member to remove.
 * @returns the stored group.
 */
@Remote('removeMember') remoteRemoveMember(request: AgentGroupMemberRef): Promise<AgentGroup>

/**
 * Remove a member, its reporting lines, and its assignments. Its Session remains as an ordinary Session.
 * @param request - member to remove.
 * @returns the stored group.
 * @throws {AgentGroupError} `group-not-found` or `member-not-found`.
 */
async removeMember(request: AgentGroupMemberRef): Promise<AgentGroup>

/**
 * Give a member a new empty resident Session; the previous Session remains as an ordinary Session.
 * Assignments the member received and has not reported are removed, because the new Session never saw them.
 * @param request - member to reset.
 * @returns the stored group.
 */
@Remote('resetMemberSession') remoteResetMemberSession(request: AgentGroupMemberRef): Promise<AgentGroup>

/**
 * Give a member a new empty resident Session; the previous Session remains as an ordinary Session.
 * Assignments the member received and has not reported are removed, because the new Session never saw them.
 * @param request - member to reset.
 * @returns the stored group.
 * @throws {AgentGroupError} `group-not-found` or `member-not-found`.
 */
async resetMemberSession(request: AgentGroupMemberRef): Promise<AgentGroup>

/**
 * Resolve a member's Session for the user to open, creating the Session of a `created` member on first use.
 * @param request - member whose conversation the user opens.
 * @returns the member's Session id.
 */
@Remote('openMember') remoteOpenMember(request: AgentGroupMemberRef): Promise<{ readonly sessionId: SessionId }>

/**
 * Resolve a member's Session for the user to open, creating the Session of a `created` member on first use.
 * @param request - member whose conversation the user opens.
 * @returns the member's Session id.
 * @throws {AgentGroupError} `group-not-found`, `member-not-found`, or `delivery-failed` when the Session cannot be activated.
 */
openMember(request: AgentGroupMemberRef): Promise<{ readonly sessionId: SessionId }>

/**
 * Replace a group's reporting lines.
 * @param request - group, complete line set, and the revision the editor read.
 * @returns the stored group.
 */
@Remote('setEdges') remoteSetEdges(request: AgentGroupSetEdgesRequest): Promise<AgentGroup>

/**
 * Replace a group's reporting lines.
 * @param request - group, complete line set, and the revision the editor read.
 * @returns the stored group.
 * @throws {AgentGroupError} `conflict` when the group changed since `expectedRevision`; `member-not-found` for a
 * line naming no member; `invalid-input` for a member reporting to itself; `cycle` with the member names along it.
 */
setEdges(request: AgentGroupSetEdgesRequest): Promise<AgentGroup>

/**
 * Assign a task to one direct subordinate of the calling member and deliver it to that member's Session.
 * @param sessionId - the calling member's Session.
 * @param to - name of a direct subordinate.
 * @param task - complete task text.
 * @returns the open assignment, after the subordinate's Session persisted the message.
 * @throws {AgentGroupError} `not-a-member`, `not-a-subordinate`, `invalid-input`, `limit`, or `delivery-failed`.
 */
assign(sessionId: SessionId, to: string, task: string): Promise<AgentGroupAssignment>

/**
 * Report on an open assignment to the superior that gave it and deliver the report to that member's Session.
 * @param sessionId - the calling member's Session.
 * @param report - complete report text.
 * @param assignmentId - assignment reported on; required when the caller holds more than one open assignment.
 * @returns the reported assignment, after the superior's Session persisted the message.
 * @throws {AgentGroupError} `not-a-member`, `assignment-not-found`, `invalid-input`, or `delivery-failed`.
 */
report(sessionId: SessionId, report: string, assignmentId?: AgentGroupAssignmentId): Promise<AgentGroupAssignment>
```

Types: [SessionId](core.zh.md)

Source: [`packages/alfredgo/alfredgo-agent-group/src/index.ts`](../../packages/alfredgo/alfredgo-agent-group/src/index.ts)

<a id="ctxagentteams--teamservice"></a>

### `ctx.agentTeams` — `TeamService`

Agent Teams service backed by the exact live Lead Session log.

```ts cordis-catalog
/**
 * Read the Team selection shared by the caller's subagent tree.
 * @param caller - exact live root or descendant.
 * @returns whether Team tools and guidance are enabled.
 */
isEnabled(caller: Agent): boolean

/**
 * Save a root Session's Team selection without stopping children or deleting tasks.
 * The selection takes effect before awaiting persistence. Tools resolve availability at
 * step preparation; prompt providers read the selection when evaluated. Task mutations
 * check the current mode when their queued operation starts; admitted operations finish.
 * @param agent - exact live root whose tree receives the selection.
 * @param enabled - selected Team mode.
 * @param signal - cancellation checked before changing the selection.
 * @returns fulfillment after the selection flushes.
 * @throws when called by a descendant or persistence fails. An appended selection remains active;
 * retrying the same selection flushes without a duplicate event.
 */
@Remote async setEnabled(agent: Agent, enabled: boolean, signal?: AbortSignal): Promise<void>

/**
 * Create one unowned pending task in the Team Lead log.
 * @param caller - exact live Team member creating the task.
 * @param request - task text, blockers, and advisory write scopes.
 * @param signal - cancellation before the task event is appended; omitted means no cancellation.
 * @returns the revision-one task view.
 * @throws TEAM_TASK_PERSISTENCE_UNCONFIRMED when the task is visible but durability is unknown; read it before retrying.
 */
async createTask(caller: Agent, request: CreateTeamTaskRequest, signal?: AbortSignal): Promise<TeamTaskView>

/**
 * Return one task, including a deleted tombstone.
 * @param caller - exact live Team member reading the task.
 * @param id - Team-local task identity.
 * @returns the latest task value and derived readiness diagnostics.
 */
getTask(caller: Agent, id: TeamTaskId): TeamTaskView

/**
 * List current non-deleted tasks in numeric creation order.
 * @param caller - exact live Team member reading the board.
 * @returns detached current task views.
 */
listTasks(caller: Agent): TeamTaskView[]

/**
 * Compare-and-set one authorized task transition.
 * @param caller - exact live Team member authorizing the mutation.
 * @param request - task identity, expected revision, action, and action fields.
 * @param signal - cancellation before the task event is appended; omitted means no cancellation.
 * @returns the committed next task revision.
 * @throws TEAM_TASK_PERSISTENCE_UNCONFIRMED when the task is visible but durability is unknown; read it before retrying.
 */
async updateTask(caller: Agent, request: UpdateTeamTaskRequest, signal?: AbortSignal): Promise<TeamTaskView>
```

Types: [Agent](core.zh.md)

Source: [`packages/team/agent-team/src/index.ts`](../../packages/team/agent-team/src/index.ts)
<!-- END GENERATED cordis-surface -->
