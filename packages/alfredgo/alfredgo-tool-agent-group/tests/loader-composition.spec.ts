/**
 * The group service and the group tools booted from a cordis.yml through the real Loader, over the real tool
 * runtime, system prompt, Session persistence, and JSON storage. The Agent is a fixture; no model runs.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox, unsupportedModel } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentGroupService from '@deepseek-ai/dsh-alfredgo-agent-group'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/types'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, expect, it } from 'vitest'
import * as ToolAgentGroup from '../src/index.ts'
import { GROUP_POLICY } from '../src/policy.ts'

const SIGNAL = new AbortController().signal
const GROUP_TOOLS = ['group_assign', 'group_members', 'group_report']

const roots: string[] = []
const contexts = new Set<Context>()
afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Create a directory removed after the test. */
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-agent-group-loader-'))
  roots.push(root)
  return root
}

/**
 * Boot a cordis.yml whose group service row carries the given config lines.
 * @param root - directory of the configuration, Session logs, and storage; reuse it to reopen stored groups.
 * @param configLines - YAML lines nested under the group service's `config:` key.
 * @returns the booted context.
 */
async function boot(root: string, configLines: readonly string[] = []): Promise<Context> {
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-session-persistence-jsonl'",
    '  config:',
    `    root: ${JSON.stringify(join(root, 'sessions'))}`,
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-tool-executor-native'",
    "- name: '@deepseek-ai/dsh-storage'",
    "- name: '@deepseek-ai/dsh-storage-json'",
    '  config:',
    `    root: ${JSON.stringify(join(root, 'storages'))}`,
    "- name: '@deepseek-ai/dsh-storage-domain'",
    '  config:',
    '    backend: json',
    "- name: '@deepseek-ai/dsh-alfredgo-agent-group'",
    ...configLines.length > 0 ? ['  config:', ...configLines] : [],
    "- name: '@deepseek-ai/dsh-alfredgo-tool-agent-group'",
    '',
  ].join('\n'))

  const ctx = new Context()
  contexts.add(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-tool-executor-native', NativeToolExecutor],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-alfredgo-agent-group', AgentGroupService],
    ['@deepseek-ai/dsh-alfredgo-tool-agent-group', ToolAgentGroup],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as never
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  return ctx
}

/** Register an idle Agent fixture over a real Session and collect the messages added to it without a turn. */
async function agent(ctx: Context, id: string): Promise<{ agent: Agent; injected: UserMessage[] }> {
  const session = ctx.sessions.create(brandString<SessionId>(id))
  const injected: UserMessage[] = []
  // The tool runtime admits a request only for the scope keyed by the Agent itself, so the scope is made from the Agent.
  const scope: { ctx?: Context } = {}
  const value: Agent = {
    id: session.id, options: {}, session, model: unsupportedModel(), inbox: unsupportedInbox(), status: 'idle',
    get ctx() {
      if (scope.ctx === undefined) throw new Error('the Agent fixture has no scope yet')
      return scope.ctx
    },
    followup: () => {}, steer: () => {}, inject: (message) => { injected.push(message) }, send: () => {}, cancel() {},
    runMaintenance: task => task(SIGNAL),
    whenIdle: () => Promise.resolve(),
  }
  scope.ctx = createScope(ctx, value).ctx
  await ctx.agents.register(value)
  return { agent: value, injected }
}

/** Group tool names and the rendered system prompt of one request of `owner`. */
async function request(ctx: Context, owner: Agent): Promise<{ tools: string[]; prompt: string }> {
  const scope = scopeOf(owner.ctx)
  if (scope === undefined) throw new Error('expected Agent scope')
  const toolSet = await ctx.tools.resolve({ agent: owner, modelSelection: { provider: 'mock', model: 'mock' }, signal: SIGNAL })
  try {
    const assembled = await ctx.systemPrompt.assemble({ scope, agent: owner, toolSet })
    const tools = assembled.tools.map(tool => tool.name).filter(name => GROUP_TOOLS.includes(name)).sort()
    return { tools, prompt: renderPrompt(assembled) }
  } finally {
    toolSet.dispose()
  }
}

