/**
 * Credential handling of tool results before the model sees them: text blocks
 * are scanned by the injector, and on a hit the user approves on the approver.
 * Approved, each credential becomes `{{secretref:<alias>}}`; otherwise each
 * text block that holds one is replaced by a withheld notice.
 * @module @deepseek-ai/dsh-alfredgo-secret-guard/reveal
 */

import { createHash } from 'node:crypto'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { HookRequest, InjectorClient, ScanHit } from './injector.ts'
import { outcome } from './injector.ts'

/** A credential reference written by the model or put in place of a credential. */
export const REFERENCE = /\{\{secretref:([A-Za-z0-9_.-]{1,64})\}\}/g

/**
 * The model-visible notice that replaces a text block holding a credential.
 * @param why - why the text was not released.
 * @returns the notice text.
 */
export function withheldNotice(why: string): string {
  return `[AgentSecret: this text contains a credential of the user and was withheld (${why}). Do not try to read it another way.]`
}

/**
 * Describe one tool call to the approver.
 * @param kind - `reveal` or `fill`.
 * @param tool - tool name.
 * @param args - parsed tool arguments.
 * @param secrets - aliases involved.
 * @returns the approval request.
 */
export function describeCall(kind: HookRequest['kind'], tool: string, args: unknown, secrets: readonly string[]): HookRequest {
  const record = typeof args === 'object' && args !== null && !Array.isArray(args) ? args as Record<string, unknown> : {}
  const command = record.command
  const summary = typeof command === 'string' ? command : stableJson(args)
  const target = ['file_path', 'notebook_path', 'path', 'url']
    .map(key => record[key]).find((value): value is string => typeof value === 'string') ?? ''
  return {
    kind,
    tool: tool.slice(0, 128),
    target: target.slice(0, 300),
    summary: (kind === 'reveal' ? summary.replace(REFERENCE, '…') : summary).slice(0, 300),
    call: createHash('sha256').update(stableJson([tool, args])).digest('hex'),
    secrets: [...new Set(secrets)].sort().slice(0, 20),
  }
}

/**
 * Release a tool result to the model with credentials handled.
 * @param client - injector client of this task.
 * @param tool - tool name.
 * @param args - parsed tool arguments.
 * @param content - the result content the model would see.
 * @param waitMs - longest wait for the user's answer.
 * @param signal - cancels scanning and waiting.
 * @returns replacement content, or `undefined` when the content holds no credential.
 */
export async function releaseContent(
  client: InjectorClient,
  tool: string,
  args: unknown,
  content: readonly ContentBlock[],
  waitMs: number,
  signal?: AbortSignal,
): Promise<ContentBlock[] | undefined> {
  const indexes = content.flatMap((block, index) => block.type === 'text' && block.text.length > 0 ? [index] : [])
  if (indexes.length === 0) return undefined
  const texts = indexes.map(index => (content[index] as Extract<ContentBlock, { type: 'text' }>).text)
  let found: ScanHit[][]
  let why: string | undefined
  try {
    found = await client.scan(texts, signal)
  } catch {
    // The scan failed, so no text can be shown to be credential-free.
    return content.map(block => block.type === 'text' && block.text.length > 0
      ? { type: 'text', text: withheldNotice('the credential check is unavailable') }
      : block)
  }
  const names = [...new Set(found.flat().map(hit => hit[2]))]
  if (names.length === 0) return undefined
  let approved = false
  try {
    const status = await client.approve(describeCall('reveal', tool, args, names), waitMs, signal)
    approved = status.state === 'approved'
    if (!approved) why = outcome(status)
  } catch {
    why = 'the approval could not be requested'
  }
  const next = [...content]
  indexes.forEach((blockIndex, textIndex) => {
    const hits = found[textIndex] ?? []
    if (hits.length === 0) return
    next[blockIndex] = { type: 'text', text: approved ? replaceHits(texts[textIndex] ?? '', hits) : withheldNotice(why ?? 'not approved') }
  })
  return next
}

/**
 * Put a reference in place of each credential occurrence.
 * @param text - the scanned text.
 * @param hits - UTF-8 byte ranges with their aliases.
 * @returns the text with references.
 */
export function replaceHits(text: string, hits: readonly ScanHit[]): string {
  let bytes = Buffer.from(text, 'utf8')
  for (const [start, end, alias] of [...hits].sort((a, b) => b[0] - a[0])) {
    bytes = Buffer.concat([bytes.subarray(0, start), Buffer.from(`{{secretref:${alias}}}`, 'utf8'), bytes.subarray(end)])
  }
  return bytes.toString('utf8')
}

/**
 * JSON with object keys sorted, so equal calls hash equally.
 * @param value - any JSON-compatible value.
 * @returns the serialized value.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => typeof inner === 'object' && inner !== null && !Array.isArray(inner)
    ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    : inner)
}
