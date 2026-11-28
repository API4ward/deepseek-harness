/** Browser copy of the Host's groups: follows the `watch` stream and sends each change through the Remote. */
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  AgentGroup, AgentGroupAddMemberRequest, AgentGroupAttachRequest, AgentGroupCreateRequest, AgentGroupErrorCode, AgentGroupMemberRef,
  AgentGroupRef, AgentGroupSetEdgesRequest, AgentGroupSnapshot, AgentGroupUpdateMemberRequest, AgentGroupUpdateRequest,
} from '@deepseek-ai/dsh-alfredgo-agent-group/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { GroupInjected, GroupState, UiFailure } from './group-actions.ts'

/** Refusal codes that have their own sentence; the model-tool codes never reach this page. */
const WORDED = [
  'group-not-found', 'member-not-found', 'invalid-input', 'name-in-use', 'session-in-use', 'session-unavailable', 'conflict',
  'limit',
] as const satisfies readonly AgentGroupErrorCode[]

/**
 * Map a Remote failure to the dictionary key the page shows.
 * @param error - failure of one group Remote call.
 * @returns key and parameters.
 */
export function describeFailure(error: RemoteFailure): UiFailure {
  if (error.code !== 'agent-group/refused') return { key: 'error.unknown', params: { detail: error.message } }
  const { code, cycle } = error.details
  if (code === 'cycle') return { key: 'relations.cycle', params: { cycle: (cycle ?? []).join(' → ') } }
  if (code === 'delivery-failed') return { key: 'error.delivery-failed', params: { detail: error.message } }
  const worded = WORDED.find(known => known === code)
  return worded === undefined ? { key: 'error.unknown', params: { detail: error.message } } : { key: `error.${worded}`, params: {} }
}

/** One open `watch` stream: its frames and how to close it. */
export interface GroupFrames extends AsyncIterable<{ readonly value: AgentGroupSnapshot; accept(): void }> {
  /** Close the stream. */
  dispose(): Promise<void>
}

/** Remote calls of the Host group service. */
export interface GroupRemote {
  createGroup: (request: AgentGroupCreateRequest) => Promise<RemoteResult<AgentGroup>>
  updateGroup: (request: AgentGroupUpdateRequest) => Promise<RemoteResult<AgentGroup>>
  removeGroup: (request: AgentGroupRef) => Promise<RemoteResult<void>>
  addMember: (request: AgentGroupAddMemberRequest) => Promise<RemoteResult<AgentGroup>>
  attachSession: (request: AgentGroupAttachRequest) => Promise<RemoteResult<AgentGroup>>
  updateMember: (request: AgentGroupUpdateMemberRequest) => Promise<RemoteResult<AgentGroup>>
  removeMember: (request: AgentGroupMemberRef) => Promise<RemoteResult<AgentGroup>>
  resetMemberSession: (request: AgentGroupMemberRef) => Promise<RemoteResult<AgentGroup>>
  setEdges: (request: AgentGroupSetEdgesRequest) => Promise<RemoteResult<AgentGroup>>
  openMember: (request: AgentGroupMemberRef) => Promise<RemoteResult<{ readonly sessionId: SessionId }>>
}

/** What the source needs from the browser runtime. */
export interface GroupSourceOptions {
  readonly remote: GroupRemote
  /** Open the reconnecting `watch` stream; `carrierFailed` runs each time the connection is lost. */
  readonly watch: (carrierFailed: () => void) => GroupFrames
  /** Show one Session in the workspace. */
  readonly openSession: (sessionId: SessionId) => void
  /** Record a stream failure that ends observation. */
  readonly warn: (error: unknown) => void
}

/** The page's group state, its failure notice, and the actions that change groups on the Host. */
export class GroupSource {
  /** Groups and assignments of the latest frame. */
  readonly state: SnapshotStore<GroupState> = createSnapshotStore<GroupState>({ status: 'loading', groups: [], assignments: [] })
  /** The failure of the latest refused action, until dismissed or followed by a success. */
  readonly failure: SnapshotStore<UiFailure | null> = createSnapshotStore<UiFailure | null>(null)

  private disposed = false
  private readonly frames: GroupFrames
  private readonly observing: Promise<void>

  /** @param options - Remote calls, the stream opener, and navigation. */
  constructor(private readonly options: GroupSourceOptions) {
    this.frames = options.watch(() => { this.state.set({ ...this.state.getSnapshot(), status: 'failed' }) })
    this.observing = this.observe()
  }

  /** Actions bound into the page; `hooks` are added by the plugin entry. */
  readonly actions: Omit<GroupInjected, 'hooks'> = {
    createGroup: async (title) => {
      const result = await this.options.remote.createGroup({ title })
      return this.settled(result) ? result.value.id : undefined
    },
    updateGroup: async request => this.settled(await this.options.remote.updateGroup(request)),
    removeGroup: async groupId => this.settled(await this.options.remote.removeGroup({ groupId })),
    addMember: async request => this.settled(await this.options.remote.addMember(request)),
    attachSession: async request => this.settled(await this.options.remote.attachSession(request)),
    updateMember: async request => this.settled(await this.options.remote.updateMember(request)),
    removeMember: async request => this.settled(await this.options.remote.removeMember(request)),
    resetMember: async request => this.settled(await this.options.remote.resetMemberSession(request)),
    setEdges: async request => this.settled(await this.options.remote.setEdges(request)),
    openMember: async (request) => {
      const result = await this.options.remote.openMember(request)
      if (this.settled(result)) this.options.openSession(result.value.sessionId)
    },
    reportFailure: (failure) => { this.failure.set(failure) },
    clearFailure: () => { this.failure.set(null) },
  }

  /**
   * Stop following the Host.
   * @returns after the stream closes.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    await this.frames.dispose()
    await this.observing
  }

  private settled<T>(result: RemoteResult<T>): result is { readonly ok: true; readonly value: T } {
    if (this.disposed) return false
    this.failure.set(result.ok ? null : describeFailure(result.error))
    return result.ok
  }

  private async observe(): Promise<void> {
    try {
      for await (const item of this.frames) {
        // A frame the stream yielded just before disposal must not reach the disposed page.
        if (this.disposed) return
        this.state.set({ status: 'ready', groups: item.value.groups, assignments: item.value.assignments })
        item.accept()
      }
    } catch (error) {
      if (this.disposed) return
      this.state.set({ ...this.state.getSnapshot(), status: 'failed' })
      this.options.warn(error)
    }
  }
}
