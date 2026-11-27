/** JSON values exchanged between the browser approver and the Host relay forwarder. */
import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The AgentSecret relay could not be reached or did not answer with JSON. */
    'secret-approver/relay-unreachable': { readonly reason: string }
  }
}

/** The relay routes an approver uses; the forwarder refuses every other path. */
export type RelayPath = '/device/challenge' | '/device/login' | '/approver/rules' | '/approver/pending' | '/approver/decision'

/** One approver request forwarded to the relay. */
export interface RelayCall {
  /** Relay route. */
  readonly path: RelayPath
  /** JSON request body, as text. */
  readonly body: string
  /** Relay device session token, sent as a Bearer credential when present. */
  readonly token?: string
}

/** The relay's answer to one forwarded request. */
export interface RelayReply {
  /** HTTP status the relay returned. */
  readonly status: number
  /** JSON response body, as text. */
  readonly body: string
}

/** Fixed facts the browser approver shows in its setup steps. */
export interface ApproverHostInfo {
  /** Origin of the AgentSecret relay the Host forwards to. */
  readonly relayUrl: string
}
