/**
 * The AgentSecret approver, ported from AgentSecret's browser approver: device
 * creation, relay sign-in, injector pairing, credential storage, matcher
 * publication, request checks, approval modes, and signed decisions. Plaintext
 * credentials exist only in this browser; the relay receives public keys,
 * signatures, matchers, and boxes sealed to a paired injector.
 */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import {
  bytes, compileMatcher, matcherBase, mockValue, publicJwk, seal, sealAad, sign, verify,
  type Matcher, type PublicJwk,
} from './crypto.ts'
import type { ApproverStore, AutoRule, Ciphertext, DeviceRecord, Grant, SecretRecord } from './store.ts'

/** Relay routes the approver calls. */
export type RelayPath = '/device/challenge' | '/device/login' | '/approver/rules' | '/approver/pending' | '/approver/decision'

/** Sends one JSON request to the relay and returns its status and parsed body. */
export type RelayTransport = (
  path: RelayPath, body: object, token: string | undefined,
) => Promise<{ status: number; data: Record<string, unknown> }>

/** Failures the UI explains to the user; each code has a localized text. */
export type ApproverErrorCode =
  | 'device-missing' | 'device-exists' | 'user-required' | 'not-registered' | 'not-connected'
  | 'pairing-invalid' | 'pairing-user' | 'injector-exists' | 'alias-invalid' | 'value-required'
  | 'value-too-large' | 'repo-invalid' | 'secret-missing' | 'copy-invalid' | 'copy-missing' | 'manual-required' | 'relay'

/** A failure with a code the UI localizes; `detail` carries the relay's error text for `relay`. */
export class ApproverError extends Error {
  constructor(readonly code: ApproverErrorCode, readonly detail = '') {
    super(detail === '' ? code : `${code}: ${detail}`)
    this.name = 'ApproverError'
  }
}

/** Why the approver refused a request without asking; the injector shows it to the caller. */
export type RejectReason = 'secret_unavailable' | 'injector_not_paired' | 'policy_denied' | 'request_changed' | 'request_invalid' | 'signature_invalid'

/** Request kinds. `reveal` and `fill` come from hooks; `reference` and `use` from MCP tools. */
export type RequestKind = 'reference' | 'use' | 'reveal' | 'fill'

/** One pending request as shown on an approval card. */
export interface PendingRequest {
  readonly id: string
  readonly kind: RequestKind
  readonly project: string
  readonly task: string
  readonly injector: string
  readonly secrets: readonly string[]
  readonly tool: string
  readonly target: string
  /** Hook call summary, MCP reference type, or the fixed GitHub request line. */
  readonly operation: string
  readonly expiresAt: number
  /** Copy labels of each credential that a `use` or `fill` approval may return instead. */
  readonly copies: Readonly<Record<string, readonly string[]>>
  /** The exact frozen request text the injector signed. */
  readonly requestText: string
}

/** One line of the automatic-decision log. */
export interface DecisionNote {
  readonly at: number
  readonly secrets: readonly string[]
  readonly project: string
  readonly why: RejectReason | 'all' | 'grant' | 'rule'
  readonly automatic: boolean
}

/** Everything the settings page and the approval cards render. */
export interface ApproverState {
  readonly loaded: boolean
  readonly device: { readonly id: string; readonly user: string; readonly pairing: string } | null
  readonly connected: boolean
  /** Whether the relay knows this device; null before the first sign-in attempt. */
  readonly registered: boolean | null
  /** Injector ids the relay has registered for this user; null before the first fetch. */
  readonly relayInjectors: readonly string[] | null
  readonly injectors: readonly string[]
  readonly secrets: readonly { readonly alias: string; readonly copies: readonly string[]; readonly repos: readonly string[] }[]
  readonly allUntil: number
  readonly autoRules: readonly AutoRule[]
  readonly requests: readonly PendingRequest[]
  readonly notes: readonly DecisionNote[]
}

/** What an approval returns for one credential: `default`, `copy:<label>`, `mock`, or `manual:<text>`. */
export type ValueChoice = string

/** "Allow n times" or "allow for n seconds". */
export type GrantChoice = { readonly times: number } | { readonly seconds: number }

