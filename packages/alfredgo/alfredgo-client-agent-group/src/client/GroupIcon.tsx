/** Decorative occupant of the group page's sidebar entry. */
import { IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the people glyph at the size the sidebar asks for; the sidebar owns the accessible label.
 * @param props - the sidebar's icon share.
 * @returns the decorative icon.
 */
export function GroupIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <IconUsersOutlineRegular size={size} />
}
