// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { allowAllAccess, bindSnapshotSelector, contextMenuHook, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  AgentGroup, AgentGroupAssignment, AgentGroupAssignmentId, AgentGroupId, AgentGroupMember, AgentGroupMemberId,
} from '@deepseek-ai/dsh-alfredgo-agent-group/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { GroupState, PresetOption, UiFailure } from '../src/client/group-actions.ts'
import { GroupIcon } from '../src/client/GroupIcon.tsx'
import { GroupPage, type GroupPageProps } from '../src/client/GroupPage.tsx'
import { de, en, es, fr, ja, pt, ru, zh } from '../src/client/locales.ts'
import { SessionGroupMark } from '../src/client/SessionGroupMark.tsx'

afterEach(cleanup)

const member = (name: string, extra: Partial<AgentGroupMember> = {}): AgentGroupMember => ({
  id: `member-${name}` as AgentGroupMemberId, name, role: `${name} role`, origin: 'created', sessionId: `session-${name}` as SessionId, ...extra,
})
const lead = member('lead')
const dev = member('dev', { agentPreset: 'coder' })
const qa = member('qa', { origin: 'attached', role: '' })
const release: AgentGroup = {
  id: 'group-release' as AgentGroupId, title: 'Release', description: 'Ship it', cwd: '/work/app',
  members: [lead, dev, qa], edges: [{ superior: lead.id, subordinate: dev.id }], revision: 4,
  createdAt: '2026-11-28T00:00:00.000Z', updatedAt: '2026-11-28T00:00:00.000Z',
}
const empty: AgentGroup = { ...release, id: 'group-empty' as AgentGroupId, title: 'Research', description: '', members: [], edges: [], revision: 1 }
const { cwd: _cwd, ...emptyWithoutCwd } = empty

const free = 'session-free' as SessionId
const archived = 'session-archived' as SessionId
const child = 'session-child' as SessionId
const row = (id: SessionId, displayTitle: string, extra: object = {}) =>
  [id, { id, displayTitle, running: false, blank: false, updatedAt: 0, retainedBy: {}, ...extra }] as const
const sessions: SessionListState = {
  ids: [free, archived, child, lead.sessionId],
  byId: Object.fromEntries([
    row(free, 'Free conversation'), row(archived, 'Old conversation'), row(child, 'Helper', { origin: 'subagent' }),
    row(lead.sessionId, 'Lead conversation'),
  ]),
  phase: 'ready', projectionsBySession: {},
}
const workspaces: WorkspaceSnapshot = {
  items: [], archivedSessionIds: [archived], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
}

/** The hooks every slot occupant receives from the client runtime. */
function standardProps(): typeof allowAllAccess & Pick<GroupPageProps,
  'useSessions' | 'useWorkspaces' | 'usePanelInfo' | 'useSessionStatus' | 'useSessionRetainInfo' | 'useResource' | 'useContextMenu'> {
  return {
    useSessions: select => select(sessions),
    useWorkspaces: select => select(workspaces),
    usePanelInfo: select => select({ activePanelId: null }),
    useSessionStatus: select => select(new Map()),
    useSessionRetainInfo: () => undefined,
    useResource: () => { throw new Error('The group page loads no document resources') },
    ...allowAllAccess,
    useContextMenu: contextMenuHook(),
  }
}

function setup(initial: Partial<GroupState> = {}, t = makeTranslate(en)) {
  const groups = createSnapshotStore<GroupState>({ status: 'ready', groups: [release, emptyWithoutCwd], assignments: [], ...initial })
  const failure = createSnapshotStore<UiFailure | null>(null)
  const presets = createSnapshotStore<readonly PresetOption[]>([{ id: 'coder', name: 'Coder' }])
  const actions = {
    createGroup: vi.fn<GroupPageProps['createGroup']>(async () => empty.id),
    updateGroup: vi.fn<GroupPageProps['updateGroup']>(async () => true),
    removeGroup: vi.fn<GroupPageProps['removeGroup']>(async () => true),
    addMember: vi.fn<GroupPageProps['addMember']>(async () => true),
    attachSession: vi.fn<GroupPageProps['attachSession']>(async () => true),
    updateMember: vi.fn<GroupPageProps['updateMember']>(async () => true),
    removeMember: vi.fn<GroupPageProps['removeMember']>(async () => true),
    resetMember: vi.fn<GroupPageProps['resetMember']>(async () => true),
    setEdges: vi.fn<GroupPageProps['setEdges']>(async () => true),
    openMember: vi.fn<GroupPageProps['openMember']>(async () => {}),
    reportFailure: (value: UiFailure) => { failure.set(value) },
    clearFailure: () => { failure.set(null) },
  }
  const props: GroupPageProps = {
    t,
    useGroups: bindSnapshotSelector(groups),
    useFailure: bindSnapshotSelector(failure),
    usePresets: bindSnapshotSelector(presets),
    ...standardProps(),
    ...actions,
  }
  const view = render(<GroupPage {...props} />)
  return { groups, failure, actions, props, view }
}