const ALIAS = /^[A-Za-z0-9_.-]{1,64}$/
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/
const REF_TYPES = new Set(['once', 'long'])
const HOOK_KINDS = new Set<RequestKind>(['reveal', 'fill'])
/** One sealed transfer carries at most 64 KiB. */
const MAX_VALUE = 65536
const MAX_NOTES = 20

interface RawEntry { readonly request_text: string; readonly signature: string }
interface RawRequest {
  readonly domain?: unknown
  readonly principal?: unknown
  readonly request_id: string
  readonly kind: RequestKind
  readonly project: string
  readonly task: string
  readonly injector: string
  readonly expires_at: number
  readonly secret_id?: string
  readonly details: Record<string, unknown>
}

const glob = (pattern: string, text: string): boolean =>
  new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.') + '$').test(text)

function facets(p: RawRequest): { kind: RequestKind; names: string[]; tool: string; target: string } {
  const d = p.details
  if (HOOK_KINDS.has(p.kind)) return { kind: p.kind, names: [...d.secrets as string[]], tool: String(d.tool), target: String(d.target) }
  const args = (d.args ?? {}) as Record<string, unknown>
  return { kind: p.kind, names: [p.secret_id ?? ''], tool: p.kind === 'use' ? 'github' : '', target: typeof args.repo === 'string' ? args.repo : '' }
}

function operation(p: RawRequest): string {
  const d = p.details
  if (p.kind === 'reference') return String(d.type)
  if (HOOK_KINDS.has(p.kind)) return String(d.summary)
  return `${String(d.method)} ${String(d.scheme)}://${String(d.host)}:${String(d.port)}${String(d.path)}?${String(d.query)}`
}

/** The approver of one browser profile. */
export class Approver {
  private device: DeviceRecord | undefined
  private session: string | undefined
  private state: ApproverState = {
    loaded: false, device: null, connected: false, registered: null, relayInjectors: null, injectors: [], secrets: [],
    allUntil: 0, autoRules: [], requests: [], notes: [],
  }

  private readonly listeners = new Set<() => void>()
  private pending = new Map<string, { entry: RawEntry; request: RawRequest }>()

