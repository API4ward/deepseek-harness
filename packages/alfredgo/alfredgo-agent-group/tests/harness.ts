/** Agent group tests use real domain storage, real Session and Agent registries, and a fake Session controller. */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox, unsupportedModel } from '@deepseek-ai/dsh-agent-loop-testkit'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SESSION_FORMAT_VERSION, type SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistenceRevision, SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { vi } from 'vitest'
import type { Mock } from 'vitest'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import AgentGroupService, { type Config } from '../src/index.ts'

/** Agent fixture whose delivery entries are spies. */
export interface HarnessAgent extends Agent {
  followup: Mock<(message: UserMessage) => void>
  steer: Mock<(message: UserMessage) => void>
  inject: Mock<(message: UserMessage) => void>
}

/** The limits the plugin applies when cordis.yml sets none. */
export const DEFAULT_CONFIG: Config = { maxMembersPerGroup: 50, maxOpenAssignmentsPerMember: 20, assignmentHistoryRecords: 200 }

/** Brand a Session id literal. */
export const sid = (id: string): SessionId => brandString<SessionId>(id)

/**
 * Build the services an agent group needs over in-memory storage.
 * @param options - media to reopen, config overrides, and whether a Session controller exists.
 * @returns the service and the fakes that stand in for Session persistence and activation.
 */
export async function harness(options: { pool?: MemoryMediaPool; config?: Partial<Config>; sessionController?: false } = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(Storage)
  const pool = options.pool ?? new MemoryMediaPool()
  const backend = new MemoryStorageBackend(pool)
  ctx.effect(() => ctx.storage.backend.register('fixture', backend))
  ctx.effect(() => async () => { await backend.close() })
  const facility = new DomainFacility(ctx, { backend: 'fixture' })
  ctx.effect(() => {
    const unmount = ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    return async () => { await facility.closeAll(); unmount() }
  })
  /** Sessions that exist: stored headers by id, with their delegation depth. */
  const stored = new Map<SessionId, number>()
  /** Live Agents the fake controller resolves. */
  const live = new Map<SessionId, HarnessAgent>()
  const archived: SessionId[] = []
  const agent = (id: string, status: Agent['status'] = 'idle'): HarnessAgent => {
    const session = ctx.sessions.create(sid(id))
    const value: HarnessAgent = {
      id: session.id, session, ctx: ctx.extend(), options: {}, status, model: unsupportedModel(), inbox: unsupportedInbox(),
      followup: vi.fn<(message: UserMessage) => void>(), steer: vi.fn<(message: UserMessage) => void>(),
      inject: vi.fn<(message: UserMessage) => void>(),
      send() {}, cancel() {}, whenIdle: async () => {}, runMaintenance: operation => operation(new AbortController().signal),
    }
    stored.set(session.id, 0)
    live.set(session.id, value)
    return value
  }
  const stat = vi.fn<Context['sessionPersistence']['stat']>(async (sessionId): Promise<SessionPersistenceSnapshot | undefined> => {
    const depth = stored.get(sessionId)
    return depth === undefined ? undefined : {
      header: {
        version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 0, isSeeded: false, ...(depth === 0 ? {} : { delegationDepth: depth }),
      },
      revision: brandString<SessionPersistenceRevision>(`test:${sessionId}`),
    }
  })
  const resolveAgent = vi.fn<Context['sessionController']['resolveAgent']>(async (sessionId) => {
    const found = live.get(sessionId)
    return found === undefined
      ? { error: new RemoteError('session/not-found', `no session ${sessionId}`, { sessionId }) }
      : { agent: found }
  })
  const create = vi.fn<Context['sessionController']['create']>(async (request) => {
    agent(request.sessionId!)
    return { sessionId: request.sessionId! }
  })
  if (options.sessionController !== false) ctx.provide('sessionController', { resolveAgent, create } as never)
  const flush = vi.fn(async () => {})
  ctx.on('session/flush', flush)
  ctx.provide('sessionPersistence', { stat } as never)
  ctx.provide('workspaceRegistry', { get archivedSessionIds() { return archived }, resolveByPath: async () => undefined } as never)
  await ctx.plugin(AgentGroupService, { ...DEFAULT_CONFIG, ...options.config })
  return { ctx, service: ctx.agentGroups, pool, agent, stored, live, archived, stat, resolveAgent, create, flush }
}
