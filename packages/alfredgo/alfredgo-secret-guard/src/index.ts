/**
 * AlfredGo AgentSecret plugin: lets the agent use the user's credentials
 * without the model seeing them. At load it creates one AgentSecret injector
 * task, registers the `secret_guard` MCP server for it, and, for the plugin's
 * lifetime, replaces credentials in tool results with `{{secretref:<alias>}}`
 * after the user approves, refuses tool calls that name AgentSecret state, and
 * offers `secret_write_file`, which writes a file whose references become
 * credentials after approval. Unloading revokes the task.
 * @module @deepseek-ai/dsh-alfredgo-secret-guard
 */

import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { HarnessError } from '@deepseek-ai/dsh-error'
import type { PostToolDecision } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-mcp-manager'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-fs'
import { InjectorClient, InjectorError } from './injector.ts'
import type { FetchLike } from './injector.ts'
import { releaseContent } from './reveal.ts'
import { protectedLocations, protectReason } from './protect.ts'
import { applyWriteTool, WRITE_TOOL } from './write-tool.ts'

export const name = 'alfredgo-secret-guard'
// The MCP server is registered while an MCP manager runs; profiles without one keep the other handling.
export const inject = ['tools', 'fs', 'systemPrompt']

/** MCP server name; fixes the `mcp__secret_guard__` tool namespace. */
export const SERVER_NAME = 'secret_guard'
const SERVER_TOOL_PREFIX = `mcp__${SERVER_NAME}__`

/** Model-visible guidance while the plugin is loaded. */
export const GUIDANCE = 'The user\'s credentials are managed by AgentSecret, and the user approves each use on their approver. '
  + 'Text that held a credential reaches you with `{{secretref:<alias>}}` in its place. '
  + 'To put a credential into a file, call `secret_write_file` with the reference in `content`; the file receives the real value after approval. '
  + 'Use the `mcp__secret_guard__*` tools for operations AgentSecret performs itself. Never ask the user to paste a credential into the conversation.'

/** AgentSecret commands, injector address, and task settings. */
export interface Config {
  /** Path of the `agentsecret` command that creates and revokes injector tasks. */
  agentsecret: string
  /** Path of the `secret-guard` command that runs the MCP bridge. */
  secretGuard: string
  /** Agent API origin of the running injector (`agentsecret injector serve`). */
  injectorUrl: string
  /** Injector state directory, passed to `agentsecret injector --state` and protected from tools. */
  injectorState: string
  /** Project name the task is created for; approval rules on the approver match it. */
  project: string
  /** Directory holding the task-token file; created with mode 0700 and protected from tools. */
  tokenDir: string
  /** Longest wait for the user's answer to one approval, in milliseconds. */
  approvalWaitMs: number
  /** Further paths that tool calls must not name. */
  protect: string[]
}

/** Runtime configuration schema. */
export const Config: z<Partial<Config>, Config> = z.object({
  agentsecret: z.string().required(),
  secretGuard: z.string().required(),
  injectorUrl: z.string().default('http://127.0.0.1:8765'),
  injectorState: z.string().default('~/.local/share/agentsecret/injector'),
  project: z.string().required(),
  tokenDir: z.string().required(),
  approvalWaitMs: z.natural().default(110_000),
  protect: z.array(z.string()).default([]),
})

/** Failure to start the AgentSecret task at plugin load. */
export class SecretGuardStartError extends HarnessError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'AGENTSECRET_START', options)
  }
}

/** Process runner for the trusted AgentSecret command; tests substitute a fake. */
export type RunCommand = (file: string, args: readonly string[]) => Promise<string>

/** Seams replaced by tests. */
export interface SecretGuardHooks {
  /** HTTP implementation for the injector client. */
  fetch?: FetchLike
  /** Runner for `agentsecret`. */
  run?: RunCommand
}

const runFile: RunCommand = async (file, args) => (await promisify(execFile)(file, [...args], { timeout: 30_000 })).stdout

