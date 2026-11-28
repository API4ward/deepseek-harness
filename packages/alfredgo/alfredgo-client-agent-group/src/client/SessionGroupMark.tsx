/** Sidebar Session-row mark of a Session that is a group member. */
import { IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { GroupInjected } from './group-actions.ts'
import type { NS } from './locales.ts'
import css from './GroupPage.module.css'

/** Group state bound into the Session-row mark. */
export interface SessionGroupMarkInjected {
  hooks: Pick<GroupInjected['hooks'], 'groups'>
}

/** Props of the Session-row mark: the row's Session and the shared group state. */
export type SessionGroupMarkProps =
  PropsRuntime<'sidebar.session.row.leading'> & PropsLocale<typeof NS> & InjectFace<SessionGroupMarkInjected>

/**
 * Render the people glyph while this row's Session belongs to a group.
 * @param props - the row's Session id, the group state hook, and the dictionary.
 * @returns the mark, or nothing for a Session outside every group.
 */
export function SessionGroupMark({ sessionId, useGroups, t }: SessionGroupMarkProps) {
  const label = useGroups((state) => {
    for (const group of state.groups) {
      const member = group.members.find(candidate => candidate.sessionId === sessionId)
      if (member !== undefined) return t('mark.aria', { group: group.title, name: member.name })
    }
    return undefined
  })
  if (label === undefined) return null
  return (
    <span className={css.mark} title={label} data-session-group-mark="">
      <IconUsersOutlineRegular size={14} />
      <span className={css.visuallyHidden}>{label}</span>
    </span>
  )
}
