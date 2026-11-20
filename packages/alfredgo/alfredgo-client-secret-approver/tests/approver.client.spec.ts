/** The approver core against a fake relay and a fake injector that verify every signature and open every sealed box. */
import { describe, expect, it } from 'vitest'
import { Approver, ApproverError, type RelayPath, type RelayTransport } from '../src/client/approver.ts'
import { b64, bytes, publicJwk, sealAad, unb64, type PublicJwk } from '../src/client/crypto.ts'
import { createMemoryStore } from '../src/client/store.ts'

const SECRET = 'whoami'
const USER = 'erow'

interface Entry { request_text: string; signature: string }

async function injectorKeys() {
  const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const enc = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const id = 'injector_test'
  const pairing = {
    kind: 'injector', device: id, user: USER,
    jwk: publicJwk(await crypto.subtle.exportKey('jwk', signing.publicKey)),
    enc_jwk: publicJwk(await crypto.subtle.exportKey('jwk', enc.publicKey)),
  }
  return { id, signing, enc, pairing }
}

/** Open a box sealed by the approver, as the injector's `seal.py` does. */
type Box = { epk: string; nonce: string; ct: string }

async function unseal(privateKey: CryptoKey, recipient: PublicJwk, box: Box, aad: Uint8Array<ArrayBuffer>): Promise<string> {
  const epk = await crypto.subtle.importKey('raw', unb64(box.epk), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: epk }, privateKey, 256)
  const recipientRaw = new Uint8Array(await crypto.subtle.exportKey('raw', await crypto.subtle.importKey('jwk', recipient, { name: 'ECDH', namedCurve: 'P-256' }, true, [])))
  const salt = new Uint8Array(130)
  salt.set(unb64(box.epk))
  salt.set(recipientRaw, 65)
  const base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: bytes('secret-guard/seal/v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.nonce), additionalData: aad }, key, unb64(box.ct)))
}

async function setup() {
  const injector = await injectorKeys()
  const entries: Entry[] = []
  const decisions: Record<string, unknown>[] = []
  const rules: Record<string, unknown>[] = []
  const calls: { path: RelayPath; token: string | undefined }[] = []
  const approverKey: { jwk?: PublicJwk } = {}
  let registered = true
  let tokenValid = true
  let clock = 1_800_000_000_000
  const verifyApprover = async (signature: string, text: string): Promise<boolean> => {
    const key = await crypto.subtle.importKey('jwk', approverKey.jwk!, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64(signature), bytes(text))
  }
  const relay: RelayTransport = async (path, body, token) => {
    calls.push({ path, token })
    const b = body as Record<string, unknown>
    if (token !== undefined && !tokenValid) { tokenValid = true; return { status: 403, data: { error: 'device_unauthorized' } } }
    switch (path) {
      case '/device/challenge':
        return registered ? { status: 200, data: { challenge: 'c1', message: 'login:c1' } } : { status: 403, data: { error: 'device_unauthorized' } }
      case '/device/login':
        return await verifyApprover(String(b.signature), 'login:c1') ? { status: 200, data: { token: 't1' } } : { status: 403, data: { error: 'signature_invalid' } }
      case '/approver/rules':
        if (!await verifyApprover(String(b.signature), 'secret-guard/rules/v1:' + String(b.rules_text))) return { status: 403, data: { error: 'signature_invalid' } }
        rules.push(JSON.parse(String(b.rules_text)) as Record<string, unknown>)
        return { status: 200, data: {} }
      case '/approver/pending':
        return { status: 200, data: { requests: entries.splice(0), injectors: [injector.id] } }
      case '/approver/decision': {
        const entry = sent.get(String(b.request_id))!
        const reason = typeof b.reason === 'string' ? b.reason : ''
        const ok = await verifyApprover(String(b.signature), `secret-guard/decision/v3:${String(b.decision)}:${reason}:${approver.getSnapshot().device!.id}:${entry.request_text}`)
        if (!ok) return { status: 403, data: { error: 'signature_invalid' } }
        decisions.push(b)
        return { status: 200, data: {} }
      }
    }
  }
  const sent = new Map<string, Entry>()
  const request = async (
    id: string, kind: string, details: Record<string, unknown>, extra: Record<string, unknown> = {}, sign = injector.signing.privateKey,
  ): Promise<Entry> => {
    const text = JSON.stringify({
      domain: 'secret-guard/approval/v2', principal: USER, request_id: id, kind, project: 'alfredgo', task: 'task_1',
      injector: injector.id, expires_at: clock / 1000 + 120, details, ...extra,
    })
    const signature = b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, sign, bytes('secret-guard/request/v1:' + text)))
    const entry = { request_text: text, signature }
    sent.set(id, entry)
    entries.push(entry)
    return entry
  }
  const hook = (kind: 'reveal' | 'fill', secrets: string[]) => ({ scope: kind, tool: 'read', target: '/srv/.env', summary: 'read .env', call: 'a'.repeat(64), secrets })
  const approver = new Approver(createMemoryStore(), relay, () => clock)
  await approver.load()
  await approver.createDevice(` ${USER} `)
  approverKey.jwk = (JSON.parse(approver.getSnapshot().device!.pairing) as { jwk: PublicJwk }).jwk
  return {
    approver, injector, entries, decisions, rules, calls, request, hook,
    unregister: () => { registered = false },
    expireToken: () => { tokenValid = false },
    advance: (ms: number) => { clock += ms },
    now: () => clock,
  }
}