function expand(path: string): string {
  return resolve(path.startsWith('~/') ? homedir() + path.slice(1) : path)
}

/**
 * Create the task, register the MCP server, and install the result, call, and tool handling.
 * @param ctx - plugin context with the tool registry, filesystem, MCP manager, and system prompt.
 * @param config - AgentSecret settings.
 * @param hooks - test seams.
 * @throws {SecretGuardStartError} when the injector is unreachable or the task cannot be created.
 */
export async function apply(ctx: Context, config: Config, hooks: SecretGuardHooks = {}): Promise<void> {
  const run = hooks.run ?? runFile
  const state = expand(config.injectorState)
  const tokenDir = expand(config.tokenDir)
  const probe = new InjectorClient(config.injectorUrl, 'probe', hooks.fetch)
  try {
    await probe.post('/status', { operation_id: 'probe' })
  } catch (error: unknown) {
    // A refusal proves the injector answers; only an unreachable injector stops the load.
    if (error instanceof InjectorError && error.unreachable) {
      throw new SecretGuardStartError(`AgentSecret injector is not running at ${config.injectorUrl}; start it with \`agentsecret injector serve\``, { cause: error })
    }
  }

  await mkdir(tokenDir, { recursive: true, mode: 0o700 })
  const tokenFile = join(tokenDir, `alfredgo-${randomBytes(8).toString('hex')}.token`)
  let taskId: string
  let token: string
  try {
    const out = JSON.parse(await run(config.agentsecret, ['injector', '--state', state, 'task-create', '--project', config.project, '--agent', 'alfredgo', '--token-file', tokenFile])) as { task_id?: unknown }
    if (typeof out.task_id !== 'string') throw new TypeError('task-create printed no task_id')
    taskId = out.task_id
    token = (await readFile(tokenFile, 'utf8')).trim()
  } catch (error: unknown) {
    await rm(tokenFile, { force: true })
    throw new SecretGuardStartError('Could not create an AgentSecret task; check `agentsecret` and the injector state directory', { cause: error })
  }
  ctx.effect(() => async () => {
    try {
      await run(config.agentsecret, ['injector', '--state', state, 'revoke', 'task', taskId])
    } catch (error: unknown) {
      ctx.logger.warn(`alfredgo-secret-guard: could not revoke task ${taskId}: ${String(error)}`)
    }
    await rm(tokenFile, { force: true })
  }, 'alfredgo-secret-guard: injector task')

  const client = new InjectorClient(config.injectorUrl, token, hooks.fetch)

  ctx.inject(['mcpManager'], (scope) => {
    scope.mcpManager.register(SERVER_NAME, {
      transport: 'stdio',
      command: config.secretGuard,
      args: ['mcp', '--url', config.injectorUrl, '--token-file', tokenFile],
    })
  })
  ctx.systemPrompt.section({
    name: 'alfredgo-secret-guard',
    order: ctx.systemPrompt.getSectionOrder('MCP_SERVERS'),
    text: GUIDANCE,
    // The guidance shows the literal reference syntax, which is not a prompt variable.
    interpolate: false,
  })

  const touches = protectedLocations([state, tokenDir, ...config.protect])
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name.startsWith(SERVER_TOOL_PREFIX) || exec.name === WRITE_TOOL) return next()
    const what = touches(exec.arguments)
    if (what !== undefined) return { kind: 'deny', reason: protectReason(what) }
    return next()
  })

  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const decision = await next()
    if (decision.kind !== 'accept' || exec.name.startsWith(SERVER_TOOL_PREFIX) || exec.name === WRITE_TOOL) return decision
    const content = decision.content ?? result.content
    const released = await releaseContent(client, exec.name, exec.arguments, content, config.approvalWaitMs, exec.signal)
    if (released === undefined) return decision
    return {
      kind: 'accept',
      content: released,
      ...decision.additionalContexts === undefined ? {} : { additionalContexts: decision.additionalContexts },
    }
  }, { prepend: true })

  applyWriteTool(ctx, client, config.approvalWaitMs)
}
