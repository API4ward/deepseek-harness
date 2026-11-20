/**
 * Browser entry of the AlfredGo credential approver: mounts the Host relay
 * forwarder, registers the settings page and the approval overlay, and polls the
 * relay for pending requests every two seconds while connected.
 */
import type { Context } from '@deepseek-ai/cordis'
import approverRemote from '@deepseek-ai/dsh-alfredgo-secret-approver/remote'
import type {} from '@deepseek-ai/dsh-alfredgo-secret-approver/remote'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { Approver, ApproverError, type RelayTransport } from './approver.ts'
import { createMemoryStore, openIndexedDbStore } from './store.ts'
import type { ApproverInjected, UiFailure } from './ui-actions.ts'
import { ApproverSection } from './ApproverSection.tsx'
import { ApprovalOverlay } from './ApprovalOverlay.tsx'
import { HistorySection } from './HistorySection.tsx'
import { NS, zh, en, ja, es, fr, de, ru, pt } from './locales.ts'

export const inject = ['remote', 'slots', 'locale']

/** Poll interval of the relay's pending queue, as in AgentSecret's browser approver. */
const POLL_MS = 2000

/**
 * Map a failure to the dictionary key the UI shows.
 * @param error - thrown value.
 * @returns key and detail.
 */
export function describeFailure(error: unknown): UiFailure {
  if (error instanceof ApproverError) return { key: `error.${error.code}` as const, detail: error.detail }
  return { key: 'error.unknown', detail: error instanceof Error ? error.message : String(error) }
}

function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }))
  const transport: RelayTransport = async (path, body, token) => {
    const result = await ctx.remote.secretApprover.relay({ path, body: JSON.stringify(body), ...token === undefined ? {} : { token } })
    if (!result.ok) throw new ApproverError('relay', result.error.message)
    let data: Record<string, unknown>
    try { data = JSON.parse(result.value.body) as Record<string, unknown> } catch { throw new ApproverError('relay', `HTTP ${result.value.status}`) }
    return { status: result.value.status, data }
  }
  const store = typeof indexedDB === 'undefined' ? createMemoryStore() : openIndexedDbStore(indexedDB)
  const approver = new Approver(store, transport)
  const failure = createSnapshotStore<UiFailure | null>(null)
  let relayUrl = ''
  const guarded = <A extends unknown[]>(action: (...args: A) => Promise<void>) => async (...args: A): Promise<void> => {
    try { await action(...args) } catch (error) {
      failure.set(describeFailure(error))
      throw error
    }
  }
  const actions: ApproverInjected = {
    hooks: { approverState: approver, approverFailure: failure },
    relayUrl: () => relayUrl,
    createDevice: guarded(user => approver.createDevice(user)),
    connect: guarded(() => approver.connect()),
    pairInjector: guarded(text => approver.pairInjector(text)),
    addSecret: guarded((alias, value, repos) => approver.addSecret(alias, value, repos)),
    addCopy: guarded((alias, label, value) => approver.addCopy(alias, label, value)),
    removeSecret: guarded(alias => approver.removeSecret(alias)),
    setAllMode: guarded(minutes => approver.setAllMode(minutes)),
    addAutoRule: guarded(rule => approver.addAutoRule(rule)),
    removeAutoRule: guarded(index => approver.removeAutoRule(index)),
    decide: guarded((id, decision, choices, grant) => approver.decide(id, decision, choices, grant)),
    clearHistory: guarded(() => approver.clearHistory()),
    clearFailure: () => { failure.set(null) },
  }
  let disposed = false
  let polling = false
  const timer = setInterval(() => {
    if (disposed || polling || !approver.getSnapshot().connected) return
    polling = true
    approver.refresh().then(() => { if (failure.getSnapshot()?.key === 'error.relay') failure.set(null) }, (error: unknown) => { failure.set(describeFailure(error)) })
      .finally(() => { polling = false })
  }, POLL_MS)
  ctx.effect(() => () => { disposed = true; clearInterval(timer) })
  void ctx.remote.secretApprover.info().then((result) => {
    if (result.ok) relayUrl = result.value.relayUrl
    return approver.load()
  }).catch((error: unknown) => { if (!disposed) failure.set(describeFailure(error)) })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'alfredgo-secret-approver', order: 50, label: () => ctx.locale.bind(NS)('nav'),
    locale: NS, inject: () => actions,
  }, ApproverSection))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'alfredgo-secret-approver-history', order: 51, label: () => ctx.locale.bind(NS)('history.nav'),
    locale: NS, inject: () => actions,
  }, HistorySection))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'alfredgo-secret-approver', locale: NS, inject: () => actions,
  }, ApprovalOverlay))
}

/**
 * Activate the approver.
 * @param ctx - Client runtime.
 * @returns disposer of the UI and the Remote contribution.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(approverRemote)
  const ui = ctx.inject(['remote.secretApprover', 'slots', 'locale'], registerUi)
  try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
  return async () => { await ui.dispose(); await disposeRemote() }
}
