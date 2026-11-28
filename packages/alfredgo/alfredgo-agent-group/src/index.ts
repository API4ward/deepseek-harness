/**
 * Agent groups: user-defined long-lived agents joined by acyclic reporting lines.
 * A superior assigns work to its direct subordinates and a subordinate reports to
 * the superior that assigned it; both travel as inbox messages of the member's
 * resident Session.
 * @module @deepseek-ai/dsh-alfredgo-agent-group
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { HarnessError } from '@deepseek-ai/dsh-error'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { delegationDepthOf } from '@deepseek-ai/dsh-subagent'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-workspace'
import { findCycle } from './graph.ts'
import { agentGroupDomain } from './storage.ts'
import type {
  AgentGroup, AgentGroupAddMemberRequest, AgentGroupAssignment, AgentGroupAssignmentId, AgentGroupAttachRequest,
  AgentGroupCreateRequest, AgentGroupEdge, AgentGroupErrorCode, AgentGroupId, AgentGroupMember, AgentGroupMemberId,
  AgentGroupMemberRef, AgentGroupMemberView, AgentGroupNeighbor, AgentGroupOpenAssignment, AgentGroupRef,
  AgentGroupSetEdgesRequest, AgentGroupSnapshot, AgentGroupUpdateMemberRequest, AgentGroupUpdateRequest,
} from './types.ts'

export type * from './types.ts'

/** Attribution of a message this service wrote into a member's Session. */
export type AgentGroupMessageSource =
  | {
    readonly kind: 'agent-group'
    /** A task or report another member addressed to this one. */
    readonly form: 'relay'
    readonly groupId: AgentGroupId
    readonly assignmentId: AgentGroupAssignmentId
    readonly direction: 'assign' | 'report'
    readonly senderMemberId: AgentGroupMemberId
    readonly senderSessionId: SessionId
  }
  | {
    readonly kind: 'agent-group'
    /** The Session joined or left a group. */
    readonly form: 'notice'
    readonly summary: string
    readonly groupId: AgentGroupId
  }

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'agent-group': AgentGroupMessageSource
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Agent groups, their reporting lines, and assignment delivery. */
    agentGroups: AgentGroupService
  }
}

/** Plugin configuration. */
export interface Config {
  /** Most members one group accepts. */
  maxMembersPerGroup: number
  /** Most unreported assignments one member may hold; a further assignment is refused. */
  maxOpenAssignmentsPerMember: number
  /** Reported assignments retained per group for the activity list; the oldest are removed first. */
  assignmentHistoryRecords: number
}

/** A group request the service refused, with a stable code. */
export class AgentGroupError extends HarnessError {
  declare readonly code: AgentGroupErrorCode

  /**
   * @param code - stable refusal class.
   * @param message - what was refused and what the caller can do.
   * @param cycle - for `cycle`, the member names along the cycle, first name repeated last.
   * @param options - contained cause.
   */
  constructor(code: AgentGroupErrorCode, message: string, readonly cycle?: readonly string[], options?: ErrorOptions) {
    super(message, code, options)
  }
}

/** Longest member or group name. */
const MAX_NAME_LENGTH = 60

/** Longest assignment summary kept for lists. */
const MAX_SUMMARY_LENGTH = 120

