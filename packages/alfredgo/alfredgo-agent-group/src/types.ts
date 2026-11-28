/** JSON values of agent groups, shared by the Host service, the model tools, and the Client. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-typert-protocol'

/** Identifies one agent group. */
export type AgentGroupId = Branded<'AgentGroupId'>

/** Identifies one member within its group. */
export type AgentGroupMemberId = Branded<'AgentGroupMemberId'>

/** Identifies one assignment a superior gave a subordinate. */
export type AgentGroupAssignmentId = Branded<'AgentGroupAssignmentId'>

/** Stable failure codes of group management, assignment, and reporting. */
export type AgentGroupErrorCode =
  | 'group-not-found'
  | 'member-not-found'
  | 'invalid-input'
  | 'name-in-use'
  | 'session-in-use'
  | 'session-unavailable'
  | 'conflict'
  | 'cycle'
  | 'limit'
  | 'not-a-member'
  | 'not-a-subordinate'
  | 'assignment-not-found'
  | 'delivery-failed'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** A group request the service refused; `cycle` lists the member names that form the cycle. */
    'agent-group/refused': { readonly code: AgentGroupErrorCode; readonly cycle?: readonly string[] }
  }
}

/** One long-lived agent of a group. */
export interface AgentGroupMember {
  readonly id: AgentGroupMemberId
  /** Unique within the group; the model names members by it. */
  readonly name: string
  /** What this member is responsible for, shown to superiors, subordinates, and the user. */
  readonly role: string
  /** `created` members get their Session on first use; `attached` members joined with an existing Session. */
  readonly origin: 'created' | 'attached'
  /** Preset of a `created` member's Session; absent selects the Host default. */
  readonly agentPreset?: string
  /** The member's resident Session. */
  readonly sessionId: SessionId
}

/** One directed reporting line: `superior` assigns to `subordinate`, `subordinate` reports to `superior`. */
export interface AgentGroupEdge {
  readonly superior: AgentGroupMemberId
  readonly subordinate: AgentGroupMemberId
}

/** One group: its members and the acyclic reporting lines between them. */
export interface AgentGroup {
  readonly id: AgentGroupId
  readonly title: string
  readonly description: string
  /** Working directory of Sessions created for members; absent selects the Host default. */
  readonly cwd?: string
  readonly members: readonly AgentGroupMember[]
  readonly edges: readonly AgentGroupEdge[]
  /** Incremented by every change to this group; edits compare it. */
  readonly revision: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** One task a superior assigned to a direct subordinate. */
export interface AgentGroupAssignment {
  readonly id: AgentGroupAssignmentId
  readonly groupId: AgentGroupId
  readonly from: AgentGroupMemberId
  readonly to: AgentGroupMemberId
  /** First line of the task, bounded for lists. */
  readonly summary: string
  readonly status: 'open' | 'reported'
  readonly createdAt: string
  readonly reportedAt?: string
}

/** Every group and retained assignment, as one frame of the `watch` stream. */
export interface AgentGroupSnapshot {
  readonly groups: readonly AgentGroup[]
  readonly assignments: readonly AgentGroupAssignment[]
}

/** Fields of a new group. */
export interface AgentGroupCreateRequest {
  readonly title: string
  readonly description?: string
  readonly cwd?: string
}

/** Changed fields of one group; an empty `cwd` clears it. */
export interface AgentGroupUpdateRequest {
  readonly groupId: AgentGroupId
  readonly title?: string
  readonly description?: string
  readonly cwd?: string
}

/** Names one group. */
export interface AgentGroupRef {
  readonly groupId: AgentGroupId
}

/** Names one member of one group. */
export interface AgentGroupMemberRef {
  readonly groupId: AgentGroupId
  readonly memberId: AgentGroupMemberId
}

/** Fields of a member created inside the group. */
export interface AgentGroupAddMemberRequest {
  readonly groupId: AgentGroupId
  readonly name: string
  readonly role: string
  readonly agentPreset?: string
}

/** An existing Session joining a group as a member. */
export interface AgentGroupAttachRequest {
  readonly groupId: AgentGroupId
  readonly sessionId: SessionId
  readonly name: string
  readonly role: string
}

/** Changed fields of one member; `agentPreset` applies to `created` members whose Session does not exist yet. */
export interface AgentGroupUpdateMemberRequest extends AgentGroupMemberRef {
  readonly name?: string
  readonly role?: string
  readonly agentPreset?: string
}

/** The complete replacement edge set of one group, guarded by the revision the editor read. */
export interface AgentGroupSetEdgesRequest {
  readonly groupId: AgentGroupId
  readonly edges: readonly AgentGroupEdge[]
  readonly expectedRevision: number
}

/** One neighbor of a member, as the model sees it. */
export interface AgentGroupNeighbor {
  readonly name: string
  readonly role: string
  /** Whether the neighbor's Session is running a turn now. */
  readonly running: boolean
}

/** One open assignment, as the model sees it. */
export interface AgentGroupOpenAssignment {
  readonly id: AgentGroupAssignmentId
  /** Name of the other member: the superior for received work, the subordinate for given work. */
  readonly member: string
  readonly summary: string
}

/** A member's own position in its group. */
export interface AgentGroupMemberView {
  readonly group: string
  readonly description: string
  readonly name: string
  readonly role: string
  readonly superiors: readonly AgentGroupNeighbor[]
  readonly subordinates: readonly AgentGroupNeighbor[]
  /** Open assignments this member must report on. */
  readonly received: readonly AgentGroupOpenAssignment[]
  /** Open assignments this member gave and has no report for yet. */
  readonly given: readonly AgentGroupOpenAssignment[]
}