async function ready() {
  const s = await setup()
  await s.approver.pairInjector(JSON.stringify(s.injector.pairing))
  await s.approver.addSecret('test_passwd', SECRET, ['Acme/Payments', ' '])
  await s.approver.connect()
  return s
}

describe('device and setup', () => {
  it('creates one device and shows public pairing data only', async () => {
    const s = await setup()
    const device = s.approver.getSnapshot().device!
    expect(device.user).toBe(USER)
    expect(device.id).toMatch(/^approver_/)
    const { jwk, ...pairing } = JSON.parse(device.pairing) as { jwk: PublicJwk }
    expect(pairing).toEqual({ kind: 'approver', device: device.id, user: USER })
    expect(jwk).toMatchObject({ kty: 'EC', crv: 'P-256' })
    expect(device.pairing).not.toContain('"d"')
    await expect(s.approver.createDevice('other')).rejects.toMatchObject({ code: 'device-exists' })
  })

  it('requires a user name and a device before other steps', async () => {
    const approver = new Approver(createMemoryStore(), () => Promise.reject(new Error('unused')))
    await approver.load()
    expect(approver.getSnapshot()).toMatchObject({ loaded: true, device: null })
    await expect(approver.createDevice('  ')).rejects.toMatchObject({ code: 'user-required' })
    await expect(approver.pairInjector('{}')).rejects.toMatchObject({ code: 'device-missing' })
    await expect(approver.refresh()).rejects.toMatchObject({ code: 'not-connected' })
  })

  it('pairs an injector of the same user once and rejects malformed pairing data', async () => {
    const s = await setup()
    await expect(s.approver.pairInjector('not json')).rejects.toMatchObject({ code: 'pairing-invalid' })
    await expect(s.approver.pairInjector(JSON.stringify({ ...s.injector.pairing, kind: 'approver' }))).rejects.toMatchObject({ code: 'pairing-invalid' })
    await expect(s.approver.pairInjector(JSON.stringify({ ...s.injector.pairing, jwk: { x: 'AA', y: 'AA' } }))).rejects.toMatchObject({ code: 'pairing-invalid' })
    await expect(s.approver.pairInjector(JSON.stringify({ ...s.injector.pairing, user: 'alice' }))).rejects.toMatchObject({ code: 'pairing-user' })
    await s.approver.pairInjector(JSON.stringify(s.injector.pairing))
    expect(s.approver.getSnapshot().injectors).toEqual([s.injector.id])
    await expect(s.approver.pairInjector(JSON.stringify(s.injector.pairing))).rejects.toMatchObject({ code: 'injector-exists' })
  })

  it('reports an unregistered device and signs in again when the session expires', async () => {
    const s = await setup()
    s.unregister()
    await expect(s.approver.connect()).rejects.toMatchObject({ code: 'not-registered' })
    expect(s.approver.getSnapshot()).toMatchObject({ connected: false, registered: false })
    const fresh = await ready()
    fresh.expireToken()
    await fresh.approver.refresh()
    expect(fresh.calls.filter(c => c.path === '/device/login')).toHaveLength(2)
    expect(fresh.approver.getSnapshot().relayInjectors).toEqual([fresh.injector.id])
  })

  it('stays disconnected on load when the relay refuses', async () => {
    const store = createMemoryStore()
    const first = new Approver(store, () => Promise.resolve({ status: 403, data: { error: 'device_unauthorized' } }))
    await first.load()
    await first.createDevice(USER)
    const second = new Approver(store, () => Promise.resolve({ status: 403, data: { error: 'device_unauthorized' } }))
    await second.load()
    expect(second.getSnapshot()).toMatchObject({ connected: false, registered: false, device: { user: USER } })
    const failing = new Approver(store, () => Promise.reject(new TypeError('network')))
    await expect(failing.load()).rejects.toThrow('network')
    const relayError = new Approver(store, () => Promise.resolve({ status: 500, data: {} }))
    await expect(relayError.load()).resolves.toBeUndefined()
    expect(relayError.getSnapshot().connected).toBe(false)
  })
})

