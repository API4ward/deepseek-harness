/** State and actions the agent group page receives through slot injection. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {
  AgentGroup, AgentGroupAddMemberRequest, AgentGroupAssignment, AgentGroupAttachRequest, AgentGroupId, AgentGroupMemberRef,
  AgentGroupSetEdgesRequest, AgentGroupUpdateMemberRequest, AgentGroupUpdateRequest,
} from '@deepseek-ai/dsh-alfredgo-agent-group/client'
import type { AgentGroupKey } from './locales.ts'

/** Failure text the page shows: a dictionary key and its parameters. */
export interface UiFailure {
  readonly key: AgentGroupKey
  readonly params: Readonly<Record<string, string>>
}

/** Every group and retained assignment, with the state of the stream that delivers them. */
export interface GroupState {
  /** `loading` before the first frame, `failed` while the stream is reconnecting or has ended. */
  readonly status: 'loading' | 'ready' | 'failed'
  readonly groups: readonly AgentGroup[]
  readonly assignments: readonly AgentGroupAssignment[]
}

/** One selectable agent preset. */
export interface PresetOption {
  readonly id: string
  readonly name: string
}

/** Everything bound into the group page and the Session-row mark. */
export interface GroupInjected {
  hooks: {
    groups: ObservableSnapshot<GroupState>
    failure: ObservableSnapshot<UiFailure | null>
    presets: ObservableSnapshot<readonly PresetOption[]>
  }
  /** Create a group. @returns its id, or undefined after a reported failure. */
  createGroup: (title: string) => Promise<AgentGroupId | undefined>
  /** Each change resolves to whether the Host applied it; a refusal is reported through `failure`. */
  updateGroup: (request: AgentGroupUpdateRequest) => Promise<boolean>
  removeGroup: (groupId: AgentGroupId) => Promise<boolean>
  addMember: (request: AgentGroupAddMemberRequest) => Promise<boolean>
  attachSession: (request: AgentGroupAttachRequest) => Promise<boolean>
  updateMember: (request: AgentGroupUpdateMemberRequest) => Promise<boolean>
  removeMember: (request: AgentGroupMemberRef) => Promise<boolean>
  resetMember: (request: AgentGroupMemberRef) => Promise<boolean>
  setEdges: (request: AgentGroupSetEdgesRequest) => Promise<boolean>
  /** Create the member's Session when it has none yet, then show it. */
  openMember: (request: AgentGroupMemberRef) => Promise<void>
  /** Show a failure the page found before asking the Host, such as a cycle in the draft. */
  reportFailure: (failure: UiFailure) => void
  clearFailure: () => void
}
