/** AgentSecret plugin over the real tool pipeline, a local filesystem, and a fake injector agent API. */

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { defineContentToolFixture, executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import * as SecretGuard from '../src/index.ts'
import { GUIDANCE } from '../src/guidance.ts'
import type { FetchLike } from '../src/injector.ts'

const SECRET = 'whoami'
const TOKEN = 'task-token-1'

interface FakeInjector {
  fetch: FetchLike
  calls: { route: string; body: Record<string, unknown> }[]
  /** The decision the approver gives to the next `/hook` request. */
  decision: 'approved' | 'denied'
  /** Make `/scan` fail. */
  scanFails: boolean
  /** Make every request fail to connect. */
  down: boolean
}

function fakeInjector(): FakeInjector {
  const fake: FakeInjector = {
    calls: [], decision: 'approved', scanFails: false, down: false,
    fetch: async (input, init) => {
      if (fake.down) throw new TypeError('fetch failed')
      const route = new URL(input).pathname
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      fake.calls.push({ route, body })
      const auth = (init.headers as Record<string, string>).Authorization
      if (auth !== `Bearer ${TOKEN}`) return Response.json({ error: 'unauthorized' }, { status: 403 })
      switch (route) {
        case '/scan': {
          if (fake.scanFails) return Response.json({ error: 'request_invalid' }, { status: 400 })
          const texts = body.texts as string[]
          return Response.json({
            found: texts.map((text) => {
              const bytes = Buffer.from(text, 'utf8')
              const at = bytes.indexOf(SECRET)
              return at < 0 ? [] : [[at, at + Buffer.byteLength(SECRET), 'test_passwd']]
            }),
          })
        }
        case '/hook':
          return Response.json({ operation_id: 'op_1', state: 'pending' })
        case '/status':
          return Response.json(fake.decision === 'approved'
            ? { operation_id: 'op_1', state: 'approved' }
            : { operation_id: 'op_1', state: 'denied', reason: 'user_denied', message: 'the user denied this request' })
        case '/take':
          return Response.json({ values: { test_passwd: SECRET } })
        default:
          return Response.json({ error: 'route_unavailable' }, { status: 403 })
      }
    },
  }
  return fake
}

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function setup(options: { down?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'alfredgo-secret-guard-'))
  roots.push(root)
  const injector = fakeInjector()
  injector.down = options.down === true
  const commands: string[][] = []
  const registered: { name: string; entry: unknown }[] = []
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  ctx.provide('mcpManager', {
    // The real manager ties a registration to the caller's lifetime; its own specs cover that.
    register: (name: string, entry: unknown) => { registered.push({ name, entry }) },
  })
  ctx.tools.register(defineContentToolFixture({
    name: 'echo',
    description: 'Echo text.',
    parameters: { text: { type: 'string', required: true }, file_path: { type: 'string' } },
    execute: async args => [{ type: 'text', text: args.text }],
  }))
  const config = {
    agentsecret: '/opt/agentsecret/bin/agentsecret',
    secretGuard: '/opt/agentsecret/bin/secret-guard',
    injectorState: join(root, 'injector-state'),
    project: 'alfredgo',
    tokenDir: join(root, 'tokens'),
    approvalWaitMs: 2_000,
  }
  const hooks: SecretGuard.SecretGuardHooks = {
    fetch: injector.fetch,
    run: async (_file, args) => {
      commands.push([...args])
      if (args.includes('task-create')) {
        const tokenFile = args[args.indexOf('--token-file') + 1] ?? ''
        await writeFile(tokenFile, `${TOKEN}\n`, { mode: 0o600 })
        return JSON.stringify({ task_id: 'task_1', token_file: tokenFile })
      }
      return 'Revoked.'
    },
  }
  const fiber = ctx.plugin({
    name: SecretGuard.name,
    inject: SecretGuard.inject,
    Config: SecretGuard.Config,
    apply: (inner: Context, resolved: SecretGuard.Config) => SecretGuard.apply(inner, resolved, hooks),
  }, config)
  const call = (name: string, args: Record<string, unknown>) => executeToolFixture(ctx, {
    callId: ToolCallId(`call-${name}`), name, arguments: args, signal: new AbortController().signal,
  })
  const text = (content: ContentBlock[]) => content.map(block => block.type === 'text' ? block.text : '').join('')
  return { ctx, root, injector, commands, registered, fiber, config, call, text }
}

it('fails to load while the injector is not running', async () => {
  const s = await setup({ down: true })
  await expect(s.fiber.await()).rejects.toThrow('AgentSecret injector is not running at http://127.0.0.1:8765')
  expect(s.commands).toEqual([])
})

