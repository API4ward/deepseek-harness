/** Assignments of one group, newest first. */
import type { ReactNode } from 'react'
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentGroup, AgentGroupMemberId } from '@deepseek-ai/dsh-alfredgo-agent-group/client'
import type { GroupPageProps } from './GroupPage.tsx'
import css from './GroupPage.module.css'

/**
 * List who assigned what to whom and whether a report came back.
 * @param props - page props and the group shown.
 * @returns the activity tab body.
 */
export function ActivityTab({ group, t, useGroups }: GroupPageProps & { readonly group: AgentGroup }): ReactNode {
  const assignments = useGroups(state => state.assignments)
  const own = assignments.filter(assignment => assignment.groupId === group.id)
    .toSorted((a, b) => a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)
  const nameOf = (id: AgentGroupMemberId): string => group.members.find(member => member.id === id)?.name ?? id
  return (
    <div className={css.section} role="tabpanel" id="agent-group-panel-activity" aria-labelledby="agent-group-tab-activity">
      {own.length === 0 ? <p className={css.muted}>{t('activity.none')}</p> : (
        <ul className={css.records}>
          {own.map(assignment => (
            <li key={assignment.id} className={css.record}>
              <div className={css.recordHead}>
                <strong>{`${nameOf(assignment.from)} → ${nameOf(assignment.to)}`}</strong>
                <Tag tone={assignment.status === 'open' ? 'info' : 'success'}>{t(`activity.${assignment.status}`)}</Tag>
                <time dateTime={assignment.createdAt}>{new Date(assignment.createdAt).toLocaleString()}</time>
              </div>
              <span>{assignment.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
