/**
 * Browser entry of the AlfredGo agent group page: mounts the Host group
 * Remote, follows its `watch` stream, and registers the main-panel page, its
 * sidebar entry, and the Session-row mark of group members.
 */
import type { Context } from '@deepseek-ai/cordis'
import agentGroupRemote from '@deepseek-ai/dsh-alfredgo-agent-group/remote'
import type {} from '@deepseek-ai/dsh-alfredgo-agent-group/remote'
import type { AgentGroupSnapshot } from '@deepseek-ai/dsh-alfredgo-agent-group/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { GroupInjected, PresetOption } from './group-actions.ts'
import { GroupIcon } from './GroupIcon.tsx'
import { GroupPage } from './GroupPage.tsx'
import { NS, zh, en, ja, es, fr, de, ru, pt } from './locales.ts'
import { SessionGroupMark } from './SessionGroupMark.tsx'
import { GroupSource } from './source.ts'

/** Services the page needs before it can mount its Remote and register its seats. */
export const inject = ['remote', 'slots', 'locale', 'uiWorkspace']

const PANEL_ID = 'agent-groups' as MainPanelId

function registerUi(ctx: Context): () => Promise<void> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'alfredgo-agent-group: dictionaries')
  const source = new GroupSource({
    remote: ctx.remote.agentGroups,
    watch: carrierFailed => ctx.remote.$stream<AgentGroupSnapshot>({
      name: 'Agent groups',
      open: signal => ctx.remote.agentGroups.watch(signal),
      ended: () => new Error('Agent groups stream ended'),
      carrierFailed,
    }),
    openSession: (sessionId) => { ctx.uiWorkspace.openSession(sessionId) },
    warn: (error) => { ctx.logger.warn('agent groups stream failed; reload the page to reconnect: %s', error) },
  })
  const presets = createSnapshotStore<readonly PresetOption[]>([])
  // Agent presets are optional: without that Remote every member uses the Host composition.
  ctx.inject(['remote.agentPresets'], (inner) => {
    void inner.remote.agentPresets.list().then((result) => {
      if (!result.ok) return
      presets.set(result.value.presets.filter(row => row.broken === undefined).map(row => ({ id: row.id, name: row.name ?? row.id })))
    })
  })
  const injected: GroupInjected = {
    hooks: { groups: source.state, failure: source.failure, presets },
    ...source.actions,
  }
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: PANEL_ID, locale: NS, inject: () => injected,
  }, GroupPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: PANEL_ID, order: 20, locale: NS, label: () => t('nav'),
  }, GroupIcon))
  ctx.slots.inject('sidebar.session.row.leading', () => ctx.slots.register({
    name: 'sidebar.session.row.leading', id: 'alfredgo-agent-group-mark', order: 20, locale: NS,
    inject: () => ({ hooks: { groups: source.state } }),
  }, SessionGroupMark))
  return () => source.dispose()
}

/**
 * Activate the group page.
 * @param ctx - Client runtime.
 * @returns disposer of the UI and the Remote contribution.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(agentGroupRemote)
  const ui = ctx.inject(['remote.agentGroups'], registerUi)
  try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
  return async () => { await ui.dispose(); await disposeRemote() }
}
