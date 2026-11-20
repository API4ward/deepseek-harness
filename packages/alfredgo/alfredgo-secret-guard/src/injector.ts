/**
 * HTTP client for the agent API of an AgentSecret injector: credential scans,
 * approval requests for one tool call, their status, and the one-time take of
 * approved fill values. Every call authenticates with the task token.
 * @module @deepseek-ai/dsh-alfredgo-secret-guard/injector
 */

import { setTimeout as sleep } from 'node:timers/promises'
import { HarnessError } from '@deepseek-ai/dsh-error'

/** One credential occurrence in a scanned text: UTF-8 byte start, byte end, credential alias. */
export type ScanHit = readonly [start: number, end: number, alias: string]

/** One approval request about a tool call, as the approver displays it. */
export interface HookRequest {
  /** `reveal` lets a tool result reach the model with references; `fill` lets references become credentials. */
  readonly kind: 'reveal' | 'fill'
  /** Tool name, at most 128 characters. */
  readonly tool: string
  /** File path or URL the call acts on, at most 300 characters; empty when the call has none. */
  readonly target: string
  /** Human-readable description of the call, at most 300 characters. */
  readonly summary: string
  /** Lowercase hex SHA-256 identifying the call. */
  readonly call: string
  /** Aliases of the credentials involved, 1 to 20 entries. */
  readonly secrets: readonly string[]
}

/** State of one approval request as the injector reports it. */
export interface OperationStatus {
  /** Opaque injector request id. */
  readonly operation_id: string
  /** `pending`, `approved`, `denied`, `expired`, `revoked`, or `used`. */
  readonly state: string
  /** Reason code when the request was not approved. */
  readonly reason?: string
  /** Human-readable reason text. */
  readonly message?: string
}

/** Failure of an injector call: unreachable, refused, or malformed answer. */
export class InjectorError extends HarnessError {
  /** True when no HTTP answer arrived, as opposed to a refusal or a malformed answer. */
  readonly unreachable: boolean

  constructor(message: string, options?: ErrorOptions & { unreachable?: boolean }) {
    super(message, 'AGENTSECRET_INJECTOR', options)
    this.unreachable = options?.unreachable === true
  }
}

/** Fetch implementation the client uses; tests substitute a fake injector. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** Client for one injector task. */
export class InjectorClient {
  /**
   * @param url - injector agent API origin, for example `http://127.0.0.1:8765`.
   * @param token - task token created by `agentsecret injector task-create`.
   * @param fetchImpl - HTTP implementation.
   */
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  /**
   * POST one JSON body to an injector route.
   * @param route - route path such as `/scan`.
   * @param body - JSON request body.
   * @param signal - cancels the request.
   * @returns the parsed JSON answer.
   * @throws {InjectorError} when the injector is unreachable, refuses the call, or answers with non-JSON.
   */
  async post(route: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await this.fetchImpl(this.url.replace(/\/+$/, '') + route, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...signal === undefined ? {} : { signal },
      })
    } catch (error: unknown) {
      throw new InjectorError(`AgentSecret injector at ${this.url} is unreachable`, { cause: error, unreachable: true })
    }
    let answer: unknown
    try {
      answer = await response.json()
    } catch (error: unknown) {
      throw new InjectorError(`AgentSecret injector answered ${route} with HTTP ${response.status} and no JSON`, { cause: error })
    }
    if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) {
      throw new InjectorError(`AgentSecret injector answered ${route} with a non-object`)
    }
    const record = answer as Record<string, unknown>
    if (!response.ok) {
      throw new InjectorError(`AgentSecret injector refused ${route}: ${typeof record.error === 'string' ? record.error : `HTTP ${response.status}`}`)
    }
    return record
  }

  /**
   * Find credentials in texts with the matchers the approver compiled.
   * @param texts - texts to scan.
   * @param signal - cancels the request.
   * @returns one hit list per text, in input order.
   * @throws {InjectorError} on any call failure or an answer of the wrong length.
   */
  async scan(texts: readonly string[], signal?: AbortSignal): Promise<ScanHit[][]> {
    const found = (await this.post('/scan', { texts }, signal)).found
    if (!Array.isArray(found) || found.length !== texts.length || !found.every(isHitList)) {
      throw new InjectorError('AgentSecret injector answered /scan with malformed hits')
    }
    return found
  }

  /**
   * Ask for an approval and wait for its answer.
   * @param request - the tool call the approver displays.
   * @param waitMs - how long to wait for an answer before reporting the pending state.
   * @param signal - cancels the wait.
   * @returns the last status seen.
   * @throws {InjectorError} on any call failure.
   */
  async approve(request: HookRequest, waitMs: number, signal?: AbortSignal): Promise<OperationStatus> {
    let status = toStatus(await this.post('/hook', { ...request, secrets: [...request.secrets] }, signal))
    const deadline = Date.now() + waitMs
    while (status.state === 'pending' && Date.now() < deadline) {
      await sleep(500, undefined, { signal })
      status = toStatus(await this.post('/status', { operation_id: status.operation_id }, signal))
    }
    return status
  }

  /**
   * Take the values of an approved fill. The injector hands them out once.
   * @param operationId - the approved fill request.
   * @param signal - cancels the request.
   * @returns credential values by alias.
   * @throws {InjectorError} on any call failure or a malformed answer.
   */
  async take(operationId: string, signal?: AbortSignal): Promise<Record<string, string>> {
    const values = (await this.post('/take', { operation_id: operationId }, signal)).values
    if (typeof values !== 'object' || values === null || Array.isArray(values)
      || !Object.values(values).every(value => typeof value === 'string')) {
      throw new InjectorError('AgentSecret injector answered /take with malformed values')
    }
    return values as Record<string, string>
  }
}

function isHitList(value: unknown): value is ScanHit[] {
  return Array.isArray(value) && value.every(hit => Array.isArray(hit) && hit.length === 3
    && Number.isInteger(hit[0]) && Number.isInteger(hit[1]) && typeof hit[2] === 'string')
}

function toStatus(answer: Record<string, unknown>): OperationStatus {
  if (typeof answer.operation_id !== 'string' || typeof answer.state !== 'string') {
    throw new InjectorError('AgentSecret injector answered without an operation state')
  }
  return {
    operation_id: answer.operation_id,
    state: answer.state,
    ...typeof answer.reason === 'string' ? { reason: answer.reason } : {},
    ...typeof answer.message === 'string' ? { message: answer.message } : {},
  }
}

/**
 * Describe why an approval did not succeed, for the model.
 * @param status - the last status seen.
 * @returns the injector's message, or the state.
 */
export function outcome(status: OperationStatus): string {
  return status.message ?? (status.state === 'pending' ? 'no answer yet' : status.state)
}