const openTab = (name: string): void => { fireEvent.click(screen.getByRole('tab', { name })) }
const node = (name: string): HTMLElement => document.querySelector<HTMLElement>(`[data-member="member-${name}"]`)!
const text = makeTranslate(en)

describe('group list', () => {
  it('shows the first group and switches to the one the user picks', () => {
    setup()
    expect(screen.getByRole('heading', { level: 2, name: 'Release' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Release.*3 members/ }).getAttribute('aria-current')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /Research/ }))
    expect(screen.getByRole('heading', { level: 2, name: 'Research' })).toBeTruthy()
    expect(screen.getByText(en['member.none'])).toBeTruthy()
  })

  it('creates a group and selects it once the stream delivers it', async () => {
    const { actions, groups } = setup({ groups: [release] })
    fireEvent.change(screen.getByLabelText(en['group.namePlaceholder']), { target: { value: 'Research' } })
    fireEvent.click(screen.getByRole('button', { name: en['group.create'] }))
    await waitFor(() => { expect(actions.createGroup).toHaveBeenCalledWith('Research') })
    act(() => { groups.set({ status: 'ready', groups: [release, emptyWithoutCwd], assignments: [] }) })
    await waitFor(() => { expect(screen.getByRole('heading', { level: 2, name: 'Research' })).toBeTruthy() })
  })

  it('keeps the typed name when the Host refuses the new group', async () => {
    const { actions } = setup({ groups: [] })
    actions.createGroup.mockResolvedValueOnce(undefined)
    const input = screen.getByLabelText<HTMLInputElement>(en['group.namePlaceholder'])
    fireEvent.change(input, { target: { value: 'Research' } })
    fireEvent.click(screen.getByRole('button', { name: en['group.create'] }))
    await waitFor(() => { expect(actions.createGroup).toHaveBeenCalled() })
    expect(input.value).toBe('Research')
    expect(screen.getByText(en['group.empty'])).toBeTruthy()
  })

  it('says when groups are loading or the connection is lost', () => {
    const { groups } = setup({ status: 'loading', groups: [] })
    expect(screen.getByText(en['status.loading'])).toBeTruthy()
    act(() => { groups.set({ status: 'failed', groups: [], assignments: [] }) })
    expect(screen.getByText(en['status.failed'])).toBeTruthy()
  })

  it('deletes the selected group after confirmation', async () => {
    const { actions } = setup()
    fireEvent.click(screen.getByRole('button', { name: en['group.delete'] }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(text('group.deleteConfirm', { title: 'Release' }))).toBeTruthy()
    fireEvent.click(within(dialog).getByText(en.cancel))
    expect(actions.removeGroup).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en['group.delete'] }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.confirm }))
    await waitFor(() => { expect(actions.removeGroup).toHaveBeenCalledWith(release.id) })
  })

  it('shows a failure until the user dismisses it', () => {
    const { failure } = setup()
    act(() => { failure.set({ key: 'error.name-in-use', params: {} }) })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(en['error.name-in-use'])
    fireEvent.click(within(alert).getByRole('button'))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('members tab', () => {
  it('saves changed group settings', async () => {
    const { actions } = setup()
    const save = screen.getByRole('button', { name: en['group.save'] })
    expect(save).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText(en['group.title']), { target: { value: 'Release train' } })
    fireEvent.change(screen.getByLabelText(en['group.description']), { target: { value: 'Ship weekly' } })
    fireEvent.change(screen.getByLabelText(en['group.cwd']), { target: { value: '' } })
    fireEvent.click(save)
    await waitFor(() => {
      expect(actions.updateGroup).toHaveBeenCalledWith({ groupId: release.id, title: 'Release train', description: 'Ship weekly', cwd: '' })
    })
  })

  it('lists each member with its origin and preset, and opens its conversation', () => {
    const { actions } = setup()
    const devRow = screen.getByText('dev role').closest('li')!
    expect(within(devRow).getByText(en['member.origin.created'])).toBeTruthy()
    expect(within(devRow).getByText('Coder')).toBeTruthy()
    expect(within(screen.getByText('qa').closest('li')!).getByText(en['member.origin.attached'])).toBeTruthy()
    fireEvent.click(within(devRow).getByRole('button', { name: en['member.open'] }))
    expect(actions.openMember).toHaveBeenCalledWith({ groupId: release.id, memberId: dev.id })
  })

  it('edits a created member, including its preset', async () => {
    const { actions } = setup()
    const devRow = screen.getByText('dev role').closest('li')!
    fireEvent.click(within(devRow).getByRole('button', { name: en['member.edit'] }))
    const form = screen.getByDisplayValue('dev').closest('form')!
    fireEvent.change(within(form).getByLabelText(en['member.name']), { target: { value: 'developer' } })
    fireEvent.change(within(form).getByLabelText(en['member.role']), { target: { value: 'writes code' } })
    fireEvent.change(within(form).getByLabelText(en['member.preset']), { target: { value: '' } })
    fireEvent.click(within(form).getByRole('button', { name: en['member.save'] }))
    await waitFor(() => {
      expect(actions.updateMember).toHaveBeenCalledWith({
        groupId: release.id, memberId: dev.id, name: 'developer', role: 'writes code', agentPreset: '',
      })
    })
    await waitFor(() => { expect(screen.queryByDisplayValue('developer')).toBeNull() })
  })

  it('edits an attached member without a preset and can cancel', async () => {
    const { actions } = setup()
    const qaRow = screen.getByText('qa').closest('li')!
    fireEvent.click(within(qaRow).getByRole('button', { name: en['member.edit'] }))
    const form = screen.getByDisplayValue('qa').closest('form')!
    expect(within(form).queryByLabelText(en['member.preset'])).toBeNull()
    fireEvent.click(within(form).getByRole('button', { name: en.cancel }))
    expect(screen.queryByDisplayValue('qa')).toBeNull()
    fireEvent.click(within(screen.getByText('qa').closest('li')!).getByRole('button', { name: en['member.edit'] }))
    actions.updateMember.mockResolvedValueOnce(false)
    fireEvent.submit(screen.getByDisplayValue('qa').closest('form')!)
    await waitFor(() => { expect(actions.updateMember).toHaveBeenCalledWith({ groupId: release.id, memberId: qa.id, name: 'qa', role: '' }) })
    expect(screen.getByDisplayValue('qa')).toBeTruthy()
  })

  it('resets or removes a member only after confirmation', async () => {
    const { actions } = setup()
    const devRow = screen.getByText('dev role').closest('li')!
    fireEvent.click(within(devRow).getByRole('button', { name: en['member.reset'] }))
    expect(within(screen.getByRole('dialog')).getByText(text('member.resetConfirm', { name: 'dev' }))).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByText(en.cancel))
    expect(actions.resetMember).not.toHaveBeenCalled()
    fireEvent.click(within(devRow).getByRole('button', { name: en['member.reset'] }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.confirm }))
    await waitFor(() => { expect(actions.resetMember).toHaveBeenCalledWith({ groupId: release.id, memberId: dev.id }) })
    fireEvent.click(within(devRow).getByRole('button', { name: en['member.remove'] }))
    expect(within(screen.getByRole('dialog')).getByText(text('member.removeConfirm', { name: 'dev' }))).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.confirm }))
    await waitFor(() => { expect(actions.removeMember).toHaveBeenCalledWith({ groupId: release.id, memberId: dev.id }) })
  })

  it('creates a member with a preset and clears the form', async () => {
    const { actions } = setup()
    const form = screen.getByRole('form', { name: en['member.add'] })
    const name = within(form).getByLabelText<HTMLInputElement>(en['member.name'])
    fireEvent.change(name, { target: { value: 'ops' } })
    fireEvent.change(within(form).getByLabelText(en['member.role']), { target: { value: 'deploys' } })
    fireEvent.change(within(form).getByLabelText(en['member.preset']), { target: { value: 'coder' } })
    fireEvent.click(within(form).getByRole('button', { name: en['member.add'] }))
    await waitFor(() => {
      expect(actions.addMember).toHaveBeenCalledWith({ groupId: release.id, name: 'ops', role: 'deploys', agentPreset: 'coder' })
    })
    await waitFor(() => { expect(name.value).toBe('') })
    fireEvent.change(name, { target: { value: 'ops2' } })
    fireEvent.change(within(form).getByLabelText(en['member.preset']), { target: { value: '' } })
    actions.addMember.mockResolvedValueOnce(false)
    fireEvent.submit(form)
    await waitFor(() => { expect(actions.addMember).toHaveBeenLastCalledWith({ groupId: release.id, name: 'ops2', role: '' }) })
    expect(name.value).toBe('ops2')
  })

  it('offers only ordinary Sessions outside every group for attaching, and suggests the title as the name', async () => {
    const { actions } = setup()
    const form = screen.getByRole('form', { name: en['member.attach'] })
    const select = within(form).getByLabelText<HTMLSelectElement>(en['member.session'])
    expect([...select.options].map(option => option.textContent)).toEqual([en['member.sessionPlaceholder'], 'Free conversation'])
    expect(within(form).getByRole('button', { name: en['member.attach'] })).toHaveProperty('disabled', true)
    fireEvent.change(select, { target: { value: free } })
    const name = within(form).getByLabelText<HTMLInputElement>(en['member.name'])
    expect(name.value).toBe('Free conversation')
    fireEvent.change(name, { target: { value: 'analyst' } })
    fireEvent.change(select, { target: { value: free } })
    expect(name.value).toBe('analyst')
    fireEvent.change(within(form).getByLabelText(en['member.role']), { target: { value: 'reads data' } })
    fireEvent.click(within(form).getByRole('button', { name: en['member.attach'] }))
    await waitFor(() => {
      expect(actions.attachSession).toHaveBeenCalledWith({ groupId: release.id, sessionId: free, name: 'analyst', role: 'reads data' })
    })
    await waitFor(() => { expect(name.value).toBe('') })
  })

  it('says so when no Session can be attached', () => {
    setup({ groups: [{ ...release, members: [...release.members, member('free', { sessionId: free })] }] })
    const select = within(screen.getByRole('form', { name: en['member.attach'] })).getByLabelText<HTMLSelectElement>(en['member.session'])
    expect([...select.options].map(option => option.textContent)).toEqual([en['member.noSessions']])
    fireEvent.submit(screen.getByRole('form', { name: en['member.attach'] }))
  })
})