/** Member names are path-free words so the model can quote them exactly. */
const NAME_PATTERN = /^[^\s/"'`][^/"'`\n]*$/

/** A member and the group it belongs to. */
export interface AgentGroupMembership {
  readonly group: AgentGroup
  readonly member: AgentGroupMember
}

/**
 * Durable groups and the delivery of assignments and reports between members.
 * Management reads and writes never activate a Session; assigning, reporting,
 * and joining or leaving with an existing Session do.
 */
export class AgentGroupService extends TypertRemoteService {
  static inject = ['agents', 'sessions', 'storageDomain', 'sessionPersistence']

  static Config: z<Config> = z.object({
    maxMembersPerGroup: z.number().step(1).min(1).max(500).default(50),
    maxOpenAssignmentsPerMember: z.number().step(1).min(1).max(1000).default(20),
    assignmentHistoryRecords: z.number().step(1).min(0).max(10_000).default(200),
  })

  private readonly ready: Promise<Domain<typeof agentGroupDomain>>
  private chain: Promise<unknown> = Promise.resolve()
  private stopping = false
  private readonly watchers = new Set<() => void>()

  /**
   * @param ctx - Host services owning storage, Sessions, and Session activation.
   * @param config - validated limits.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'agentGroups')
    this.ready = ctx.storageDomain.open(agentGroupDomain)
    ctx.effect(() => async () => {
      this.stopping = true
      for (const wake of this.watchers) wake()
      await this.chain // The chain contains failures after returning them to their callers.
      const domain = await this.ready.catch(() => undefined)
      await domain?.close()
    })
  }

  async [Service.init](): Promise<void> {
    this.loaded = await this.ready
  }

  // --- reads ---------------------------------------------------------------

  /**
   * Read every group and retained assignment.
   * @returns groups by creation time and assignments newest first.
   */
  @Remote
  async snapshot(): Promise<AgentGroupSnapshot> {
    const domain = await this.ready
    return {
      groups: [...domain.table('groups').entries()].map(([, group]) => group)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
      assignments: [...domain.table('assignments').entries()].map(([, assignment]) => assignment)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)),
    }
  }

  /**
   * Follow every group and retained assignment.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns the current snapshot, then one snapshot after each change.
   */
  @Remote({ mode: 'stream' })
  async *watch(signal: AbortSignal): AsyncIterable<AgentGroupSnapshot> {
    let dirty = true
    let wake: (() => void) | undefined
    const changed = (): void => { dirty = true; wake?.() }
    this.watchers.add(changed)
    signal.addEventListener('abort', changed, { once: true })
    try {
      while (!signal.aborted && !this.stopping) {
        if (dirty) {
          dirty = false
          yield await this.snapshot()
          continue
        }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      signal.removeEventListener('abort', changed)
      this.watchers.delete(changed)
    }
  }

  /**
   * Find the group membership of one Session without activating it.
   * @param sessionId - Session to look up.
   * @returns the group and member whose resident Session it is, or `undefined`.
   */
  async membershipOf(sessionId: SessionId): Promise<AgentGroupMembership | undefined> {
    for (const [, group] of (await this.ready).table('groups').entries()) {
      const member = group.members.find(member => member.sessionId === sessionId)
      if (member !== undefined) return { group, member }
    }
    return undefined
  }

  /**
   * Whether a Session is a group member, read synchronously from loaded state.
   * @param sessionId - Session to look up.
   * @returns `false` until storage has loaded.
   */
  isMember(sessionId: SessionId): boolean {
    if (this.loaded === undefined) return false
    for (const [, group] of this.loaded.table('groups').entries()) {
      if (group.members.some(member => member.sessionId === sessionId)) return true
    }
    return false
  }

  /**
   * Describe a member's own position: its group, superiors, subordinates, and open assignments.
   * @param sessionId - the calling member's Session.
   * @returns the member's current view.
   * @throws {AgentGroupError} `not-a-member` when the Session belongs to no group.
   */
  async memberView(sessionId: SessionId): Promise<AgentGroupMemberView> {
    const { group, member } = await this.requireMembership(sessionId)
    const neighbor = (id: AgentGroupMemberId): AgentGroupNeighbor => {
      const other = requireMember(group, id)
      return { name: other.name, role: other.role, running: this.ctx.agents.get(other.sessionId)?.status === 'running' }
    }
    const open = [...(await this.ready).table('assignments').entries()].map(([, assignment]) => assignment)
      .filter(assignment => assignment.groupId === group.id && assignment.status === 'open')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const entry = (assignment: AgentGroupAssignment, other: AgentGroupMemberId): AgentGroupOpenAssignment =>
      ({ id: assignment.id, member: requireMember(group, other).name, summary: assignment.summary })
    return {
      group: group.title,
      description: group.description,
      name: member.name,
      role: member.role,
      superiors: group.edges.filter(edge => edge.subordinate === member.id).map(edge => neighbor(edge.superior)),
      subordinates: group.edges.filter(edge => edge.superior === member.id).map(edge => neighbor(edge.subordinate)),
      received: open.filter(assignment => assignment.to === member.id).map(assignment => entry(assignment, assignment.from)),
      given: open.filter(assignment => assignment.from === member.id).map(assignment => entry(assignment, assignment.to)),
    }
  }

  // --- group management ------------------------------------------------------

  /**
   * Create an empty group.
   * @param request - title, description, and working directory of created member Sessions.
   * @returns the stored group.
   */
  @Remote('createGroup')
  remoteCreate(request: AgentGroupCreateRequest): Promise<AgentGroup> {
    return remote(() => this.create(request))
  }

  /**
   * Create an empty group.
   * @param request - title, description, and working directory of created member Sessions.
   * @returns the stored group.
   * @throws {AgentGroupError} `invalid-input` for an empty or overlong title.
   */
  create(request: AgentGroupCreateRequest): Promise<AgentGroup> {
    return this.serialize(async () => {
      const now = new Date().toISOString()
      const cwd = request.cwd?.trim()
      const group: AgentGroup = {
        id: brandString<AgentGroupId>(`group-${randomUUID()}`),
        title: checkedName(request.title, 'group title'),
        description: request.description?.trim() ?? '',
        ...(cwd === undefined || cwd === '' ? {} : { cwd }),
        members: [],
        edges: [],
        revision: 1,
        createdAt: now,
        updatedAt: now,
      }
      await (await this.ready).table('groups').put(group.id, group)
      this.changed()
      return group
    })
  }

  /**
   * Change a group's title, description, or working directory.
   * @param request - group and its changed fields.
   * @returns the stored group.
   */
  @Remote('updateGroup')
  remoteUpdate(request: AgentGroupUpdateRequest): Promise<AgentGroup> {
    return remote(() => this.update(request))
  }

  /**
   * Change a group's title, description, or working directory.
   * @param request - group and its changed fields; an empty `cwd` clears it.
   * @returns the stored group.
   * @throws {AgentGroupError} `group-not-found` or `invalid-input`.
   */
  update(request: AgentGroupUpdateRequest): Promise<AgentGroup> {
    return this.mutate(request.groupId, (group) => {
      const { cwd: _cwd, ...rest } = group
      const cwd = request.cwd === undefined ? group.cwd : request.cwd.trim()
      return {
        ...rest,
        ...(request.title === undefined ? {} : { title: checkedName(request.title, 'group title') }),
        ...(request.description === undefined ? {} : { description: request.description.trim() }),
        ...(cwd === undefined || cwd === '' ? {} : { cwd }),
      }
    })
  }

  /**
   * Delete a group and its assignments. Member Sessions remain as ordinary Sessions.
   * @param request - group to delete.
   */
  @Remote('removeGroup')
  remoteRemove(request: AgentGroupRef): Promise<void> {
    return remote(() => this.remove(request))
  }

  /**
   * Delete a group and its assignments. Member Sessions remain as ordinary Sessions.
   * @param request - group to delete.
   * @throws {AgentGroupError} `group-not-found`.
   */
  async remove(request: AgentGroupRef): Promise<void> {
    const removed = await this.serialize(async () => {
      const domain = await this.ready
      const group = this.requireGroup(domain, request.groupId)
      await domain.table('assignments').deleteMany(this.assignmentIds(domain, assignment => assignment.groupId === group.id))
      await domain.table('groups').delete(group.id)
      this.changed()
      return group
    })
    for (const member of removed.members) this.notice(removed, member, 'left')
  }

  // --- members ---------------------------------------------------------------

  /**
   * Add a member whose Session is created on first use.
   * @param request - group, member name, role, and optional preset.
   * @returns the stored group.
   */
  @Remote('addMember')
  remoteAddMember(request: AgentGroupAddMemberRequest): Promise<AgentGroup> {
    return remote(() => this.addMember(request))
  }

  /**
   * Add a member whose Session is created on first use.
   * @param request - group, member name, role, and optional preset.
   * @returns the stored group.
   * @throws {AgentGroupError} `group-not-found`, `invalid-input`, `name-in-use`, or `limit`.
   */
  addMember(request: AgentGroupAddMemberRequest): Promise<AgentGroup> {
    return this.mutate(request.groupId, (group) => {
      const preset = request.agentPreset?.trim()
      return {
        ...group,
        members: [...group.members, {
          ...this.newMember(group, request.name, request.role),
          origin: 'created',
          ...(preset === undefined || preset === '' ? {} : { agentPreset: preset }),
          sessionId: brandString<SessionId>(`session-${randomUUID()}`),
        }],
      }
    })
  }

  /**
   * Add an existing Session as a member. The Session keeps its history, directory, and preset.
   * @param request - group, Session, member name, and role.
   * @param signal - cancellation of the stored Session header read.
   * @returns the stored group.
   */
  @Remote('attachSession')
  remoteAttachSession(request: AgentGroupAttachRequest, signal?: AbortSignal): Promise<AgentGroup> {
    return remote(() => this.attachSession(request, signal))
  }

  /**
   * Add an existing Session as a member. The Session keeps its history, directory, and preset.
   * @param request - group, Session, member name, and role.
   * @param signal - cancellation of the stored Session header read.
   * @returns the stored group.
   * @throws {AgentGroupError} `session-unavailable` for a missing, archived, or subagent Session;
   * `session-in-use` when the Session already is a member of a group.
   */
  async attachSession(request: AgentGroupAttachRequest, signal?: AbortSignal): Promise<AgentGroup> {
    await this.requireOrdinarySession(request.sessionId, signal)
    let joined: AgentGroupMember | undefined
    const group = await this.mutate(request.groupId, async (group) => {
      const taken = await this.membershipOf(request.sessionId)
      if (taken !== undefined) {
        throw new AgentGroupError('session-in-use',
          `This conversation already is member "${taken.member.name}" of group "${taken.group.title}". Remove it there first.`)
      }
      joined = { ...this.newMember(group, request.name, request.role), origin: 'attached', sessionId: request.sessionId }
      return { ...group, members: [...group.members, joined] }
    })
    if (joined !== undefined) this.notice(group, joined, 'joined')
    return group
  }

  /**
   * Rename a member, change its role, or change the preset of a member whose Session does not exist yet.
   * @param request - member and its changed fields.
   * @returns the stored group.
   */
  @Remote('updateMember')
  remoteUpdateMember(request: AgentGroupUpdateMemberRequest): Promise<AgentGroup> {
    return remote(() => this.updateMember(request))
  }

  /**
   * Rename a member, change its role, or change the preset of a member whose Session does not exist yet.
   * @param request - member and its changed fields; an empty `agentPreset` selects the Host default.
   * @returns the stored group.
   * @throws {AgentGroupError} `group-not-found`, `member-not-found`, `invalid-input`, or `name-in-use`.
   */
  updateMember(request: AgentGroupUpdateMemberRequest): Promise<AgentGroup> {
    return this.mutate(request.groupId, (group) => {
      const current = requireMember(group, request.memberId)
      const { agentPreset: _preset, ...rest } = current
      const name = request.name === undefined ? current.name : checkedMemberName(request.name)
      if (group.members.some(member => member.id !== current.id && sameName(member.name, name))) {
        throw new AgentGroupError('name-in-use', `Group "${group.title}" already has a member named "${name}".`)
      }
      const preset = request.agentPreset === undefined ? current.agentPreset : request.agentPreset.trim()
      const next: AgentGroupMember = {
        ...rest,
        name,
        role: request.role === undefined ? current.role : request.role.trim(),
        ...(current.origin === 'attached' || preset === undefined || preset === '' ? {} : { agentPreset: preset }),
      }
      return { ...group, members: group.members.map(member => member.id === current.id ? next : member) }
    })
  }

  /**
   * Remove a member, its reporting lines, and its assignments. Its Session remains as an ordinary Session.
   * @param request - member to remove.
   * @returns the stored group.
   */
  @Remote('removeMember')
  remoteRemoveMember(request: AgentGroupMemberRef): Promise<AgentGroup> {
    return remote(() => this.removeMember(request))
  }

  /**
   * Remove a member, its reporting lines, and its assignments. Its Session remains as an ordinary Session.
   * @param request - member to remove.
   * @returns the stored group.
   * @throws {AgentGroupError} `group-not-found` or `member-not-found`.
   */
  async removeMember(request: AgentGroupMemberRef): Promise<AgentGroup> {
    let removed: AgentGroupMember | undefined
    const group = await this.mutate(request.groupId, async (group) => {
      removed = requireMember(group, request.memberId)
      const domain = await this.ready
      await domain.table('assignments').deleteMany(this.assignmentIds(domain, assignment =>
        assignment.groupId === group.id && (assignment.from === request.memberId || assignment.to === request.memberId)))
      return {
        ...group,
        members: group.members.filter(member => member.id !== request.memberId),
        edges: group.edges.filter(edge => edge.superior !== request.memberId && edge.subordinate !== request.memberId),
      }
    })
    if (removed !== undefined) this.notice(group, removed, 'left')
    return group
  }

  /**
   * Give a member a new empty resident Session; the previous Session remains as an ordinary Session.
   * Assignments the member received and has not reported are removed, because the new Session never saw them.
   * @param request - member to reset.
   * @returns the stored group.
   */
  @Remote('resetMemberSession')
  remoteResetMemberSession(request: AgentGroupMemberRef): Promise<AgentGroup> {
    return remote(() => this.resetMemberSession(request))
  }

  /**
   * Give a member a new empty resident Session; the previous Session remains as an ordinary Session.
   * Assignments the member received and has not reported are removed, because the new Session never saw them.
   * @param request - member to reset.
   * @returns the stored group.
   * @throws {AgentGroupError} `group-not-found` or `member-not-found`.
   */
  async resetMemberSession(request: AgentGroupMemberRef): Promise<AgentGroup> {
    let previous: AgentGroupMember | undefined
    const group = await this.mutate(request.groupId, async (group) => {
      previous = requireMember(group, request.memberId)
      const domain = await this.ready
      await domain.table('assignments').deleteMany(this.assignmentIds(domain, assignment =>
        assignment.groupId === group.id && assignment.to === request.memberId && assignment.status === 'open'))
      const next: AgentGroupMember = {
        ...previous, origin: 'created', sessionId: brandString<SessionId>(`session-${randomUUID()}`),
      }
      return { ...group, members: group.members.map(member => member.id === next.id ? next : member) }
    })
    if (previous !== undefined) this.notice(group, previous, 'left')
    return group
  }

  /**
   * Resolve a member's Session for the user to open, creating the Session of a `created` member on first use.
   * @param request - member whose conversation the user opens.
   * @returns the member's Session id.
   */
  @Remote('openMember')
  remoteOpenMember(request: AgentGroupMemberRef): Promise<{ readonly sessionId: SessionId }> {
    return remote(() => this.openMember(request))
  }

  /**
   * Resolve a member's Session for the user to open, creating the Session of a `created` member on first use.
   * @param request - member whose conversation the user opens.
   * @returns the member's Session id.
   * @throws {AgentGroupError} `group-not-found`, `member-not-found`, or `delivery-failed` when the Session cannot be activated.
   */
  openMember(request: AgentGroupMemberRef): Promise<{ readonly sessionId: SessionId }> {
    return this.serialize(async () => {
      const group = this.requireGroup(await this.ready, request.groupId)
      const member = requireMember(group, request.memberId)
      try {
        await this.activate(group, member)
      } catch (error: unknown) {
        if (error instanceof AgentGroupError) throw error
        throw new AgentGroupError('delivery-failed',
          `The conversation of "${member.name}" could not be opened: ${error instanceof Error ? error.message : String(error)}`, undefined, { cause: error })
      }
      return { sessionId: member.sessionId }
    })
  }

  // --- reporting lines ---------------------------------------------------------

  /**
   * Replace a group's reporting lines.
   * @param request - group, complete line set, and the revision the editor read.
   * @returns the stored group.
   */
  @Remote('setEdges')
  remoteSetEdges(request: AgentGroupSetEdgesRequest): Promise<AgentGroup> {
    return remote(() => this.setEdges(request))
  }

  /**
   * Replace a group's reporting lines.
   * @param request - group, complete line set, and the revision the editor read.
   * @returns the stored group.
   * @throws {AgentGroupError} `conflict` when the group changed since `expectedRevision`; `member-not-found` for a
   * line naming no member; `invalid-input` for a member reporting to itself; `cycle` with the member names along it.
   */
  setEdges(request: AgentGroupSetEdgesRequest): Promise<AgentGroup> {
    return this.mutate(request.groupId, (group) => {
      if (group.revision !== request.expectedRevision) {
        throw new AgentGroupError('conflict', `Group "${group.title}" changed while it was being edited. Reload it and apply the change again.`)
      }
      const names = new Map(group.members.map(member => [member.id, member.name]))
      const seen = new Set<string>()
      const edges: AgentGroupEdge[] = []
      for (const { superior, subordinate } of request.edges) {
        if (!names.has(superior) || !names.has(subordinate)) {
          throw new AgentGroupError('member-not-found', 'A reporting line names a member that is not in the group.')
        }
        if (superior === subordinate) {
          throw new AgentGroupError('invalid-input', `"${names.get(superior)}" cannot be its own superior.`)
        }
        const key = `${superior}\n${subordinate}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({ superior, subordinate })
      }
      const cycle = findCycle(edges)?.map(id => names.get(id) ?? id)
      if (cycle !== undefined) {
        throw new AgentGroupError('cycle', `These reporting lines form a cycle: ${cycle.join(' → ')}. Remove one of them.`, cycle)
      }
      return { ...group, edges }
    })
  }

  // --- assignments -------------------------------------------------------------

  /**
   * Assign a task to one direct subordinate of the calling member and deliver it to that member's Session.
   * @param sessionId - the calling member's Session.
   * @param to - name of a direct subordinate.
   * @param task - complete task text.
   * @returns the open assignment, after the subordinate's Session persisted the message.
   * @throws {AgentGroupError} `not-a-member`, `not-a-subordinate`, `invalid-input`, `limit`, or `delivery-failed`.
   */
  assign(sessionId: SessionId, to: string, task: string): Promise<AgentGroupAssignment> {
    return this.serialize(async () => {
      const domain = await this.ready
      const { group, member } = await this.requireMembership(sessionId)
      const subordinates = group.edges.filter(edge => edge.superior === member.id)
        .map(edge => requireMember(group, edge.subordinate))
      const target = subordinates.find(other => sameName(other.name, to.trim()))
      if (target === undefined) {
        const names = subordinates.map(other => `"${other.name}"`).join(', ')
        throw new AgentGroupError('not-a-subordinate', subordinates.length === 0
          ? `"${to}" is not your direct subordinate. You have no direct subordinates in group "${group.title}".`
          : `"${to}" is not your direct subordinate. Your direct subordinates are: ${names}.`)
      }
      if (task.trim() === '') throw new AgentGroupError('invalid-input', 'The task is empty.')
      const open = [...domain.table('assignments').entries()]
        .filter(([, assignment]) => assignment.to === target.id && assignment.status === 'open').length
      if (open >= this.config.maxOpenAssignmentsPerMember) {
        throw new AgentGroupError('limit',
          `"${target.name}" already has ${open} unreported assignments, the most this group allows. Wait for a report first.`)
      }
      const assignment: AgentGroupAssignment = {
        id: brandString<AgentGroupAssignmentId>(`a-${randomUUID().slice(0, 8)}`),
        groupId: group.id,
        from: member.id,
        to: target.id,
        summary: summarize(task),
        status: 'open',
        createdAt: new Date().toISOString(),
      }
      await this.deliver(group, target, [
        `Your superior "${member.name}" in group "${group.title}" assigned you a task (assignment ${assignment.id}).`,
        // Naming the recipient keeps a member from answering as its superior before it has read group_members.
        target.role === ''
          ? `You are member "${target.name}" of that group.`
          : `You are member "${target.name}" of that group; your role: ${target.role}`,
        `When it is done or cannot be done, call group_report with assignment_id "${assignment.id}".`,
        '',
        task,
      ].join('\n'), {
        kind: 'agent-group',
        form: 'relay',
        groupId: group.id,
        assignmentId: assignment.id,
        direction: 'assign',
        senderMemberId: member.id,
        senderSessionId: sessionId,
      })
      await domain.table('assignments').put(assignment.id, assignment)
      this.changed()
      return assignment
    })
  }

  /**
   * Report on an open assignment to the superior that gave it and deliver the report to that member's Session.
   * @param sessionId - the calling member's Session.
   * @param report - complete report text.
   * @param assignmentId - assignment reported on; required when the caller holds more than one open assignment.
   * @returns the reported assignment, after the superior's Session persisted the message.
   * @throws {AgentGroupError} `not-a-member`, `assignment-not-found`, `invalid-input`, or `delivery-failed`.
   */
  report(sessionId: SessionId, report: string, assignmentId?: AgentGroupAssignmentId): Promise<AgentGroupAssignment> {
    return this.serialize(async () => {
      const domain = await this.ready
      const { group, member } = await this.requireMembership(sessionId)
      const open = [...domain.table('assignments').entries()].map(([, assignment]) => assignment)
        .filter(assignment => assignment.to === member.id && assignment.status === 'open')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      const listed = open.map(assignment => `${assignment.id} (${assignment.summary})`).join('; ')
      const [only] = open
      let assignment: AgentGroupAssignment | undefined
      if (assignmentId !== undefined) {
        assignment = open.find(candidate => candidate.id === assignmentId)
        if (assignment === undefined) {
          throw new AgentGroupError('assignment-not-found', open.length === 0
            ? `You have no open assignment "${assignmentId}"; nothing is waiting for your report.`
            : `You have no open assignment "${assignmentId}". Your open assignments are: ${listed}.`)
        }
      } else if (only !== undefined && open.length === 1) {
        assignment = only
      } else {
        throw new AgentGroupError('assignment-not-found', open.length === 0
          ? 'No assignment is waiting for your report.'
          : `You have several open assignments; pass assignment_id. They are: ${listed}.`)
      }
      if (report.trim() === '') throw new AgentGroupError('invalid-input', 'The report is empty.')
      const superior = requireMember(group, assignment.from)
      await this.deliver(group, superior, [
        `Your subordinate "${member.name}" in group "${group.title}" reported on assignment ${assignment.id} (${assignment.summary}).`,
        '',
        report,
      ].join('\n'), {
        kind: 'agent-group',
        form: 'relay',
        groupId: group.id,
        assignmentId: assignment.id,
        direction: 'report',
        senderMemberId: member.id,
        senderSessionId: sessionId,
      })
      const reported: AgentGroupAssignment = { ...assignment, status: 'reported', reportedAt: new Date().toISOString() }
      await domain.table('assignments').put(reported.id, reported)
      const earlier = [...domain.table('assignments').entries()].map(([, stored]) => stored)
        .filter(stored => stored.groupId === group.id && stored.status === 'reported' && stored.id !== reported.id)
        .sort((a, b) => (b.reportedAt ?? '').localeCompare(a.reportedAt ?? ''))
      await domain.table('assignments').deleteMany(
        [reported, ...earlier].slice(this.config.assignmentHistoryRecords).map(stored => stored.id))
      this.changed()
      return reported
    })
  }

  // --- internals ---------------------------------------------------------------

  /** The opened domain, for synchronous reads; `undefined` until storage has loaded. */
  private loaded: Domain<typeof agentGroupDomain> | undefined

  /** Wake every `watch` stream after a durable change. */
  private changed(): void {
    for (const wake of this.watchers) wake()
  }

  private requireGroup(domain: Domain<typeof agentGroupDomain>, groupId: AgentGroupId): AgentGroup {
    const group = domain.table('groups').get(groupId)
    if (group === undefined) throw new AgentGroupError('group-not-found', 'This group no longer exists.')
    return group
  }

  private async requireMembership(sessionId: SessionId): Promise<AgentGroupMembership> {
    const membership = await this.membershipOf(sessionId)
    if (membership === undefined) throw new AgentGroupError('not-a-member', 'This conversation is not a member of any group.')
    return membership
  }

  private assignmentIds(
    domain: Domain<typeof agentGroupDomain>,
    match: (assignment: AgentGroupAssignment) => boolean,
  ): AgentGroupAssignmentId[] {
    return [...domain.table('assignments').entries()].filter(([, assignment]) => match(assignment)).map(([id]) => id)
  }

  /** Validate a new member's name and role against its group and allocate its id. */
  private newMember(group: AgentGroup, rawName: string, role: string): Pick<AgentGroupMember, 'id' | 'name' | 'role'> {
    if (group.members.length >= this.config.maxMembersPerGroup) {
      throw new AgentGroupError('limit', `Group "${group.title}" already has ${group.members.length} members, the most allowed.`)
    }
    const name = checkedMemberName(rawName)
    if (group.members.some(member => sameName(member.name, name))) {
      throw new AgentGroupError('name-in-use', `Group "${group.title}" already has a member named "${name}".`)
    }
    return { id: brandString<AgentGroupMemberId>(`member-${randomUUID()}`), name, role: role.trim() }
  }

  /** Apply one change to a stored group in the mutation FIFO, incrementing its revision. */
  private mutate(groupId: AgentGroupId, change: (group: AgentGroup) => AgentGroup | Promise<AgentGroup>): Promise<AgentGroup> {
    return this.serialize(async () => {
      const domain = await this.ready
      const current = this.requireGroup(domain, groupId)
      const next: AgentGroup = { ...await change(current), revision: current.revision + 1, updatedAt: new Date().toISOString() }
      await domain.table('groups').put(groupId, next)
      this.changed()
      return next
    })
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    if (this.stopping) return Promise.reject(new Error('Agent group service is stopping'))
    const pending = this.chain.then(work)
    this.chain = pending.catch(() => undefined) // Preserve FIFO progress after the caller receives the failure.
    return pending
  }

  /** Refuse a Session that is missing, archived, or owned by subagent routing, reading only its stored header. */
  private async requireOrdinarySession(sessionId: SessionId, signal?: AbortSignal): Promise<void> {
    if (this.ctx.get('workspaceRegistry')?.archivedSessionIds.includes(sessionId) === true) {
      throw new AgentGroupError('session-unavailable', 'This conversation is archived. Restore it before adding it to a group.')
    }
    const subagent = new AgentGroupError('session-unavailable', 'A subagent conversation cannot join a group.')
    const agent = this.ctx.agents.get(sessionId)
    if (agent !== undefined) {
      if (delegationDepthOf(agent) > 0) throw subagent
      return
    }
    const stored = await this.ctx.sessionPersistence.stat(sessionId, signal === undefined ? undefined : { signal })
      .catch((error: unknown) => {
        signal?.throwIfAborted()
        throw new AgentGroupError('session-unavailable', 'This conversation cannot be read.', undefined, { cause: error })
      })
    if (stored === undefined) throw new AgentGroupError('session-unavailable', 'This conversation does not exist.')
    if ((stored.header.delegationDepth ?? 0) > 0) throw subagent
  }

  /** Resolve a member's live Agent, creating the Session of a `created` member on first use. */
  private async activate(group: AgentGroup, member: AgentGroupMember): Promise<Agent> {
    if (this.ctx.get('workspaceRegistry')?.archivedSessionIds.includes(member.sessionId) === true) {
      throw new AgentGroupError('delivery-failed',
        `The conversation of "${member.name}" is archived. The user must restore it or reset this member's conversation in the group settings.`)
    }
    const controller = this.ctx.get('sessionController')
    if (controller === undefined) throw new AgentGroupError('delivery-failed', 'This Host cannot activate conversations.')
    const resolve = async (): Promise<Agent | undefined> => {
      try {
        const resolved = await controller.resolveAgent(member.sessionId)
        if (!('error' in resolved)) return resolved.agent
        if (resolved.error.code === 'session/not-found') return undefined
        throw resolved.error
      } catch (error: unknown) {
        if (error instanceof SessionPersistenceNotFoundError) return undefined
        throw error
      }
    }
    const existing = await resolve()
    if (existing !== undefined) return existing
    if (member.origin === 'attached') {
      throw new AgentGroupError('delivery-failed',
        `The conversation of "${member.name}" no longer exists. The user must reset this member's conversation in the group settings.`)
    }
    await controller.create({
      sessionId: member.sessionId,
      ...(group.cwd === undefined ? {} : { cwd: group.cwd }),
      ...(member.agentPreset === undefined ? {} : { agentPreset: member.agentPreset }),
    })
    const created = await resolve()
    if (created === undefined) throw new AgentGroupError('delivery-failed', `The conversation of "${member.name}" could not be created.`)
    await this.joinWorkspace(member.sessionId, group.cwd)
    this.nameSession(created, `${group.title} · ${member.name}`)
    return created
  }

  /** Attach a created Session to the Workspace registered at its directory; a failure is logged and does not stop delivery. */
  private async joinWorkspace(sessionId: SessionId, cwd: string | undefined): Promise<void> {
    const registry = this.ctx.get('workspaceRegistry')
    if (registry === undefined || cwd === undefined) return
    try {
      await (await registry.resolveByPath(cwd))?.attachSession(sessionId)
    } catch (error: unknown) {
      this.ctx.logger.warn(`agent-group: Session ${sessionId} did not join the Workspace at ${cwd}: ${String(error)}`)
    }
  }

  /** Name a created Session that has no title yet; a failure is logged and does not stop delivery. */
  private nameSession(agent: Agent, title: string): void {
    const titles = this.ctx.get('sessionTitle')
    if (titles === undefined || titles.get(agent.session) !== undefined) return
    try {
      titles.rename(agent.session, title)
    } catch (error: unknown) {
      this.ctx.logger.warn(`agent-group: Session ${agent.id} was not named: ${String(error)}`)
    }
  }

  /** Write one message into a member's Session, waking it, and wait for the Session to persist it. */
  private async deliver(group: AgentGroup, member: AgentGroupMember, text: string, source: MessageSource): Promise<void> {
    try {
      const agent = await this.activate(group, member)
      const message = createUserMessage({ content: [{ type: 'text', text }], source })
      if (agent.status === 'running') agent.steer(message)
      else agent.followup(message)
      if (!await this.ctx.sessions.flush(agent.session)) throw new Error('Session persistence did not acknowledge the message')
    } catch (error: unknown) {
      if (error instanceof AgentGroupError) throw error
      throw new AgentGroupError('delivery-failed',
        `The message did not reach "${member.name}": ${error instanceof Error ? error.message : String(error)}`, undefined, { cause: error })
    }
  }

  /**
   * Tell an existing Session, without waking it, that it joined or left a group, so its log shows where the group
   * tools appear and disappear. A Session that was never created, or cannot be activated, gets no notice.
   */
  private notice(group: AgentGroup, member: AgentGroupMember, change: 'joined' | 'left'): void {
    const text = change === 'joined'
      ? `The user added this conversation to group "${group.title}" as member "${member.name}". Call group_members to see your superiors and subordinates.`
      : `The user removed this conversation from group "${group.title}". The group tools no longer apply here.`
    const summary = boundContextSummary(change === 'joined' ? `Joined group ${group.title} as ${member.name}` : `Left group ${group.title}`)
    const work = async (): Promise<void> => {
      const controller = this.ctx.get('sessionController')
      const resolved = this.ctx.agents.get(member.sessionId) ?? await (async () => {
        const result = await controller?.resolveAgent(member.sessionId)
        return result === undefined || 'error' in result ? undefined : result.agent
      })()
      if (resolved === undefined) return
      resolved.inject(createUserMessage({
        content: [{ type: 'text', text }], source: { kind: 'agent-group', form: 'notice', summary, groupId: group.id },
      }))
      await this.ctx.sessions.flush(resolved.session)
    }
    this.chain = this.chain.then(work).catch((error: unknown) => {
      this.ctx.logger.warn(`agent-group: membership notice for Session ${member.sessionId} failed: ${String(error)}`)
    })
  }
}

/** Run a native method for a Remote caller, carrying its refusal code across the transport. */
async function remote<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error: unknown) {
    if (error instanceof AgentGroupError) {
      throw new RemoteError('agent-group/refused', error.message, {
        code: error.code, ...(error.cycle === undefined ? {} : { cycle: error.cycle }),
      })
    }
    throw error
  }
}

function requireMember(group: AgentGroup, memberId: AgentGroupMemberId): AgentGroupMember {
  const member = group.members.find(member => member.id === memberId)
  if (member === undefined) throw new AgentGroupError('member-not-found', `Group "${group.title}" has no such member.`)
  return member
}

function checkedName(raw: string, what: string): string {
  const name = raw.trim()
  if (name === '' || name.length > MAX_NAME_LENGTH) {
    throw new AgentGroupError('invalid-input', `A ${what} must have 1 to ${MAX_NAME_LENGTH} characters.`)
  }
  return name
}

function checkedMemberName(raw: string): string {
  const name = checkedName(raw, 'member name')
  if (!NAME_PATTERN.test(name)) {
    throw new AgentGroupError('invalid-input', 'A member name cannot contain a slash, a quote, or a line break.')
  }
  return name
}

function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0
}

function summarize(task: string): string {
  const [first = ''] = task.trim().split('\n', 1)
  const line = first.trim()
  return line.length <= MAX_SUMMARY_LENGTH ? line : `${line.slice(0, MAX_SUMMARY_LENGTH - 1)}…`
}

export default AgentGroupService