  /**
   * @param store - persistent approver storage.
   * @param relay - transport to the AgentSecret relay.
   * @param now - clock in milliseconds.
   */
  constructor(
    private readonly store: ApproverStore,
    private readonly relay: RelayTransport,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Reads the approver state for `useSyncExternalStore`.
   * @returns the current state; replaced, never mutated, on each change.
   */
  getSnapshot = (): ApproverState => this.state

  /**
   * Registers a state listener for `useSyncExternalStore`.
   * @param listener - called after each state change.
   * @returns the unsubscribe function.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Load stored state, then sign in and fetch requests when a device exists; a sign-in failure leaves the page disconnected. */
  async load(): Promise<void> {
    this.device = await this.store.device()
    await this.publishLocal({ loaded: true })
    if (this.device === undefined) return
    try { await this.connect() } catch (error) {
      if (!(error instanceof ApproverError)) throw error
    }
  }

  /**
   * Create the device keys; they cannot be exported.
   * @param user - AgentSecret user name; injectors pair only with devices of the same user.
   */
  async createDevice(user: string): Promise<void> {
    if (this.device !== undefined) throw new ApproverError('device-exists')
    const name = user.trim()
    if (name === '') throw new ApproverError('user-required')
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
    const vault = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const device: DeviceRecord = {
      id: 'approver_' + randomUUID(), user: name, signing: keys.privateKey, vault,
      jwk: publicJwk(await crypto.subtle.exportKey('jwk', keys.publicKey)),
    }
    await this.store.putDevice(device)
    this.device = device
    await this.publishLocal({})
  }

  /** Sign in to the relay, publish matchers, and fetch pending requests. */
  async connect(): Promise<void> {
    await this.login()
    await this.publishMatchers()
    await this.refresh()
  }

  /**
   * Pair an injector from its pairing JSON (public keys only).
   * @param text - the injector's pairing file content.
   */
  async pairInjector(text: string): Promise<void> {
    const device = this.requireDevice()
    let d: Record<string, unknown>
    try { d = JSON.parse(text) as Record<string, unknown> } catch { throw new ApproverError('pairing-invalid') }
    if (d.kind !== 'injector' || typeof d.device !== 'string' || typeof d.jwk !== 'object' || d.jwk === null || typeof d.enc_jwk !== 'object' || d.enc_jwk === null) {
      throw new ApproverError('pairing-invalid')
    }
    if (d.user !== device.user) throw new ApproverError('pairing-user')
    if (await this.store.get('injectors', d.device) !== undefined) throw new ApproverError('injector-exists')
    let jwk: PublicJwk, encJwk: PublicJwk
    try {
      jwk = publicJwk(d.jwk)
      encJwk = publicJwk(d.enc_jwk)
      await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify'])
      await crypto.subtle.importKey('jwk', encJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, [])
    } catch { throw new ApproverError('pairing-invalid') }
    await this.store.put('injectors', d.device, { id: d.device, jwk, enc_jwk: encJwk })
    await this.publishLocal({})
  }

  /**
   * Store or replace a credential, then publish matchers.
   * @param alias - 1 to 64 letters, digits, dots, underscores, or hyphens.
   * @param value - the credential, stored exactly as given.
   * @param repos - GitHub repositories (`owner/name`) the MCP adapter may use it for.
   */
  async addSecret(alias: string, value: string, repos: readonly string[]): Promise<void> {
    const device = this.requireDevice()
    const name = alias.trim()
    if (!ALIAS.test(name)) throw new ApproverError('alias-invalid')
    this.checkValue(value)
    const list = [...new Set(repos.map(r => r.trim().toLowerCase()).filter(Boolean))].sort()
    const bad = list.filter(r => !REPO.test(r))
    if (bad.length > 0) throw new ApproverError('repo-invalid', bad.join(', '))
    const cipher = await this.encrypt(device, name, value)
    const copies = (await this.store.get('secrets', name))?.copies ?? {}
    await this.store.put('secrets', name, { alias: name, ...cipher, repos: list, copies })
    await this.publishMatchers()
    await this.publishLocal({})
  }

  /**
   * Store a further copy under an existing alias, such as a second key of the same service.
   * @param alias - existing alias.
   * @param label - copy name; `default` is reserved.
   * @param value - the copy's value.
   */
  async addCopy(alias: string, label: string, value: string): Promise<void> {
    const device = this.requireDevice()
    const secret = await this.store.get('secrets', alias.trim())
    if (secret === undefined) throw new ApproverError('secret-missing')
    const name = label.trim()
    if (!ALIAS.test(name) || name === 'default') throw new ApproverError('copy-invalid')
    this.checkValue(value)
    const cipher = await this.encrypt(device, secret.alias + '\u0000' + name, value)
    await this.store.put('secrets', secret.alias, { ...secret, copies: { ...secret.copies, [name]: cipher } })
    await this.publishMatchers()
    await this.publishLocal({})
  }

  /**
   * Delete a credential and its copies, then publish matchers without it.
   * @param alias - the credential's alias.
   */
  async removeSecret(alias: string): Promise<void> {
    await this.store.remove('secrets', alias)
    await this.publishMatchers()
    await this.publishLocal({})
  }

  /**
   * Answer every request this device may approve, until `minutes` from now; 0 returns to asking.
   * @param minutes - duration of the mode.
   */
  async setAllMode(minutes: number): Promise<void> {
    await this.store.putSetting('allUntil', minutes > 0 ? this.now() + minutes * 60000 : 0)
    await this.publishLocal({})
  }

  /**
   * Add an automatic approval rule; empty fields mean `*`.
   * @param rule - request kind, secret, tool, and target globs.
   */
  async addAutoRule(rule: AutoRule): Promise<void> {
    const clean = (value: string): string => value.trim() === '' ? '*' : value.trim()
    const rules = await this.store.setting('autoRules', [])
    await this.store.putSetting('autoRules', [...rules, { kind: clean(rule.kind), secret: clean(rule.secret), tool: clean(rule.tool), target: clean(rule.target) }])
    await this.publishLocal({})
  }

  /**
   * Removes one automatic rule and republishes the rules to the relay.
   * @param index - position of the rule to remove.
   */
  async removeAutoRule(index: number): Promise<void> {
    const rules = await this.store.setting('autoRules', [])
    await this.store.putSetting('autoRules', rules.filter((_, i) => i !== index))
    await this.publishLocal({})
  }

  /**
   * Fetch pending requests. Requests this device can never approve are refused at
   * once with a signed reason; requests an approval mode covers are approved.
   */
  async refresh(): Promise<void> {
    if (this.session === undefined) throw new ApproverError('not-connected')
    const data = await this.call('/approver/pending', {}, true)
    const relayInjectors = Array.isArray(data.injectors) ? data.injectors.filter((v): v is string => typeof v === 'string') : []
    const pending = new Map<string, { entry: RawEntry; request: RawRequest }>()
    const notes: DecisionNote[] = []
    for (const raw of Array.isArray(data.requests) ? data.requests as RawEntry[] : []) {
      let request: RawRequest, problem: RejectReason | 'expired' | ''
      try {
        request = JSON.parse(raw.request_text) as RawRequest
        problem = await this.check(raw, request)
      } catch { continue }
      if (problem === 'expired') continue
      if (problem !== '') {
        try { await this.sendDecision(raw, request, 'deny', problem, {}) } catch (error) {
          if (!(error instanceof ApproverError)) throw error
          continue
        }
        notes.push({ at: this.now(), secrets: facets(request).names, project: request.project, why: problem, automatic: false })
        continue
      }
      const auto = await this.automatic(request)
      if (auto !== null) {
        try {
          await this.sendDecision(raw, request, 'approve', '', auto.choices)
          notes.push({ at: this.now(), secrets: facets(request).names, project: request.project, why: auto.why, automatic: true })
          continue
        } catch (error) {
          if (!(error instanceof ApproverError)) throw error
        }
      }
      pending.set(request.request_id, { entry: raw, request })
    }
    this.pending = pending
    const requests: PendingRequest[] = []
    for (const { entry, request } of pending.values()) requests.push(await this.card(entry, request))
    await this.publishLocal({ relayInjectors, requests, notes: [...notes, ...this.state.notes].slice(0, MAX_NOTES) })
  }

  /**
   * Answer one pending request.
   * @param requestId - the request.
   * @param decision - approve or deny.
   * @param choices - for `use` and `fill`, what each credential returns.
   * @param grant - remember an approval for the same kind of request.
   */
  async decide(requestId: string, decision: 'approve' | 'deny', choices: Readonly<Record<string, ValueChoice>> = {}, grant: GrantChoice | null = null): Promise<void> {
    const item = this.pending.get(requestId)
    if (item === undefined) return
    if (decision === 'approve' && Object.values(choices).includes('manual:')) throw new ApproverError('manual-required')
    await this.sendDecision(item.entry, item.request, decision, '', choices)
    if (decision === 'approve' && grant !== null) {
      const f = facets(item.request)
      const grants = await this.store.setting('grants', [])
      await this.store.putSetting('grants', [...grants, {
        key: JSON.stringify([f.kind, f.names, item.request.project]),
        remaining: 'times' in grant ? grant.times - 1 : null,
        expires: 'seconds' in grant ? this.now() + grant.seconds * 1000 : null,
        choices,
      }])
    }
    await this.refresh()
  }

  private requireDevice(): DeviceRecord {
    if (this.device === undefined) throw new ApproverError('device-missing')
    return this.device
  }

  private checkValue(value: string): void {
    if (value === '') throw new ApproverError('value-required')
    if (bytes(value).length > MAX_VALUE) throw new ApproverError('value-too-large')
  }

  private async encrypt(device: DeviceRecord, aad: string, value: string): Promise<Ciphertext> {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    return { iv, ct: await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: bytes(aad) }, device.vault, bytes(value)) }
  }

  private async plain(secret: SecretRecord, label = 'default'): Promise<string> {
    const device = this.requireDevice()
    const c = label === 'default' ? secret : secret.copies[label]
    if (c === undefined) throw new ApproverError('copy-missing')
    const aad = secret.alias + (label === 'default' ? '' : '\u0000' + label)
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: c.iv, additionalData: bytes(aad) }, device.vault, c.ct))
  }

  private async call(path: RelayPath, body: object, auth: boolean, retry = true): Promise<Record<string, unknown>> {
    const { status, data } = await this.relay(path, body, auth ? this.session : undefined)
    if (status >= 200 && status < 300) return data
    const code = typeof data.error === 'string' ? data.error : `HTTP ${status}`
    // A relay session lasts five minutes; sign in again with the device key.
    if (auth && retry && code === 'device_unauthorized') {
      await this.login()
      return await this.call(path, body, true, false)
    }
    throw new ApproverError('relay', code)
  }

  private async login(): Promise<void> {
    const device = this.requireDevice()
    this.session = undefined
    try {
      const challenge = await this.call('/device/challenge', { device: device.id }, false)
      const message = String(challenge.message)
      const reply = await this.call('/device/login', { device: device.id, challenge: challenge.challenge, signature: await sign(device.signing, message) }, false)
      this.session = String(reply.token)
    } catch (error) {
      if (error instanceof ApproverError && error.code === 'relay' && error.detail === 'device_unauthorized') {
        await this.publishLocal({ connected: false, registered: false, relayInjectors: null })
        throw new ApproverError('not-registered')
      }
      await this.publishLocal({ connected: false })
      throw error
    }
    await this.publishLocal({ connected: true, registered: true })
  }

  private async publishMatchers(): Promise<void> {
    if (this.session === undefined) return
    const device = this.requireDevice()
    const base = matcherBase()
    const matchers: Matcher[] = []
    for (const secret of await this.store.all('secrets')) {
      for (const label of ['default', ...Object.keys(secret.copies)]) {
        const m = await compileMatcher(secret.alias, await this.plain(secret, label), base)
        if (m !== null) matchers.push(m)
      }
    }
    const text = JSON.stringify({ approver: device.id, version: this.now(), base: base.toString(), matchers })
    await this.call('/approver/rules', { rules_text: text, signature: await sign(device.signing, 'secret-guard/rules/v1:' + text) }, true)
  }

  private async check(entry: RawEntry, p: RawRequest): Promise<RejectReason | 'expired' | ''> {
    const device = this.requireDevice()
    const injector = await this.store.get('injectors', p.injector)
    if (injector === undefined) return 'injector_not_paired'
    if (!await verify(injector.jwk, entry.signature, 'secret-guard/request/v1:' + entry.request_text)) return 'signature_invalid'
    if (p.domain !== 'secret-guard/approval/v2' || p.principal !== device.user) return 'request_invalid'
    if (!(p.expires_at * 1000 > this.now())) return 'expired'
    const d = p.details as Record<string, unknown> | undefined
    if (HOOK_KINDS.has(p.kind)) {
      const ok = d !== undefined && Object.keys(d).length === 6 && d.scope === p.kind
        && ['tool', 'target', 'summary', 'call'].every(k => typeof d[k] === 'string')
        && Array.isArray(d.secrets) && d.secrets.length > 0 && d.secrets.every(a => typeof a === 'string')
      if (!ok) return 'request_invalid'
      for (const alias of d.secrets as string[]) if (await this.store.get('secrets', alias) === undefined) return 'secret_unavailable'
      return ''
    }
    const secret = await this.store.get('secrets', p.secret_id ?? '')
    if (secret === undefined) return 'secret_unavailable'
    if (p.kind === 'reference') {
      return d !== undefined && REF_TYPES.has(String(d.type)) && d.scope === 'task_reference_only' && d.ttl_seconds === 3600 && Object.keys(d).length === 3 ? '' : 'request_invalid'
    }
    const args = d?.args as Record<string, unknown> | undefined
    if (p.kind !== 'use' || d === undefined || args === undefined || typeof args.repo !== 'string' || !REPO.test(args.repo) || !Number.isInteger(args.limit)) return 'request_invalid'
    const fixed = d.method === 'GET' && d.scheme === 'https' && d.host === 'api.github.com' && d.port === 443
      && d.path === `/repos/${args.repo}/actions/runs` && d.query === `per_page=${String(args.limit)}&page=1`
    if (!fixed) return 'request_changed'
    if (!secret.repos.includes(args.repo)) return 'policy_denied'
    return ''
  }

  private async automatic(p: RawRequest): Promise<{ why: 'all' | 'grant' | 'rule'; choices: Readonly<Record<string, ValueChoice>> } | null> {
    const f = facets(p)
    if (await this.store.setting('allUntil', 0) > this.now()) return { why: 'all', choices: {} }
    const grants = await this.store.setting('grants', [])
    const key = JSON.stringify([f.kind, f.names, p.project])
    const live = (g: Grant): boolean => (g.expires === null || g.expires > this.now()) && (g.remaining === null || g.remaining > 0)
    const index = grants.findIndex(g => g.key === key && live(g))
    const grant: Grant | undefined = grants[index]
    if (grant !== undefined) {
      if (grant.remaining !== null) await this.store.putSetting('grants', grants.map((g, i) => i === index ? { ...g, remaining: (g.remaining ?? 1) - 1 } : g))
      return { why: 'grant', choices: grant.choices }
    }
    for (const r of await this.store.setting('autoRules', [])) {
      if ((r.kind === '*' || r.kind === f.kind) && f.names.every(n => glob(r.secret, n)) && glob(r.tool, f.tool) && glob(r.target, f.target)) return { why: 'rule', choices: {} }
    }
    return null
  }

  private async resolve(alias: string, choice: ValueChoice = 'default'): Promise<string> {
    const secret = await this.store.get('secrets', alias)
    if (secret === undefined) throw new ApproverError('secret-missing')
    if (choice === 'mock') return mockValue(await this.plain(secret))
    if (choice.startsWith('manual:') && choice.length > 7) return choice.slice(7)
    if (choice.startsWith('copy:')) return await this.plain(secret, choice.slice(5))
    return await this.plain(secret)
  }

  private async sendDecision(entry: RawEntry, p: RawRequest, decision: 'approve' | 'deny', reason: string, choices: Readonly<Record<string, ValueChoice>>): Promise<void> {
    const device = this.requireDevice()
    const body: Record<string, unknown> = { request_id: p.request_id, decision }
    if (reason !== '') body.reason = reason
    if (decision === 'approve' && (p.kind === 'use' || p.kind === 'fill')) {
      const injector = await this.store.get('injectors', p.injector)
      if (injector === undefined) throw new ApproverError('relay', 'injector_not_paired')
      const names = facets(p).names
      const picked: Record<string, string> = {}
      for (const alias of names) picked[alias] = await this.resolve(alias, choices[alias])
      // Sealed to the key recorded at pairing, never to a key the relay supplies.
      body.sealed = await seal(injector.enc_jwk, bytes(p.kind === 'use' ? picked[names[0] ?? ''] ?? '' : JSON.stringify(picked)), await sealAad(entry.request_text))
    }
    body.signature = await sign(device.signing, `secret-guard/decision/v3:${decision}:${reason}:${device.id}:${entry.request_text}`)
    await this.call('/approver/decision', body, true)
  }

  private async card(entry: RawEntry, p: RawRequest): Promise<PendingRequest> {
    const f = facets(p)
    const copies: Record<string, readonly string[]> = {}
    for (const alias of f.names) copies[alias] = Object.keys((await this.store.get('secrets', alias))?.copies ?? {})
    return {
      id: p.request_id, kind: p.kind, project: p.project, task: p.task, injector: p.injector, secrets: f.names,
      tool: f.tool, target: f.target, operation: operation(p), expiresAt: p.expires_at * 1000, copies, requestText: entry.request_text,
    }
  }

  private async publishLocal(patch: Partial<ApproverState>): Promise<void> {
    const device = this.device
    const secrets = (await this.store.all('secrets')).map(s => ({ alias: s.alias, copies: Object.keys(s.copies), repos: s.repos }))
    this.state = {
      ...this.state, ...patch,
      device: device === undefined ? null : {
        id: device.id, user: device.user,
        pairing: JSON.stringify({ kind: 'approver', device: device.id, user: device.user, jwk: device.jwk }, null, 2),
      },
      injectors: (await this.store.all('injectors')).map(i => i.id),
      secrets,
      allUntil: await this.store.setting('allUntil', 0),
      autoRules: await this.store.setting('autoRules', []),
    }
    for (const listener of this.listeners) listener()
  }
}