/** Run `group_members` as `owner` under the admission of one request and return its text result. */
async function groupMembers(ctx: Context, owner: Agent): Promise<{ isError: boolean; text: string }> {
  const toolSet = await ctx.tools.resolve({ agent: owner, modelSelection: { provider: 'mock', model: 'mock' }, signal: SIGNAL })
  try {
    const result = await executeToolFixture(ctx, {
      signal: SIGNAL, callId: brandString<ToolCallId>(`members-${owner.id}`), name: 'group_members', arguments: {}, agent: owner, toolSet,
    })
    return { isError: result.isError, text: result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('') }
  } finally {
    toolSet.dispose()
  }
}

it('offers the group tools and guidance to a Session once it joins a group, and withdraws them when it leaves', async () => {
  const ctx = await boot(await tempRoot())
  const lead = await agent(ctx, 'lead-session')
  const qa = await agent(ctx, 'qa-session')
  expect(await request(ctx, lead.agent)).toMatchObject({ tools: [] })
  expect((await request(ctx, lead.agent)).prompt).not.toContain('agent group')

  let group = await ctx.agentGroups.create({ title: 'Product', description: 'Ships the app' })
  group = await ctx.agentGroups.attachSession({ groupId: group.id, sessionId: lead.agent.id, name: 'lead', role: 'Plans the work' })
  group = await ctx.agentGroups.attachSession({ groupId: group.id, sessionId: qa.agent.id, name: 'qa', role: 'Checks the work' })
  const [leadMember, qaMember] = group.members
  if (leadMember === undefined || qaMember === undefined) throw new Error('expected two members')
  await ctx.agentGroups.setEdges({
    groupId: group.id, expectedRevision: group.revision, edges: [{ superior: leadMember.id, subordinate: qaMember.id }],
  })

  const member = await request(ctx, lead.agent)
  expect(member.tools).toEqual(GROUP_TOOLS)
  expect(member.prompt).toContain(GROUP_POLICY)
  expect(JSON.parse((await groupMembers(ctx, qa.agent)).text)).toEqual({
    group: 'Product', description: 'Ships the app', name: 'qa', role: 'Checks the work',
    superiors: [{ name: 'lead', role: 'Plans the work', running: false }], subordinates: [], received: [], given: [],
  })
  await expect.poll(() => qa.injected.length).toBe(1)
  expect(qa.injected[0]?.content).toEqual([{
    type: 'text',
    text: 'The user added this conversation to group "Product" as member "qa". Call group_members to see your superiors and subordinates.',
  }])

  await ctx.agentGroups.removeMember({ groupId: group.id, memberId: qaMember.id })
  expect((await request(ctx, qa.agent)).tools).toEqual([])
  expect((await groupMembers(ctx, qa.agent)).isError).toBe(true)
})

it('applies the member limit from cordis.yml and reopens stored groups after a restart', async () => {
  const root = await tempRoot()
  const first = await boot(root, ['    maxMembersPerGroup: 2'])
  const group = await first.agentGroups.create({ title: 'Product' })
  await first.agentGroups.addMember({ groupId: group.id, name: 'lead', role: '' })
  await first.agentGroups.addMember({ groupId: group.id, name: 'dev', role: '' })
  await expect(first.agentGroups.addMember({ groupId: group.id, name: 'qa', role: '' })).rejects.toMatchObject({ code: 'limit' })
  await first.fiber.dispose()
  contexts.delete(first)

  const second = await boot(root, ['    maxMembersPerGroup: 2'])
  const snapshot = await second.agentGroups.snapshot()
  expect(snapshot.groups.map(stored => [stored.title, stored.members.map(member => member.name)])).toEqual([['Product', ['lead', 'dev']]])
})

it('fails loading when a limit in cordis.yml is out of range', async () => {
  await expect(boot(await tempRoot(), ['    maxMembersPerGroup: 0'])).rejects.toThrow('maxMembersPerGroup')
})
