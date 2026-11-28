/** Group tools run through the production agent loop: members assign and report across real Sessions. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentGroupService from '@deepseek-ai/dsh-alfredgo-agent-group'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import * as toolAgentGroup from '../src/index.ts'
import { GROUP_POLICY } from '../src/policy.ts'

const SIGNAL = new AbortController().signal
const GROUP_TOOLS = ['group_assign', 'group_members', 'group_report']
const sid = (id: string): SessionId => brandString<SessionId>(id)

const roots: string[] = []
const contexts = new Set<Context>()
afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

type Script = ConstructorParameters<typeof MockAdapter>[0]

/** Mount the loop, group service, and group tools; member Sessions are created through the loop on first use. */
async function setup(scripts: { lead: Script; dev?: Script }) {
  const ctx = new Context()
  contexts.add(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-tool-agent-group-'))
  roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(Storage)
  const backend = new MemoryStorageBackend(new MemoryMediaPool())
  ctx.effect(() => ctx.storage.backend.register('fixture', backend))
  const facility = new DomainFacility(ctx, { backend: 'fixture' })
  ctx.effect(() => {
    const unmount = ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    return async () => { await facility.closeAll(); unmount() }
  })
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapters = { lead: new MockAdapter(scripts.lead), dev: new MockAdapter(scripts.dev ?? []) }
  ctx.llm.registerAdapter(['lead'], adapters.lead)
  ctx.llm.registerAdapter(['dev'], adapters.dev)
  // The Web Session controller is replaced by the loop itself: resolve a live Agent, or create one on the `dev` route.
  ctx.provide('sessionController', {
    resolveAgent: async (sessionId: SessionId) => {
      const agent = ctx.agents.get(sessionId)
      return agent === undefined ? { error: new RemoteError('session/not-found', 'missing', { sessionId }) } : { agent }
    },
    create: async (request: { sessionId: SessionId }) => {
      await ctx.agentLoop.create(request.sessionId, { provider: 'dev', model: 'mock' })
      return { sessionId: request.sessionId }
    },
  } as never)
  await ctx.plugin(AgentGroupService, { maxMembersPerGroup: 50, maxOpenAssignmentsPerMember: 20, assignmentHistoryRecords: 200 })
  const fiber = await ctx.plugin(toolAgentGroup)
  const lead = await ctx.agentLoop.create(sid('lead-session'), { provider: 'lead', model: 'mock' })
  let group = await ctx.agentGroups.create({ title: 'Product', description: 'Ships the app' })
  group = await ctx.agentGroups.attachSession({ groupId: group.id, sessionId: lead.id, name: 'lead', role: 'Plans the work' })
  group = await ctx.agentGroups.addMember({ groupId: group.id, name: 'dev', role: 'Writes code' })
  const [leadMember, devMember] = group.members
  group = await ctx.agentGroups.setEdges({
    groupId: group.id, expectedRevision: group.revision, edges: [{ superior: leadMember!.id, subordinate: devMember!.id }],
  })
  return { ctx, fiber, lead, adapters, group, devSession: devMember!.sessionId }
}

async function assembly(ctx: Context, agent: Agent) {
  const scope = scopeOf(agent.ctx)
  if (scope === undefined) throw new Error('expected Agent scope')
  const toolSet = await ctx.tools.resolve({ agent, modelSelection: { provider: 'mock', model: 'mock' }, signal: SIGNAL })
  try {
    return await ctx.systemPrompt.assemble({ scope, agent, toolSet })
  } finally {
    toolSet.dispose()
  }
}

const groupTools = (tools: readonly { name: string }[]): string[] =>
  tools.map(tool => tool.name).filter(name => GROUP_TOOLS.includes(name)).sort()

/** Text of every tool result and user-role message in one request, in order. */
function inputs(request: GenerateOptions): string[] {
  return request.messages.filter(message => message.role === 'user' || message.role === 'tool')
    .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
}

it('shows the group tools and guidance to members only', async () => {
  const { ctx, lead } = await setup({ lead: [] })
  const solo = await ctx.agentLoop.create(sid('solo-session'), { provider: 'lead', model: 'mock' })
  const member = await assembly(ctx, lead)
  expect(groupTools(member.tools)).toEqual(GROUP_TOOLS)
  expect(renderPrompt(member)).toContain(GROUP_POLICY)
  const outsider = await assembly(ctx, solo)
  expect(groupTools(outsider.tools)).toEqual([])
  expect(renderPrompt(outsider)).not.toContain('agent group')
})

it('assigns to a subordinate Session and brings its report back to the superior', async () => {
  const assignmentId = (request: GenerateOptions): string => /assignment (a-[0-9a-f]+)\)/.exec(inputs(request).join('\n'))![1]!
  const { ctx, lead, adapters, group, devSession } = await setup({
    lead: [
      toolCallResponse('call-1', 'group_members', {}),
      toolCallResponse('call-2', 'group_assign', { to: 'dev', task: 'Add the login form\nUse the existing auth API.' }),
      textResponse('Assigned; waiting for dev.'),
      textResponse('dev finished the login form.'),
    ],
    dev: [
      request => toolCallResponse('call-3', 'group_report', { report: 'Login form added in src/login.tsx.', assignment_id: assignmentId(request) }),
      textResponse('Reported.'),
    ],
  })
  lead.followup(createUserMessage({ content: [{ type: 'text', text: 'Ship the login page.' }], source: { kind: 'user' } }))
  // The report reaches the superior as steering while its turn is still open, or as a new turn once it is idle.
  const seen = (): string[] => adapters.lead.requests.flatMap(inputs)
  await vi.waitFor(() => { expect(seen().some(input => input.startsWith('Your subordinate'))).toBe(true) }, { timeout: 4000 })
  await lead.whenIdle()

  expect(JSON.parse(inputs(adapters.lead.requests[1]!).at(-1)!)).toEqual({
    group: 'Product', description: 'Ships the app', name: 'lead', role: 'Plans the work',
    superiors: [], subordinates: [{ name: 'dev', role: 'Writes code', running: false }], received: [], given: [],
  })
  const delivery = JSON.parse(seen().find(input => input.startsWith('{"assignment_id"'))!) as { assignment_id: string; delivered: boolean }
  expect(delivery.assignment_id).toMatch(/^a-[0-9a-f]{8}$/)
  expect(delivery.delivered).toBe(true)

  expect(inputs(adapters.dev.requests[0]!).at(-1)).toBe([
    `Your superior "lead" in group "Product" assigned you a task (assignment ${delivery.assignment_id}).`,
    'You are member "dev" of that group; your role: Writes code',
    `When it is done or cannot be done, call group_report with assignment_id "${delivery.assignment_id}".`,
    '',
    'Add the login form\nUse the existing auth API.',
  ].join('\n'))
  expect(groupTools(adapters.dev.requests[0]!.tools ?? [])).toEqual(GROUP_TOOLS)
  expect(seen()).toContain(
    `Your subordinate "dev" in group "Product" reported on assignment ${delivery.assignment_id} (Add the login form).\n\nLogin form added in src/login.tsx.`)

  // The report is delivered before the assignment is stored as reported, so the superior can see it first.
  await expect.poll(async () => (await ctx.agentGroups.snapshot()).assignments)
    .toMatchObject([{ id: delivery.assignment_id, groupId: group.id, status: 'reported' }])
  const dev = ctx.agents.get(devSession)!
  await dev.whenIdle()
  await ctx.sessions.flush(dev.session)
  await using stored = await ctx.sessionPersistence.open(devSession, 'read')
  expect(JSON.stringify((await stored.read()).events)).toContain('"kind":"agent-group","form":"relay"')
})

it('returns the direct subordinates when the model assigns to someone else', async () => {
  const { lead, adapters } = await setup({
    lead: [toolCallResponse('call-1', 'group_assign', { to: 'qa', task: 'Test it' }), textResponse('qa is not my subordinate.')],
  })
  lead.followup(createUserMessage({ content: [{ type: 'text', text: 'Get it tested.' }], source: { kind: 'user' } }))
  await lead.whenIdle()
  expect(inputs(adapters.lead.requests[1]!).at(-1)).toContain('"qa" is not your direct subordinate. Your direct subordinates are: "dev".')
})

it('removes the tools and guidance when the plugin unloads', async () => {
  const { ctx, fiber, lead } = await setup({ lead: [] })
  await fiber.dispose()
  const unloaded = await assembly(ctx, lead)
  expect(groupTools(unloaded.tools)).toEqual([])
  expect(renderPrompt(unloaded)).not.toContain(GROUP_POLICY)
})
