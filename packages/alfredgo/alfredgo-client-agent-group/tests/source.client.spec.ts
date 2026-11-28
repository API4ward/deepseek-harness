import { describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  AgentGroup, AgentGroupErrorCode, AgentGroupId, AgentGroupMemberId, AgentGroupSnapshot,
} from '@deepseek-ai/dsh-alfredgo-agent-group/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describeFailure, GroupSource, type GroupFrames, type GroupRemote } from '../src/client/source.ts'

const group: AgentGroup = {
  id: 'group-1' as AgentGroupId, title: 'Release', description: '', members: [], edges: [], revision: 1,
  createdAt: '2026-11-28T00:00:00.000Z', updatedAt: '2026-11-28T00:00:00.000Z',
}
const ok = <T>(value: T): Promise<RemoteResult<T>> => Promise.resolve({ ok: true, value })
const refused = (code: AgentGroupErrorCode, message: string = code, cycle?: readonly string[]): RemoteFailure =>
  new RemoteError('agent-group/refused', message, { code, ...cycle === undefined ? {} : { cycle } })

/** A hand-fed `watch` stream. */
function frames() {
  const queue: (AgentGroupSnapshot | Error)[] = []
  let wake: (() => void) | undefined
  let closed = false
  const accepted = vi.fn()
  const stream: GroupFrames = {
    async* [Symbol.asyncIterator]() {
      for (;;) {
        while (queue.length === 0 && !closed) await new Promise<void>((resolve) => { wake = resolve })
        if (closed) return
        const next = queue.shift()!
        if (next instanceof Error) throw next
        yield { value: next, accept: accepted }
      }
    },
    dispose: () => { closed = true; wake?.(); return Promise.resolve() },
  }
  return { stream, accepted, push: (value: AgentGroupSnapshot | Error) => { queue.push(value); wake?.() } }
}

function setup(remote: Partial<GroupRemote> = {}) {
  const feed = frames()
  let carrierFailed = (): void => {}
  const openSession = vi.fn()
  const warn = vi.fn()
  const source = new GroupSource({
    remote: remote as GroupRemote,
    watch: (failed) => { carrierFailed = failed; return feed.stream },
    openSession,
    warn,
  })
  return { source, feed, openSession, warn, carrierFailed: () => { carrierFailed() } }
}

describe('describeFailure', () => {
  it('words each management refusal and names the members of a cycle', () => {
    expect(describeFailure(refused('name-in-use'))).toEqual({ key: 'error.name-in-use', params: {} })
    expect(describeFailure(refused('conflict'))).toEqual({ key: 'error.conflict', params: {} })
    expect(describeFailure(refused('cycle', 'cycle', ['lead', 'dev', 'lead'])))
      .toEqual({ key: 'relations.cycle', params: { cycle: 'lead → dev → lead' } })
    expect(describeFailure(refused('cycle'))).toEqual({ key: 'relations.cycle', params: { cycle: '' } })
    expect(describeFailure(refused('delivery-failed', 'no provider')))
      .toEqual({ key: 'error.delivery-failed', params: { detail: 'no provider' } })
  })

  it('shows the Host message for a refusal without its own sentence and for other Remote failures', () => {
    expect(describeFailure(refused('not-a-member', 'This session is not in a group.')))
      .toEqual({ key: 'error.unknown', params: { detail: 'This session is not in a group.' } })
    expect(describeFailure(new RemoteError('gateway/internal', 'connection lost', {})))
      .toEqual({ key: 'error.unknown', params: { detail: 'connection lost' } })
  })
})