describe('relations tab', () => {
  it('asks for two members before lines can be drawn', () => {
    setup({ groups: [emptyWithoutCwd] })
    openTab(en['tab.relations'])
    expect(screen.getByText(en['relations.empty'])).toBeTruthy()
  })

  it('draws members with their lines and marks members without a superior as entries', () => {
    setup()
    openTab(en['tab.relations'])
    const graph = screen.getByRole('group', { name: en['relations.graphLabel'] })
    expect(within(graph).getByRole('button', { name: 'lead is the superior of dev' })).toBeTruthy()
    expect(within(node('lead')).getByText(en['relations.entry'])).toBeTruthy()
    expect(within(node('qa')).getByText(en['relations.entry'])).toBeTruthy()
    expect(within(node('dev')).queryByText(en['relations.entry'])).toBeNull()
    expect(screen.getByRole('button', { name: en['relations.save'] })).toHaveProperty('disabled', true)
  })

  it('adds a second superior by dragging and saves the whole set against the revision it read', async () => {
    const { actions } = setup()
    openTab(en['tab.relations'])
    fireEvent.pointerDown(node('qa').querySelector('[data-handle]')!, { clientX: 10, clientY: 10 })
    fireEvent.pointerMove(screen.getByRole('group', { name: en['relations.graphLabel'] }), { clientX: 30, clientY: 40 })
    fireEvent.pointerUp(within(node('dev')).getByRole('button'))
    expect(screen.getByRole('button', { name: 'qa is the superior of dev' })).toBeTruthy()
    expect(screen.getByText(en['relations.unsaved'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['relations.save'] }))
    await waitFor(() => {
      expect(actions.setEdges).toHaveBeenCalledWith({
        groupId: release.id, expectedRevision: 4,
        edges: [{ superior: lead.id, subordinate: dev.id }, { superior: qa.id, subordinate: dev.id }],
      })
    })
  })

  it('draws nothing when a drag ends on its own member, outside every member, or leaves the graph', () => {
    setup()
    openTab(en['tab.relations'])
    const graph = screen.getByRole('group', { name: en['relations.graphLabel'] })
    const handle = node('qa').querySelector('[data-handle]')!
    fireEvent.pointerDown(handle)
    fireEvent.pointerUp(within(node('qa')).getByRole('button'))
    fireEvent.pointerDown(handle)
    fireEvent.pointerUp(graph)
    fireEvent.pointerDown(handle)
    fireEvent.pointerLeave(graph)
    fireEvent.pointerUp(within(node('dev')).getByRole('button'))
    fireEvent.pointerMove(graph)
    expect(screen.queryByText(en['relations.unsaved'])).toBeNull()
  })

  it('refuses a line that would close a cycle and names the members', () => {
    setup()
    openTab(en['tab.relations'])
    fireEvent.pointerDown(node('dev').querySelector('[data-handle]')!)
    fireEvent.pointerUp(within(node('lead')).getByRole('button'))
    expect(screen.getByRole('alert').textContent).toContain(text('relations.cycle', { cycle: 'dev → lead → dev' }))
    expect(screen.queryByText(en['relations.unsaved'])).toBeNull()
  })

  it('edits the selected member\'s superiors and subordinates with checkboxes', async () => {
    const { actions } = setup()
    openTab(en['tab.relations'])
    expect(screen.getByText(en['member.noneSelected'])).toBeTruthy()
    fireEvent.click(within(node('dev')).getByRole('button'))
    const superiors = screen.getByRole('group', { name: en['member.superiors'] })
    const subordinates = screen.getByRole('group', { name: en['member.subordinates'] })
    expect(within(superiors).getByRole('checkbox', { name: 'lead' })).toHaveProperty('checked', true)
    fireEvent.click(within(superiors).getByRole('checkbox', { name: 'lead' }))
    fireEvent.click(within(subordinates).getByRole('checkbox', { name: 'qa' }))
    fireEvent.click(screen.getByRole('button', { name: en['relations.save'] }))
    await waitFor(() => {
      expect(actions.setEdges).toHaveBeenCalledWith({
        groupId: release.id, expectedRevision: 4, edges: [{ superior: dev.id, subordinate: qa.id }],
      })
    })
    fireEvent.click(within(node('dev')).getByRole('button'))
    expect(screen.getByText(en['member.noneSelected'])).toBeTruthy()
  })

  it('removes a selected line with the button or the keyboard, and reverts the draft', () => {
    setup()
    openTab(en['tab.relations'])
    const edge = screen.getByRole('button', { name: 'lead is the superior of dev' })
    fireEvent.click(edge)
    fireEvent.click(screen.getByRole('button', { name: en['relations.removeEdge'] }))
    expect(screen.queryByRole('button', { name: 'lead is the superior of dev' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en['relations.revert'] }))
    const restored = screen.getByRole('button', { name: 'lead is the superior of dev' })
    fireEvent.keyDown(restored, { key: 'Enter' })
    expect(restored.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(restored)
    expect(restored.getAttribute('aria-pressed')).toBe('false')
    fireEvent.keyDown(restored, { key: 'a' })
    fireEvent.keyDown(restored, { key: ' ' })
    fireEvent.keyDown(restored, { key: 'Backspace' })
    expect(screen.queryByRole('button', { name: 'lead is the superior of dev' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en['relations.revert'] }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'lead is the superior of dev' }), { key: 'Delete' })
    expect(screen.getByText(en['relations.unsaved'])).toBeTruthy()
  })

  it('clears the selection when the empty canvas is clicked and keeps the draft after a refused save', async () => {
    const { actions } = setup()
    openTab(en['tab.relations'])
    fireEvent.click(within(node('dev')).getByRole('button'))
    fireEvent.click(screen.getByRole('group', { name: en['relations.graphLabel'] }))
    expect(screen.getByText(en['member.noneSelected'])).toBeTruthy()
    fireEvent.click(within(node('qa')).getByRole('button'))
    fireEvent.click(within(screen.getByRole('group', { name: en['member.superiors'] })).getByRole('checkbox', { name: 'dev' }))
    fireEvent.click(screen.getByRole('button', { name: 'dev is the superior of qa' }))
    expect(screen.getByText(en['member.noneSelected'])).toBeTruthy()
    actions.setEdges.mockResolvedValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: en['relations.save'] }))
    await waitFor(() => { expect(actions.setEdges).toHaveBeenCalled() })
    await waitFor(() => { expect(screen.getByRole('button', { name: en['relations.save'] })).toHaveProperty('disabled', false) })
    expect(screen.getByText(en['relations.unsaved'])).toBeTruthy()
  })

  it('drops draft lines of a member that left while editing', () => {
    const { groups } = setup()
    openTab(en['tab.relations'])
    fireEvent.pointerDown(node('lead').querySelector('[data-handle]')!)
    fireEvent.pointerUp(within(node('qa')).getByRole('button'))
    act(() => { groups.set({ status: 'ready', groups: [{ ...release, members: [lead, dev], revision: 5 }], assignments: [] }) })
    expect(screen.queryByRole('button', { name: 'lead is the superior of qa' })).toBeNull()
    expect(screen.queryByText(en['relations.unsaved'])).toBeNull()
  })
})