describe('credentials', () => {
  it('stores credentials encrypted, validates input, and publishes signed matchers without plaintext', async () => {
    const s = await ready()
    await expect(s.approver.addSecret('bad alias', 'x', [])).rejects.toMatchObject({ code: 'alias-invalid' })
    await expect(s.approver.addSecret('a', '', [])).rejects.toMatchObject({ code: 'value-required' })
    await expect(s.approver.addSecret('a', 'x'.repeat(65537), [])).rejects.toMatchObject({ code: 'value-too-large' })
    await expect(s.approver.addSecret('a', 'x', ['not a repo'])).rejects.toMatchObject({ code: 'repo-invalid', detail: 'not a repo' })
    await s.approver.addCopy('test_passwd', 'team', 'other-value')
    await expect(s.approver.addCopy('missing', 'team', 'v')).rejects.toMatchObject({ code: 'secret-missing' })
    await expect(s.approver.addCopy('test_passwd', 'default', 'v')).rejects.toMatchObject({ code: 'copy-invalid' })
    expect(s.approver.getSnapshot().secrets).toEqual([{ alias: 'test_passwd', copies: ['team'], repos: ['acme/payments'] }])
    const last = s.rules.at(-1)!
    expect(last).toMatchObject({ approver: s.approver.getSnapshot().device!.id, matchers: [expect.objectContaining({ alias: 'test_passwd', length: SECRET.length }), expect.objectContaining({ alias: 'test_passwd' })] })
    expect(JSON.stringify(s.rules)).not.toContain(SECRET)
    await s.approver.removeSecret('test_passwd')
    expect(s.approver.getSnapshot().secrets).toEqual([])
    expect(s.rules.at(-1)).toMatchObject({ matchers: [] })
  })
})

