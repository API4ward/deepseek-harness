/**
 * Refusal of tool calls that name AgentSecret's own state: the injector state
 * directory, the task-token directory, extra configured paths, and the trusted
 * AgentSecret commands. The check matches strings in the call's arguments; it
 * does not confine a process.
 * @module @deepseek-ai/dsh-alfredgo-secret-guard/protect
 */

import { homedir } from 'node:os'
import { resolve } from 'node:path'

/** Command names that can open AgentSecret state; an agent has no reason to run them. */
const TRUSTED_NAMES = ['agentsecret', 'secret-guard', 'secret_guard'] as const

/**
 * Collect every string inside a JSON-like value.
 * @param value - parsed tool arguments or a nested part of them.
 * @returns the strings, depth-first in key order.
 */
export function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringsOf)
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(stringsOf)
  return []
}

/**
 * Build the matcher for protected locations.
 * @param paths - absolute or `~`-prefixed paths to protect.
 * @returns a function naming the protected thing a call touches, or `undefined`.
 */
export function protectedLocations(paths: readonly string[]): (args: unknown) => string | undefined {
  const home = homedir()
  const spellings = paths.flatMap((path) => {
    const absolute = resolve(path.startsWith('~/') ? home + path.slice(1) : path).replace(/\/+$/, '')
    const tilde = absolute.startsWith(home + '/') ? '~' + absolute.slice(home.length) : undefined
    return [absolute, ...tilde === undefined ? [] : [tilde]].map(spelling => spelling.toLowerCase())
  })
  return (args) => {
    for (const text of stringsOf(args)) {
      const folded = text.toLowerCase()
      if (spellings.some(spelling => folded.includes(spelling))) return 'AgentSecret state'
      const name = TRUSTED_NAMES.find(candidate => new RegExp(`(^|[\\s/;&|('"\`])${candidate}([\\s;&|)'"\`]|$)`).test(folded))
      if (name !== undefined) return `the trusted ${name} command`
    }
    return undefined
  }
}

/**
 * The model-visible reason for a refused call.
 * @param what - what the call touched.
 * @returns the denial reason.
 */
export function protectReason(what: string): string {
  return `AgentSecret: blocked (${what}). Credential state and task tokens are off limits to tools; `
    + 'use the mcp__secret_guard__* tools or secret_write_file instead. Do not retry with a different spelling.'
}