describe('activity tab', () => {
  const assignment = (id: string, extra: Partial<AgentGroupAssignment>): AgentGroupAssignment => ({
    id: id as AgentGroupAssignmentId, groupId: release.id, from: lead.id, to: dev.id, summary: `task ${id}`, status: 'open',
    createdAt: '2026-11-28T01:00:00.000Z', ...extra,
  })

  it('lists the group\'s assignments, newest first', () => {
    setup({
      assignments: [
        assignment('a-1', {}),
        assignment('a-2', { createdAt: '2026-11-28T03:00:00.000Z', status: 'reported', reportedAt: '2026-11-28T04:00:00.000Z' }),
        assignment('a-3', { createdAt: '2026-11-28T03:00:00.000Z' }),
        assignment('a-4', { createdAt: '2026-11-28T02:00:00.000Z', to: 'member-gone' as AgentGroupMemberId }),
        assignment('a-5', { groupId: empty.id }),
      ],
    })
    openTab(en['tab.activity'])
    const rows = screen.getAllByRole('listitem').filter(item => item.textContent?.includes('task a-'))
    expect(rows.map(item => /task a-\d/.exec(item.textContent ?? '')?.[0])).toEqual(['task a-2', 'task a-3', 'task a-4', 'task a-1'])
    expect(within(rows[0]!).getByText('lead → dev')).toBeTruthy()
    expect(within(rows[0]!).getByText(en['activity.reported'])).toBeTruthy()
    expect(within(rows[1]!).getByText(en['activity.open'])).toBeTruthy()
    expect(within(rows[2]!).getByText('lead → member-gone')).toBeTruthy()
  })

  it('says when nothing was assigned yet', () => {
    setup()
    openTab(en['tab.activity'])
    expect(screen.getByText(en['activity.none'])).toBeTruthy()
  })
})