describe('requests', () => {
  it('shows a reveal request and signs the approval without a sealed value', async () => {
    const s = await ready()
    await s.request('r1', 'reveal', s.hook('reveal', ['test_passwd']))
    await s.approver.refresh()
    const [card] = s.approver.getSnapshot().requests
    expect(card).toMatchObject({ id: 'r1', kind: 'reveal', secrets: ['test_passwd'], tool: 'read', target: '/srv/.env', operation: 'read .env', project: 'alfredgo' })
    await s.approver.decide('r1', 'approve')
    expect(s.decisions).toEqual([expect.objectContaining({ request_id: 'r1', decision: 'approve' })])
    expect(s.decisions[0]).not.toHaveProperty('sealed')
    await s.approver.decide('gone', 'approve')
    expect(s.decisions).toHaveLength(1)
  })

  it('seals the chosen value of a fill to the paired injector, bound to the request', async () => {
    const s = await ready()
    await s.approver.addCopy('test_passwd', 'team', 'copy-value')
    const open = async (id: string, choices: Record<string, string>) => {
      const entry = await s.request(id, 'fill', s.hook('fill', ['test_passwd']))
      await s.approver.refresh()
      expect(s.approver.getSnapshot().requests[0]!.copies).toEqual({ test_passwd: ['team'] })
      await s.approver.decide(id, 'approve', choices)
      const box = s.decisions.at(-1)!.sealed as Box
      const text = await unseal(s.injector.enc.privateKey, s.injector.pairing.enc_jwk, box, await sealAad(entry.request_text))
      return JSON.parse(text) as Record<string, string>
    }
    expect(await open('f1', {})).toEqual({ test_passwd: SECRET })
    expect(await open('f2', { test_passwd: 'copy:team' })).toEqual({ test_passwd: 'copy-value' })
    expect(await open('f3', { test_passwd: 'manual:typed' })).toEqual({ test_passwd: 'typed' })
    const mock = (await open('f4', { test_passwd: 'mock' })).test_passwd!
    expect(mock).toHaveLength(SECRET.length)
    expect(mock).toMatch(/^[a-z]+$/)
    await s.request('f5', 'fill', s.hook('fill', ['test_passwd']))
    await s.approver.refresh()
    await expect(s.approver.decide('f5', 'approve', { test_passwd: 'manual:' })).rejects.toMatchObject({ code: 'manual-required' })
    await expect(s.approver.decide('f5', 'approve', { test_passwd: 'copy:none' })).rejects.toMatchObject({ code: 'copy-missing' })
    await s.approver.decide('f5', 'deny')
    expect(s.decisions.at(-1)).toMatchObject({ request_id: 'f5', decision: 'deny' })
  })

  it('refuses what it can never approve, with a signed reason, and skips expired or unreadable entries', async () => {
    const s = await ready()
    const other = await injectorKeys()
    await s.request('a', 'reveal', s.hook('reveal', ['missing']))
    await s.request('b', 'reveal', s.hook('reveal', ['test_passwd']), { injector: 'injector_other' })
    await s.request('c', 'reveal', s.hook('reveal', ['test_passwd']), {}, other.signing.privateKey)
    await s.request('d', 'reveal', s.hook('reveal', ['test_passwd']), { principal: 'alice' })
    await s.request('e', 'reveal', { ...s.hook('reveal', ['test_passwd']), extra: 1 })
    await s.request('f', 'reveal', s.hook('reveal', ['test_passwd']), { expires_at: s.now() / 1000 - 1 })
    s.entries.push({ request_text: 'not json', signature: 'x' })
    await s.approver.refresh()
    expect(s.approver.getSnapshot().requests).toEqual([])
    expect(s.decisions.map(d => [d.request_id, d.reason])).toEqual([
      ['a', 'secret_unavailable'], ['b', 'injector_not_paired'], ['c', 'signature_invalid'], ['d', 'request_invalid'], ['e', 'request_invalid'],
    ])
    expect(s.approver.getSnapshot().notes.map(n => n.why)).toEqual(['secret_unavailable', 'injector_not_paired', 'signature_invalid', 'request_invalid', 'request_invalid'])
  })

  it('checks MCP reference and GitHub use requests against the stored repositories', async () => {
    const s = await ready()
    const use = (repo: string, path = `/repos/${repo}/actions/runs`) => ({
      args: { repo, limit: 5 }, method: 'GET', scheme: 'https', host: 'api.github.com', port: 443, path, query: 'per_page=5&page=1',
    })
    await s.request('ref', 'reference', { type: 'once', scope: 'task_reference_only', ttl_seconds: 3600 }, { secret_id: 'test_passwd' })
    await s.request('ref-bad', 'reference', { type: 'forever', scope: 'task_reference_only', ttl_seconds: 3600 }, { secret_id: 'test_passwd' })
    await s.request('use-ok', 'use', use('acme/payments'), { secret_id: 'test_passwd' })
    await s.request('use-other', 'use', use('acme/other'), { secret_id: 'test_passwd' })
    await s.request('use-changed', 'use', use('acme/payments', '/repos/acme/payments/secrets'), { secret_id: 'test_passwd' })
    await s.request('use-bad', 'use', { args: { repo: 'x' } }, { secret_id: 'test_passwd' })
    await s.request('use-missing', 'use', use('acme/payments'), { secret_id: 'nope' })
    await s.approver.refresh()
    expect(s.approver.getSnapshot().requests.map(r => [r.id, r.tool, r.target, r.operation])).toEqual([
      ['ref', '', '', 'once'],
      ['use-ok', 'github', 'acme/payments', 'GET https://api.github.com:443/repos/acme/payments/actions/runs?per_page=5&page=1'],
    ])
    expect(s.decisions.map(d => [d.request_id, d.reason])).toEqual([
      ['ref-bad', 'request_invalid'], ['use-other', 'policy_denied'], ['use-changed', 'request_changed'], ['use-bad', 'request_invalid'], ['use-missing', 'secret_unavailable'],
    ])
    const entry = (await s.request('use-2', 'use', use('acme/payments'), { secret_id: 'test_passwd' }))
    await s.approver.refresh()
    await s.approver.decide('use-2', 'approve')
    const box = s.decisions.at(-1)!.sealed as { epk: string; nonce: string; ct: string }
    expect(await unseal(s.injector.enc.privateKey, s.injector.pairing.enc_jwk, box, await sealAad(entry.request_text))).toBe(SECRET)
  })
})

