/**
 * `secret_write_file`: writes a UTF-8 file whose `{{secretref:<alias>}}`
 * references become the user's credentials after the user approves. The tool
 * call, its log record, and its result carry only the references; the values
 * exist in memory for the write.
 * @module @deepseek-ai/dsh-alfredgo-secret-guard/write-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-error'
import { defineTool, ToolArgsError } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-working-directory'
import type { InjectorClient } from './injector.ts'
import { outcome } from './injector.ts'
import { describeCall, REFERENCE } from './reveal.ts'

/** Tool name. */
export const WRITE_TOOL = 'secret_write_file'

/** The user or the approver did not allow the references to be filled. */
export class SecretFillDeniedError extends HarnessError {
  constructor(message: string) {
    super(message, 'AGENTSECRET_FILL_DENIED')
  }
}

/**
 * Aliases referenced in a text, in first-appearance order.
 * @param text - text that may contain references.
 * @returns distinct aliases.
 */
export function referencedAliases(text: string): string[] {
  return [...new Set([...text.matchAll(REFERENCE)].map(match => match[1] ?? ''))]
}

/**
 * Register `secret_write_file`.
 * @param ctx - plugin context with the tool registry and filesystem.
 * @param client - injector client of this task.
 * @param waitMs - longest wait for the user's answer.
 */
export function applyWriteTool(ctx: Context, client: InjectorClient, waitMs: number): void {
  ctx.tools.register(defineTool({
    name: WRITE_TOOL,
    description: 'Create or fully replace a UTF-8 text file that needs the user\'s credentials. '
      + 'Write each credential as `{{secretref:<alias>}}` in `content`; after the user approves, the file receives the real values. '
      + 'Your conversation never contains the values.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to write, resolved like the write tool\'s.' },
      content: { type: 'string', required: true, description: 'Full file content with `{{secretref:<alias>}}` references.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          operation: { type: 'string', required: true, enum: ['create', 'update'] },
          references: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.operation === 'create' ? 'Created' : 'Updated'} ${value.path} with the credentials for ${value.references.join(', ')} filled in. `
          + 'Reading the file shows references again.',
      }],
    },
    async execute(args, exec) {
      if (args.file_path.trim().length === 0) throw new ToolArgsError(['file_path must be a non-empty string'])
      const aliases = referencedAliases(args.content)
      if (aliases.length === 0) throw new ToolArgsError(['content has no {{secretref:<alias>}} reference; use the write tool for files without credentials'])
      if (aliases.length > 20) throw new ToolArgsError(['content references more than 20 credentials'])
      const status = await client.approve(describeCall('fill', WRITE_TOOL, args, aliases), waitMs, exec.signal)
      if (status.state !== 'approved') {
        throw new SecretFillDeniedError(`AgentSecret did not fill ${aliases.join(', ')}: ${outcome(status)}. Do not retry with a different spelling.`)
      }
      const values = await client.take(status.operation_id, exec.signal)
      const missing = aliases.filter(alias => !Object.hasOwn(values, alias))
      if (missing.length > 0) throw new SecretFillDeniedError(`AgentSecret returned no value for ${missing.join(', ')}`)
      const filled = args.content.replace(REFERENCE, (_match, alias: string) => values[alias] ?? '')
      const workingDirectory = ctx.get('workingDirectory')
      const cwd = exec.agent === undefined || workingDirectory === undefined
        ? undefined
        : await workingDirectory.ensure(exec.agent, exec.signal)
      const target = await ctx.fs.resolve(args.file_path, { ...cwd === undefined ? {} : { cwd }, signal: exec.signal })
      const written = await ctx.fs.writeText(target, filled, undefined, exec.signal)
      return { path: target.displayPath, operation: written.operation, references: aliases }
    },
    presentCall: args => ({ card: 'generic', title: `Write ${args.file_path} with credentials`, kind: 'edit', rawInput: { file_path: args.file_path } }),
  }))
}