describe('sidebar', () => {
  it('marks the Session row of a group member and no other row', () => {
    const groups = createSnapshotStore<GroupState>({ status: 'ready', groups: [emptyWithoutCwd, release], assignments: [] })
    const props = { ...standardProps(), useGroups: bindSnapshotSelector(groups), t: makeTranslate(en) }
    const { container, rerender } = render(<SessionGroupMark {...props} sessionId={dev.sessionId} />)
    expect(screen.getByText(text('mark.aria', { group: 'Release', name: 'dev' }))).toBeTruthy()
    expect(container.querySelector('[data-session-group-mark]')).not.toBeNull()
    rerender(<SessionGroupMark {...props} sessionId={free} />)
    expect(container.querySelector('[data-session-group-mark]')).toBeNull()
  })

  it('draws the panel icon at the requested size', () => {
    const { container } = render(<GroupIcon {...standardProps()} size={18} active={false} />)
    expect(container.querySelector('svg')).not.toBeNull()
  })
})

describe('dictionaries', () => {
  it('give every language the same keys and placeholders as the Chinese source', () => {
    const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]!).sort()
    for (const dictionary of [en, ja, es, fr, de, ru, pt]) {
      expect(Object.keys(dictionary).sort()).toEqual(Object.keys(zh).sort())
      for (const [key, text] of Object.entries(zh)) {
        expect(placeholders((dictionary as Record<string, string>)[key]!), key).toEqual(placeholders(text))
      }
    }
  })

  it('renders the page in Chinese', () => {
    setup({}, makeTranslate(zh))
    expect(screen.getByRole('tab', { name: zh['tab.relations'] })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Release.*3 个成员/ })).toBeTruthy()
  })
})
