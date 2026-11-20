/**
 * Host forwarder for the AlfredGo browser approver. The AgentSecret relay checks
 * `Host` and `Origin` and sends no CORS headers, so a page served by DHS cannot
 * call it; this service forwards the five approver routes. Bodies carry device
 * public keys, signatures, signed requests, and sealed boxes, never a stored
 * credential.
 * @module @deepseek-ai/dsh-alfredgo-secret-approver
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ApproverHostInfo, RelayCall, RelayPath, RelayReply } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** AlfredGo browser approver forwarder. */
    secretApprover: SecretApproverController
  }
}

/** Plugin configuration. */
export interface Config {
  /** Origin of the AgentSecret relay, such as `http://127.0.0.1:8780`. */
  relayUrl: string
}

/** Fetch signature the forwarder uses; tests pass a fake relay. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** The relay routes an approver uses. */
const RELAY_PATHS: readonly RelayPath[] = ['/device/challenge', '/device/login', '/approver/rules', '/approver/pending', '/approver/decision']

/** The relay limits one request body to 1 MiB. */
const MAX_BODY = 1024 * 1024

/** Forwards approver calls from the owner's browser to the AgentSecret relay. */
export default class SecretApproverController extends TypertRemoteService {
  static inject = ['typert']
  static Config: z<Config> = z.object({
    relayUrl: z.string().default('http://127.0.0.1:8780'),
  })

  private readonly origin: string

  constructor(ctx: Context, config: Config, private readonly fetchImpl: FetchLike = fetch) {
    super(ctx, 'secretApprover', { namespace: 'secretApprover' })
    const url = new URL(config.relayUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`relayUrl must use http or https: ${config.relayUrl}`)
    this.origin = url.origin
  }

  /**
   * Read the relay origin shown in the approver setup steps.
   * @returns the configured relay origin.
   */
  @Remote
  info(): ApproverHostInfo {
    return { relayUrl: this.origin }
  }

  /**
   * Forward one approver request to the relay.
   * @param call - relay route, JSON body text, and optional session token.
   * @param signal - Client cancellation.
   * @returns the relay's status and JSON body text.
   * @throws {RemoteError} `gateway/bad-request` for another route or an oversized body;
   * `secret-approver/relay-unreachable` when the relay does not answer with JSON.
   */
  @Remote
  async relay(call: RelayCall, signal: AbortSignal): Promise<RelayReply> {
    if (!RELAY_PATHS.includes(call.path)) throw new RemoteError('gateway/bad-request', `not an approver route: ${call.path}`, {})
    if (Buffer.byteLength(call.body) > MAX_BODY) throw new RemoteError('gateway/bad-request', 'approver request exceeds 1 MiB', {})
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (call.token !== undefined) headers.Authorization = `Bearer ${call.token}`
    let response: Response
    try {
      response = await this.fetchImpl(this.origin + call.path, { method: 'POST', headers, body: call.body, redirect: 'error', signal })
    } catch (error) {
      signal.throwIfAborted()
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('secret-approver/relay-unreachable', `AgentSecret relay at ${this.origin} is not reachable: ${reason}`, { reason })
    }
    const body = await response.text()
    if (!(response.headers.get('content-type') ?? '').startsWith('application/json')) {
      throw new RemoteError('secret-approver/relay-unreachable', `AgentSecret relay at ${this.origin} answered without JSON (HTTP ${response.status})`, { reason: `HTTP ${response.status}` })
    }
    return { status: response.status, body }
  }
}
