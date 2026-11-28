# Agent Teams

English | [中文](agent-team.zh.md)

Types shared by the shared task board, model tools, and host adapters. The [task-board wait decision](../../.agents/notes/implemented/architecture/2026-10-19-team-task-board-inbox.md) owns coordination semantics; this page records durable and client-visible forms from [`packages/team/agent-team/src/types.ts`](../../packages/team/agent-team/src/types.ts).

## Identity and historical roster

`TeamId` brands the root `SessionId`; `TeamTaskId` uses `task-<n>`. `TeamMessageId` and roster records remain for historical decoding. The subagent runtime resolves the tree and discovers eligible task owners at arbitrary depth; historical roster entries grant no authority.

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

Historical records retain their recorded `provisioning`, `active`, or `failed` phase. Current turn activity belongs to ordinary subagent discovery and Session status, independently of task completion.

## Messages and historical mailbox

Members exchange ordinary [subagent messages](subagent.md), retaining the real sender Session id. Task changes do not end inbox waits, add inbox messages, or start idle agents. Send an explicit message when an agent needs to act on a task update. The following historical mailbox types remain readable; Team never delivers their pending records.

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

Historical `team-message` sources retain the old message id and sender attribution; the client uses them for the message title and icon.

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

## Shared task DAG

Every task event stores a complete snapshot. `revision` is the compare-and-set value and increments by one per mutation. `blockedBy` edges must name non-deleted tasks and keep the graph acyclic. `writeScopes` are normalized advisory path prefixes rather than locks.

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

`pending` is unstarted or released, `in_progress` carries an owner, `completed` satisfies blockers, and `deleted` is a retained tombstone. Views expose `ownerId`, readiness, and advisory write-scope overlap without changing the durable snapshot.

<a id="web-projection"></a>

## Web projection

`agentTeam.enabled` exposes the root Session’s saved selection. New Sessions default to false; `team/mode` records explicit selections. Historical tasks imply enabled until an explicit selection. Only the root can call `setEnabled`; descendants share that mode. The Web menu calls the same method through `remote.agentTeams.setEnabled`, with the root Session id resolved to its live Agent by the Gateway. Mode writes take effect before awaiting persistence. Tools resolve availability at step preparation; prompt providers read the selection when evaluated. Task mutations check the current mode when their queued operation starts; admitted mutations may finish. Mode changes do not end inbox waits. A failed flush leaves the appended selection active; retrying the same selection flushes it without a duplicate event.

The root Session publishes non-deleted task views through `SessionProjectionMap.agentTeam`. `failure` reports a rejected persisted task or mode record beside the last valid state. Historical roster and mailbox records are not projected. Views identify every owner by its Session id; the task panel and task tools display the owner's agent name, or the Session id when the owner has no name.

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

## Replay

The `agentTeam` projection replays task records selected by `TeamId` and the Session’s own mode selections. Subagent discovery owns current tree membership and ignores inherited catalog authority. Session event `seq` and `time` own ordering and timing. Committed durable generations are preserved. The [package README](../../packages/team/agent-team/README.md) defines task operations and limits.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [SessionId](core.md)

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

Types: [Agent](core.md)

Source: [`packages/team/agent-team/src/index.ts`](../../packages/team/agent-team/src/index.ts)
<!-- END GENERATED cordis-surface -->
