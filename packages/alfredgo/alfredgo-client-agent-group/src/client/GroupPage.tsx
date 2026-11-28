/** Main-panel page of agent groups: the group list and the selected group's members, reporting lines, and activity. */
import { useState, type ReactNode } from 'react'
import { Button, Input, Modal, SegmentedTabs } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { AgentGroupId } from '@deepseek-ai/dsh-alfredgo-agent-group/client'
import { ActivityTab } from './ActivityTab.tsx'
import type { GroupInjected } from './group-actions.ts'
import type { NS } from './locales.ts'
import { MembersTab } from './MembersTab.tsx'
import { RelationsTab } from './RelationsTab.tsx'
import css from './GroupPage.module.css'

/** Props of the group page: the main-panel runtime, the dictionary, and the injected state and actions. */
export type GroupPageProps = PropsRuntime<'main'> & PropsLocale<typeof NS> & InjectFace<GroupInjected>

type TabId = 'members' | 'relations' | 'activity'

/**
 * Render the group list beside the selected group's tabs.
 * @param props - injected group state, actions, and the dictionary.
 * @returns the page.
 */
export function GroupPage(props: GroupPageProps): ReactNode {
  const { t, useGroups, useFailure, createGroup, removeGroup, clearFailure } = props
  const state = useGroups(snapshot => snapshot)
  const failure = useFailure(current => current)
  const [selectedId, setSelectedId] = useState<AgentGroupId | null>(null)
  const [tab, setTab] = useState<TabId>('members')
  const [title, setTitle] = useState('')
  const [deleting, setDeleting] = useState(false)
  const group = state.groups.find(candidate => candidate.id === selectedId) ?? state.groups[0]

  return (
    <div className={css.page}>
      <aside className={css.listPane}>
        <h2>{t('nav')}</h2>
        <p className={css.muted}>{t('intro')}</p>
        <form
          className={css.row}
          aria-label={t('group.new')}
          onSubmit={(event) => {
            event.preventDefault()
            void createGroup(title).then((id) => {
              if (id === undefined) return
              setTitle('')
              setSelectedId(id)
              setTab('members')
            })
          }}
        >
          <Input
            value={title}
            maxLength={60}
            placeholder={t('group.namePlaceholder')}
            aria-label={t('group.namePlaceholder')}
            onChange={(event) => { setTitle(event.target.value) }}
          />
          <Button type="submit" variant="primary" size="sm" disabled={title.trim() === ''}>{t('group.create')}</Button>
        </form>
        {state.status === 'loading' && <p className={css.muted} role="status">{t('status.loading')}</p>}
        {state.status === 'failed' && <p className={css.muted} role="status">{t('status.failed')}</p>}
        {state.status === 'ready' && state.groups.length === 0 && <p className={css.muted}>{t('group.empty')}</p>}
        <ul className={css.groups}>
          {state.groups.map(each => (
            <li key={each.id}>
              <button
                type="button"
                className={css.groupRow}
                aria-current={each.id === group?.id}
                onClick={() => { setSelectedId(each.id); clearFailure() }}
              >
                <span>{each.title}</span>
                <span className={css.muted}>{t('group.members', { count: each.members.length })}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main className={css.detail}>
        {failure !== null && (
          <p className={css.failure} role="alert">
            <span>{t(failure.key, failure.params)}</span>
            <Button variant="ghost" size="sm" onClick={clearFailure}>{t('confirm')}</Button>
          </p>
        )}
        {group === undefined ? (state.groups.length > 0 && <p className={css.muted}>{t('group.select')}</p>) : (
          <>
            <div className={css.detailHead}>
              <h2>{group.title}</h2>
              <Button variant="outline" size="sm" onClick={() => { setDeleting(true) }}>{t('group.delete')}</Button>
            </div>
            <SegmentedTabs
              className={css.tabs}
              size="sm"
              label={t('tab.label')}
              value={tab}
              onChange={setTab}
              items={[
                { value: 'members', label: t('tab.members'), id: 'agent-group-tab-members', panelId: 'agent-group-panel-members' },
                { value: 'relations', label: t('tab.relations'), id: 'agent-group-tab-relations', panelId: 'agent-group-panel-relations' },
                { value: 'activity', label: t('tab.activity'), id: 'agent-group-tab-activity', panelId: 'agent-group-panel-activity' },
              ]}
            />
            {tab === 'members' && <MembersTab key={group.id} {...props} group={group} />}
            {tab === 'relations' && <RelationsTab key={group.id} {...props} group={group} />}
            {tab === 'activity' && <ActivityTab {...props} group={group} />}
            <Modal
              open={deleting}
              onClose={() => { setDeleting(false) }}
              closeLabel={t('cancel')}
              title={t('group.delete')}
              description={t('group.deleteConfirm', { title: group.title })}
              footer={(
                <>
                  <Button variant="ghost" onClick={() => { setDeleting(false) }}>{t('cancel')}</Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setDeleting(false)
                      void removeGroup(group.id).then((ok) => { if (ok) setSelectedId(null) })
                    }}
                  >
                    {t('confirm')}
                  </Button>
                </>
              )}
            />
          </>
        )}
      </main>
    </div>
  )
}
