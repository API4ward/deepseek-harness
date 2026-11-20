/** The Host forwarder relays only approver routes, to the configured relay origin, without browser headers. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it } from 'vitest'
import SecretApproverController, { type FetchLike } from '../src/index.ts'
import type { RelayPath } from '../src/types.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => root.fiber.dispose())) })

function fixture(fetchImpl: FetchLike, relayUrl = 'http://127.0.0.1:8780/ignored/path') {
  const ctx = new Context()
  roots.push(ctx)
  return new SecretApproverController(ctx, SecretApproverController.Config({ relayUrl }), fetchImpl)
}
const signal = new AbortController().signal
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

it('forwards an approver call with its token and returns the relay answer unchanged', async () => {
  const seen: { url: string; init: RequestInit }[] = []
  const api = fixture((url, init) => { seen.push({ url, init }); return Promise.resolve(json({ error: 'device_unauthorized' }, 403)) })
  expect(api.info()).toEqual({ relayUrl: 'http://127.0.0.1:8780' })
  expect(await api.relay({ path: '/approver/pending', body: '{}', token: 't1' }, signal)).toEqual({ status: 403, body: '{"error":"device_unauthorized"}' })
  expect(await api.relay({ path: '/device/challenge', body: '{"device":"d"}' }, signal)).toMatchObject({ status: 403 })
  expect(seen.map(s => [s.url, s.init.headers, s.init.redirect, s.init.body])).toEqual([
    ['http://127.0.0.1:8780/approver/pending', { 'Content-Type': 'application/json', Authorization: 'Bearer t1' }, 'error', '{}'],
    ['http://127.0.0.1:8780/device/challenge', { 'Content-Type': 'application/json' }, 'error', '{"device":"d"}'],
  ])
})

it('refuses other routes and oversized bodies before contacting the relay', async () => {
  let called = false
  const api = fixture(() => { called = true; return Promise.resolve(json({})) })
  await expect(api.relay({ path: '/relay/admin' as RelayPath, body: '{}' }, signal)).rejects.toMatchObject({ code: 'gateway/bad-request' })
  await expect(api.relay({ path: '/approver/rules', body: 'x'.repeat(1024 * 1024 + 1) }, signal)).rejects.toMatchObject({ code: 'gateway/bad-request' })
  expect(called).toBe(false)
})

it('reports an unreachable relay or a non-JSON answer, and passes cancellation through', async () => {
  const down = fixture(() => Promise.reject(new TypeError('fetch failed')))
  await expect(down.relay({ path: '/approver/pending', body: '{}' }, signal)).rejects.toMatchObject({ code: 'secret-approver/relay-unreachable', details: { reason: 'fetch failed' } })
  const html = fixture(() => Promise.resolve(new Response('<html>', { status: 404 })))
  await expect(html.relay({ path: '/approver/pending', body: '{}' }, signal)).rejects.toMatchObject({ code: 'secret-approver/relay-unreachable', details: { reason: 'HTTP 404' } })
  // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- fetch implementations may reject with a non-Error value.
  const odd = fixture(() => Promise.reject('down'))
  await expect(odd.relay({ path: '/approver/pending', body: '{}' }, signal)).rejects.toMatchObject({ details: { reason: 'down' } })
  const aborted = new AbortController()
  aborted.abort(new Error('cancelled'))
  await expect(down.relay({ path: '/approver/pending', body: '{}' }, aborted.signal)).rejects.toThrow('cancelled')
})

it('rejects a relay URL that is not http or https', () => {
  expect(() => fixture(() => Promise.resolve(json({})), 'file:///tmp/relay')).toThrow('relayUrl must use http or https')
})