describe('GroupSource', () => {
  it('shows each frame of the stream and accepts it', async () => {
    const { source, feed } = setup()
    expect(source.state.getSnapshot()).toEqual({ status: 'loading', groups: [], assignments: [] })
    feed.push({ groups: [group], assignments: [] })
    await vi.waitFor(() => { expect(source.state.getSnapshot().status).toBe('ready') })
    expect(source.state.getSnapshot().groups).toEqual([group])
    expect(feed.accepted).toHaveBeenCalledTimes(1)
    await source.dispose()
  })

  it('keeps the last groups while the connection is lost and after the stream fails', async () => {
    const { source, feed, warn, carrierFailed } = setup()
    feed.push({ groups: [group], assignments: [] })
    await vi.waitFor(() => { expect(source.state.getSnapshot().status).toBe('ready') })
    carrierFailed()
    expect(source.state.getSnapshot()).toEqual({ status: 'failed', groups: [group], assignments: [] })
    feed.push({ groups: [], assignments: [] })
    await vi.waitFor(() => { expect(source.state.getSnapshot().status).toBe('ready') })
    const failure = new Error('no agentGroups service')
    feed.push(failure)
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(failure) })
    expect(source.state.getSnapshot().status).toBe('failed')
    await source.dispose()
  })

  it('returns the new group id and clears an earlier failure', async () => {
    const create = vi.fn(() => ok(group))
    const { source } = setup({ createGroup: create })
    source.actions.reportFailure({ key: 'error.limit', params: {} })
    await expect(source.actions.createGroup('Release')).resolves.toBe(group.id)
    expect(create).toHaveBeenCalledWith({ title: 'Release' })
    expect(source.failure.getSnapshot()).toBeNull()
    await source.dispose()
  })

  it('reports a refusal and resolves false', async () => {
    const error = refused('name-in-use')
    const answer = (): Promise<RemoteResult<AgentGroup>> => Promise.resolve({ ok: false, error })
    const { source } = setup({
      createGroup: answer, updateGroup: answer, addMember: answer, attachSession: answer, updateMember: answer, removeMember: answer,
      resetMemberSession: answer, setEdges: answer, removeGroup: () => Promise.resolve({ ok: false, error }),
    })
    const ref = { groupId: group.id, memberId: 'member-1' as AgentGroupMemberId }
    await expect(source.actions.createGroup('x')).resolves.toBeUndefined()
    await expect(source.actions.updateGroup({ groupId: group.id, title: 'x' })).resolves.toBe(false)
    await expect(source.actions.removeGroup(group.id)).resolves.toBe(false)
    await expect(source.actions.addMember({ groupId: group.id, name: 'dev', role: '' })).resolves.toBe(false)
    await expect(source.actions.attachSession({ groupId: group.id, sessionId: 's' as SessionId, name: 'dev', role: '' })).resolves.toBe(false)
    await expect(source.actions.updateMember({ ...ref, name: 'dev' })).resolves.toBe(false)
    await expect(source.actions.removeMember(ref)).resolves.toBe(false)
    await expect(source.actions.resetMember(ref)).resolves.toBe(false)
    await expect(source.actions.setEdges({ groupId: group.id, edges: [], expectedRevision: 1 })).resolves.toBe(false)
    expect(source.failure.getSnapshot()).toEqual({ key: 'error.name-in-use', params: {} })
    source.actions.clearFailure()
    expect(source.failure.getSnapshot()).toBeNull()
    await source.dispose()
  })

  it('opens the Session the Host resolved for a member, and none after a refusal', async () => {
    const ref = { groupId: group.id, memberId: 'member-1' as AgentGroupMemberId }
    const openMember = vi.fn<GroupRemote['openMember']>(() => ok({ sessionId: 'session-9' as SessionId }))
    const { source, openSession } = setup({ openMember })
    await source.actions.openMember(ref)
    expect(openSession).toHaveBeenCalledWith('session-9')
    openMember.mockResolvedValueOnce({ ok: false, error: refused('delivery-failed', 'no provider') })
    await source.actions.openMember(ref)
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(source.failure.getSnapshot()).toEqual({ key: 'error.delivery-failed', params: { detail: 'no provider' } })
    await source.dispose()
  })

  it('ignores frames and answers that arrive after disposal', async () => {
    let answer: (result: RemoteResult<AgentGroup>) => void = () => {}
    const { source, feed } = setup({ createGroup: () => new Promise((resolve) => { answer = resolve }) })
    const creating = source.actions.createGroup('Release')
    await source.dispose()
    feed.push({ groups: [group], assignments: [] })
    answer({ ok: true, value: group })
    await expect(creating).resolves.toBeUndefined()
    expect(source.state.getSnapshot().status).toBe('loading')
  })
})