it('creates a task, registers the MCP server and guidance, and revokes the task on unload', async () => {
  const s = await setup()
  await s.fiber.await()
  const create = s.commands[0] ?? []
  expect(create.slice(0, 7)).toEqual(['injector', '--state', s.config.injectorState, 'task-create', '--project', 'alfredgo', '--agent'])
  const tokenFile = create[create.indexOf('--token-file') + 1] ?? ''
  expect((await stat(s.config.tokenDir)).mode & 0o777).toBe(0o700)
  expect(s.registered).toEqual([{
    name: 'secret_guard',
    entry: { transport: 'stdio', command: s.config.secretGuard, args: ['mcp', '--url', 'http://127.0.0.1:8765', '--token-file', tokenFile] },
  }])
  expect(renderPrompt(await s.ctx.systemPrompt.assemble())).toContain(GUIDANCE)

  await s.fiber.dispose()
  expect(s.commands[1]).toEqual(['injector', '--state', s.config.injectorState, 'revoke', 'task', 'task_1'])
  await expect(stat(tokenFile)).rejects.toThrow()
  expect(renderPrompt(await s.ctx.systemPrompt.assemble())).not.toContain(GUIDANCE)
})

it('passes results without credentials unchanged and without asking', async () => {
  const s = await setup()
  await s.fiber.await()
  const result = await s.call('echo', { text: 'nothing here' })
  expect(s.text(result.content)).toBe('nothing here')
  expect(s.injector.calls.map(row => row.route)).toEqual(['/status', '/scan'])
})

it('replaces an approved credential in a tool result with its reference', async () => {
  const s = await setup()
  await s.fiber.await()
  // The tool reads the credential from somewhere; its arguments do not contain it.
  s.ctx.tools.register(defineContentToolFixture({
    name: 'read_env',
    description: 'Read a file.',
    parameters: { file_path: { type: 'string', required: true } },
    execute: async () => [{ type: 'text', text: `login with ${SECRET} now` }],
  }))
  const result = await s.call('read_env', { file_path: '/srv/app/.env' })
  expect(s.text(result.content)).toBe('login with {{secretref:test_passwd}} now')
  const hook = s.injector.calls.find(row => row.route === '/hook')?.body
  expect(hook).toMatchObject({ kind: 'reveal', tool: 'read_env', target: '/srv/app/.env', secrets: ['test_passwd'] })
  expect(JSON.stringify(hook)).not.toContain(SECRET)
})

it('withholds a tool result the user does not release', async () => {
  const s = await setup()
  await s.fiber.await()
  s.injector.decision = 'denied'
  const result = await s.call('echo', { text: `password ${SECRET}` })
  expect(s.text(result.content)).toBe('[AgentSecret: this text contains a credential of the user and was withheld (the user denied this request). Do not try to read it another way.]')
})

it('withholds every text when the credential check fails', async () => {
  const s = await setup()
  await s.fiber.await()
  s.injector.scanFails = true
  const result = await s.call('echo', { text: 'maybe a secret' })
  expect(s.text(result.content)).not.toContain('maybe a secret')
  expect(s.text(result.content)).toContain('the credential check is unavailable')
})

it('refuses calls that name AgentSecret state or its trusted command', async () => {
  const s = await setup()
  await s.fiber.await()
  const state = await s.call('echo', { text: `cat ${s.config.injectorState}/injector.db` })
  expect(state).toMatchObject({ isError: true })
  expect(s.text(state.content)).toContain('AgentSecret: blocked (AgentSecret state)')
  const command = await s.call('echo', { text: 'agentsecret approver run' })
  expect(s.text(command.content)).toContain('AgentSecret: blocked (the trusted agentsecret command)')
})

it('writes approved credentials into a file while the result keeps only references', async () => {
  const s = await setup()
  await s.fiber.await()
  const path = join(s.root, 'config.toml')
  const result = await s.call('secret_write_file', { file_path: path, content: 'token = "{{secretref:test_passwd}}"\n' })
  expect(result.isError).toBe(false)
  expect(await readFile(path, 'utf8')).toBe(`token = "${SECRET}"\n`)
  expect(s.text(result.content)).toBe(`Created ${path} with the credentials for test_passwd filled in. Reading the file shows references again.`)
  expect(s.text(result.content)).not.toContain(SECRET)
  expect(s.injector.calls.find(row => row.route === '/hook')?.body).toMatchObject({ kind: 'fill', tool: 'secret_write_file', target: path })
})

it('writes nothing when the user does not approve the fill', async () => {
  const s = await setup()
  await s.fiber.await()
  s.injector.decision = 'denied'
  const path = join(s.root, 'config.toml')
  const result = await s.call('secret_write_file', { file_path: path, content: '{{secretref:test_passwd}}' })
  expect(result.isError).toBe(true)
  expect(s.text(result.content)).toContain('AgentSecret did not fill test_passwd: the user denied this request')
  await expect(stat(path)).rejects.toThrow()
  expect(s.injector.calls.some(row => row.route === '/take')).toBe(false)
})

it('rejects content without a reference', async () => {
  const s = await setup()
  await s.fiber.await()
  const result = await s.call('secret_write_file', { file_path: join(s.root, 'a.txt'), content: 'plain' })
  expect(s.text(result.content)).toContain('content has no {{secretref:<alias>}} reference')
})