describe('approval modes', () => {
  it('approves everything in approve-all mode until it ends', async () => {
    const s = await ready()
    await s.approver.setAllMode(10)
    expect(s.approver.getSnapshot().allUntil).toBe(s.now() + 600000)
    await s.request('x', 'reveal', s.hook('reveal', ['test_passwd']))
    await s.approver.refresh()
    expect(s.decisions.at(-1)).toMatchObject({ request_id: 'x', decision: 'approve' })
    expect(s.approver.getSnapshot().notes[0]).toMatchObject({ why: 'all', automatic: true })
    await s.approver.setAllMode(0)
    await s.request('y', 'reveal', s.hook('reveal', ['test_passwd']))
    await s.approver.refresh()
    expect(s.approver.getSnapshot().requests.map(r => r.id)).toEqual(['y'])
  })

  it('remembers "allow n times" and "allow for a while" for the same kind of request', async () => {
    const s = await ready()
    await s.request('g1', 'fill', s.hook('fill', ['test_passwd']))
    await s.approver.refresh()
    await s.approver.decide('g1', 'approve', { test_passwd: 'mock' }, { times: 2 })
    await s.request('g2', 'fill', s.hook('fill', ['test_passwd']))
    await s.request('g3', 'fill', s.hook('fill', ['test_passwd']))
    await s.approver.refresh()
    expect(s.decisions.map(d => d.request_id)).toEqual(['g1', 'g2'])
    expect(s.approver.getSnapshot().requests.map(r => r.id)).toEqual(['g3'])
    await s.approver.decide('g3', 'approve', {}, { seconds: 60 })
    await s.request('g4', 'fill', s.hook('fill', ['test_passwd']))
    await s.approver.refresh()
    expect(s.approver.getSnapshot().notes[0]).toMatchObject({ why: 'grant' })
    s.advance(61000)
    await s.request('g5', 'fill', s.hook('fill', ['test_passwd']))
    await s.approver.refresh()
    expect(s.approver.getSnapshot().requests.map(r => r.id)).toEqual(['g5'])
  })

  it('applies automatic rules by kind, alias, tool, and target globs', async () => {
    const s = await ready()
    await s.approver.addAutoRule({ kind: 'reveal', secret: 'test_*', tool: ' ', target: '/srv/?env' })
    await s.approver.addAutoRule({ kind: '*', secret: 'none', tool: '*', target: '*' })
    expect(s.approver.getSnapshot().autoRules).toEqual([
      { kind: 'reveal', secret: 'test_*', tool: '*', target: '/srv/?env' }, { kind: '*', secret: 'none', tool: '*', target: '*' },
    ])
    await s.request('r', 'reveal', s.hook('reveal', ['test_passwd']))
    await s.request('f', 'fill', s.hook('fill', ['test_passwd']))
    await s.approver.refresh()
    expect(s.decisions.map(d => d.request_id)).toEqual(['r'])
    expect(s.approver.getSnapshot().notes[0]).toMatchObject({ why: 'rule' })
    await s.approver.removeAutoRule(0)
    expect(s.approver.getSnapshot().autoRules).toHaveLength(1)
  })

  it('keeps a request on the card when an automatic approval fails at the relay', async () => {
    const s = await ready()
    await s.approver.setAllMode(5)
    await s.request('z', 'fill', s.hook('fill', ['test_passwd']))
    await s.approver.removeSecret('test_passwd')
    await s.approver.addSecret('test_passwd', SECRET, [])
    s.expireToken()
    s.expireToken()
    await s.approver.refresh()
    expect(s.decisions.map(d => d.request_id)).toEqual(['z'])
  })
})

it('notifies subscribers until they unsubscribe', async () => {
  const s = await setup()
  let count = 0
  const off = s.approver.subscribe(() => { count += 1 })
  await s.approver.setAllMode(1)
  off()
  await s.approver.setAllMode(0)
  expect(count).toBe(1)
  expect(new ApproverError('relay', 'x').message).toBe('relay: x')
})
