/** Group management, reporting-line validation, and assignment and report delivery. */
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { afterEach, expect, it } from 'vitest'
import type { AgentGroup, AgentGroupAssignmentId, AgentGroupId, AgentGroupMemberId } from '../src/types.ts'
import { AgentGroupError } from '../src/index.ts'
import { harness, sid } from './harness.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => root.fiber.dispose())) })

async function fixture(options: Parameters<typeof harness>[0] = {}) {
  const h = await harness(options)
  roots.push(h.ctx)
  return h
}

/** A group `lead > fe, be > qa`: `qa` has two superiors. */
async function team(h: Awaited<ReturnType<typeof fixture>>) {
  let group = await h.service.create({ title: 'Product', description: 'Ships the app', cwd: '/work/app' })
  for (const name of ['lead', 'fe', 'be', 'qa']) {
    group = await h.service.addMember({ groupId: group.id, name, role: `${name} role`, ...(name === 'qa' ? { agentPreset: 'standard' } : {}) })
  }
  const id = (name: string): AgentGroupMemberId => group.members.find(member => member.name === name)!.id
  group = await h.service.setEdges({
    groupId: group.id,
    expectedRevision: group.revision,
    edges: [
      { superior: id('lead'), subordinate: id('fe') }, { superior: id('lead'), subordinate: id('be') },
      { superior: id('fe'), subordinate: id('qa') }, { superior: id('be'), subordinate: id('qa') },
    ],
  })
  const session = (name: string) => group.members.find(member => member.name === name)!.sessionId
  return { group, id, session }
}

const refusal = async (work: Promise<unknown>): Promise<AgentGroupError> => {
  const error: unknown = await work.then(() => undefined, (reason: unknown) => reason)
  expect(error).toBeInstanceOf(AgentGroupError)
  return error as AgentGroupError
}
const text = (message: { content: readonly { type: string; text?: string }[] }): string => message.content.map(block => block.text).join('')

it('stores groups, members, and several superiors for one member, and reloads them after a restart', async () => {
  const first = await fixture()
  const { group } = await team(first)
  expect(group.members.map(member => [member.name, member.origin, member.agentPreset])).toEqual([
    ['lead', 'created', undefined], ['fe', 'created', undefined], ['be', 'created', undefined], ['qa', 'created', 'standard'],
  ])
  expect(group.edges).toHaveLength(4)
  expect(group.revision).toBe(6)
  await first.ctx.fiber.dispose()
  const second = await fixture({ pool: first.pool })
  expect((await second.service.snapshot()).groups).toEqual([group])
  expect(second.service.isMember(group.members[0]!.sessionId)).toBe(true)
  expect(second.service.isMember(sid('other'))).toBe(false)
})

it('refuses a cycle and names the members along it', async () => {
  const h = await fixture()
  const { group, id } = await team(h)
  const error = await refusal(h.service.setEdges({
    groupId: group.id, expectedRevision: group.revision, edges: [...group.edges, { superior: id('qa'), subordinate: id('lead') }],
  }))
  expect(error.code).toBe('cycle')
  expect(error.cycle).toEqual(['lead', 'fe', 'qa', 'lead'])
  expect(error.message).toBe('These reporting lines form a cycle: lead → fe → qa → lead. Remove one of them.')
  expect((await h.service.snapshot()).groups[0]!.edges).toEqual(group.edges)
})

it('refuses self-supervision, unknown members, and an edit based on a stale revision; drops duplicate lines', async () => {
  const h = await fixture()
  const { group, id } = await team(h)
  const edit = (edges: AgentGroup['edges'], expectedRevision = group.revision) =>
    h.service.setEdges({ groupId: group.id, expectedRevision, edges })
  expect((await refusal(edit([{ superior: id('fe'), subordinate: id('fe') }]))).message).toBe('"fe" cannot be its own superior.')
  expect((await refusal(edit([{ superior: id('fe'), subordinate: brandString<AgentGroupMemberId>('ghost') }]))).code).toBe('member-not-found')
  expect((await refusal(edit([], group.revision - 1))).code).toBe('conflict')
  const line = { superior: id('lead'), subordinate: id('qa') }
  expect((await edit([line, line])).edges).toEqual([line])
})

it('validates names and enforces the member limit', async () => {
  const h = await fixture({ config: { maxMembersPerGroup: 2 } })
  expect((await refusal(h.service.create({ title: '  ' }))).code).toBe('invalid-input')
  const group = await h.service.create({ title: 'G' })
  expect(group).toMatchObject({ description: '', members: [], edges: [], revision: 1 })
  expect(group.cwd).toBeUndefined()
  await h.service.addMember({ groupId: group.id, name: 'Lead', role: '' })
  expect((await refusal(h.service.addMember({ groupId: group.id, name: 'lead', role: '' }))).code).toBe('name-in-use')
  expect((await refusal(h.service.addMember({ groupId: group.id, name: 'a/b', role: '' }))).code).toBe('invalid-input')
  await h.service.addMember({ groupId: group.id, name: 'two', role: '' })
  expect((await refusal(h.service.addMember({ groupId: group.id, name: 'three', role: '' }))).code).toBe('limit')
  expect((await refusal(h.service.addMember({ groupId: brandString<AgentGroupId>('missing'), name: 'x', role: '' }))).code).toBe('group-not-found')
})

it('updates group and member fields', async () => {
  const h = await fixture()
  const { group, id } = await team(h)
  const updated = await h.service.update({ groupId: group.id, title: 'Renamed', description: ' new ', cwd: '' })
  expect(updated).toMatchObject({ title: 'Renamed', description: 'new' })
  expect(updated.cwd).toBeUndefined()
  const renamed = await h.service.updateMember({ groupId: group.id, memberId: id('qa'), name: 'tester', role: 'tests', agentPreset: '' })
  expect(renamed.members.at(-1)).toEqual({ id: id('qa'), name: 'tester', role: 'tests', origin: 'created', sessionId: group.members.at(-1)!.sessionId })
  expect((await refusal(h.service.updateMember({ groupId: group.id, memberId: id('fe'), name: 'be' }))).code).toBe('name-in-use')
  expect((await refusal(h.service.updateMember({ groupId: group.id, memberId: brandString<AgentGroupMemberId>('ghost') }))).code).toBe('member-not-found')
})

it('delivers an assignment to a direct subordinate, creating its Session with the group directory and member preset', async () => {
  const h = await fixture()
  const { group, id, session } = await team(h)
  h.agent(session('fe'))
  const assignment = await h.service.assign(session('fe'), 'QA', 'Test the login page\nCover wrong passwords.')
  expect(assignment).toMatchObject({ groupId: group.id, from: id('fe'), to: id('qa'), summary: 'Test the login page', status: 'open' })
  expect(h.create).toHaveBeenCalledWith({ sessionId: session('qa'), cwd: '/work/app', agentPreset: 'standard' })
  const qa = h.live.get(session('qa'))!
  expect(qa.steer).not.toHaveBeenCalled()
  const [message] = qa.followup.mock.calls[0]!
  expect(text(message)).toBe([
    `Your superior "fe" in group "Product" assigned you a task (assignment ${assignment.id}).`,
    'You are member "qa" of that group; your role: qa role',
    `When it is done or cannot be done, call group_report with assignment_id "${assignment.id}".`,
    '',
    'Test the login page\nCover wrong passwords.',
  ].join('\n'))
  expect(message.source).toEqual({
    kind: 'agent-group', form: 'relay', groupId: group.id, assignmentId: assignment.id, direction: 'assign',
    senderMemberId: id('fe'), senderSessionId: session('fe'),
  })
  expect(h.flush).toHaveBeenCalledTimes(1)
  expect((await h.service.snapshot()).assignments).toEqual([assignment])
})

it('steers a subordinate that is running a turn', async () => {
  const h = await fixture()
  const { session } = await team(h)
  const be = h.agent(session('be'), 'running')
  await h.service.assign(session('lead'), 'be', 'Build the API')
  expect(be.steer).toHaveBeenCalledTimes(1)
  expect(be.followup).not.toHaveBeenCalled()
})

it('refuses assigning to anyone but a direct subordinate and lists the direct subordinates', async () => {
  const h = await fixture()
  const { session } = await team(h)
  expect((await refusal(h.service.assign(session('lead'), 'qa', 'x'))).message)
    .toBe('"qa" is not your direct subordinate. Your direct subordinates are: "fe", "be".')
  expect((await refusal(h.service.assign(session('qa'), 'lead', 'x'))).message)
    .toBe('"lead" is not your direct subordinate. You have no direct subordinates in group "Product".')
  expect((await refusal(h.service.assign(session('lead'), 'fe', '  '))).code).toBe('invalid-input')
  expect((await refusal(h.service.assign(sid('stranger'), 'fe', 'x'))).code).toBe('not-a-member')
  expect(h.create).not.toHaveBeenCalled()
})

it('reports to the assigning superior and requires the assignment id when several are open', async () => {
  const h = await fixture()
  const { group, id, session } = await team(h)
  const fromFe = await h.service.assign(session('fe'), 'qa', 'Test the UI')
  expect((await h.service.report(session('qa'), 'UI passes')).status).toBe('reported')
  const fe = h.live.get(session('fe'))!
  const [message] = fe.followup.mock.calls[0]!
  expect(text(message)).toBe(`Your subordinate "qa" in group "Product" reported on assignment ${fromFe.id} (Test the UI).\n\nUI passes`)
  expect(message.source).toMatchObject({ direction: 'report', senderMemberId: id('qa'), assignmentId: fromFe.id, groupId: group.id })

  expect((await refusal(h.service.report(session('qa'), 'again'))).message).toBe('No assignment is waiting for your report.')
  const a = await h.service.assign(session('fe'), 'qa', 'Second UI pass')
  const b = await h.service.assign(session('be'), 'qa', 'Test the API')
  expect((await refusal(h.service.report(session('qa'), 'done'))).message)
    .toBe(`You have several open assignments; pass assignment_id. They are: ${a.id} (Second UI pass); ${b.id} (Test the API).`)
  expect((await refusal(h.service.report(session('qa'), 'done', brandString<AgentGroupAssignmentId>('a-none')))).code).toBe('assignment-not-found')
  expect((await refusal(h.service.report(session('qa'), ' ', b.id))).code).toBe('invalid-input')
  await h.service.report(session('qa'), 'API passes', b.id)
  expect(h.live.get(session('be'))!.followup).toHaveBeenCalledTimes(1)
  expect(fe.followup).toHaveBeenCalledTimes(1)
  const view = await h.service.memberView(session('qa'))
  expect(view).toEqual({
    group: 'Product', description: 'Ships the app', name: 'qa', role: 'qa role',
    superiors: [{ name: 'fe', role: 'fe role', running: false }, { name: 'be', role: 'be role', running: false }],
    subordinates: [],
    received: [{ id: a.id, member: 'fe', summary: 'Second UI pass' }],
    given: [],
  })
  expect((await h.service.memberView(session('fe'))).given).toEqual([{ id: a.id, member: 'qa', summary: 'Second UI pass' }])
})

it('limits open assignments per member and retains a bounded reported history', async () => {
  const h = await fixture({ config: { maxOpenAssignmentsPerMember: 1, assignmentHistoryRecords: 1 } })
  const { session } = await team(h)
  await h.service.assign(session('lead'), 'fe', 'one')
  expect((await refusal(h.service.assign(session('lead'), 'fe', 'two'))).code).toBe('limit')
  await h.service.report(session('fe'), 'done one')
  const second = await h.service.assign(session('lead'), 'fe', 'two')
  await h.service.report(session('fe'), 'done two')
  expect((await h.service.snapshot()).assignments.map(assignment => assignment.id)).toEqual([second.id])
})

it('keeps no assignment when delivery fails', async () => {
  const h = await fixture()
  const { session } = await team(h)
  h.archived.push(session('fe'))
  const archived = await refusal(h.service.assign(session('lead'), 'fe', 'x'))
  expect(archived.code).toBe('delivery-failed')
  expect(archived.message).toContain('is archived')
  h.flush.mockRejectedValueOnce(new Error('disk full'))
  expect((await refusal(h.service.assign(session('lead'), 'be', 'x'))).message).toBe('The message did not reach "be": disk full')
  expect((await h.service.snapshot()).assignments).toEqual([])
  const noController = await fixture({ sessionController: false })
  const other = await team(noController)
  expect((await refusal(noController.service.assign(other.session('lead'), 'fe', 'x'))).message).toBe('This Host cannot activate conversations.')
})

it('attaches an existing Session, tells it without waking it, and refuses unavailable Sessions', async () => {
  const h = await fixture()
  const { group, id, session } = await team(h)
  const existing = h.agent('existing')
  h.stored.set(sid('cold'), 0)
  h.stored.set(sid('child'), 1)
  h.archived.push(sid('old'))
  const attach = (sessionId: string, name = sessionId) =>
    h.service.attachSession({ groupId: group.id, sessionId: sid(sessionId), name, role: 'writes docs' })
  expect((await refusal(attach('missing'))).message).toBe('This conversation does not exist.')
  expect((await refusal(attach('child'))).message).toBe('A subagent conversation cannot join a group.')
  expect((await refusal(attach('old'))).message).toBe('This conversation is archived. Restore it before adding it to a group.')

  const joined = await attach('existing', 'docs')
  expect(joined.members.at(-1)).toMatchObject({ name: 'docs', role: 'writes docs', origin: 'attached', sessionId: 'existing' })
  expect((await refusal(attach('existing', 'dup'))).message)
    .toBe('This conversation already is member "docs" of group "Product". Remove it there first.')
  await expect.poll(() => existing.inject.mock.calls.length).toBe(1)
  const [notice] = existing.inject.mock.calls[0]!
  expect(text(notice)).toBe('The user added this conversation to group "Product" as member "docs". Call group_members to see your superiors and subordinates.')
  expect(notice.source).toEqual({ kind: 'agent-group', form: 'notice', summary: 'Joined group Product as docs', groupId: group.id })
  expect(existing.followup).not.toHaveBeenCalled()

  const docs = joined.members.at(-1)!.id
  await h.service.setEdges({ groupId: group.id, expectedRevision: joined.revision, edges: [...joined.edges, { superior: id('lead'), subordinate: docs }] })
  await h.service.assign(session('lead'), 'docs', 'Write the guide')
  expect(existing.followup).toHaveBeenCalledTimes(1)
  expect(h.create).not.toHaveBeenCalled()

  expect((await attach('cold')).members.at(-1)).toMatchObject({ origin: 'attached', sessionId: 'cold' })
})

it('removes a member with its lines and assignments, leaves its Session, and tells it', async () => {
  const h = await fixture()
  const { group, id, session } = await team(h)
  const assignment = await h.service.assign(session('fe'), 'qa', 'Test')
  await h.service.assign(session('lead'), 'be', 'Build')
  const qa = h.live.get(session('qa'))!
  const after = await h.service.removeMember({ groupId: group.id, memberId: id('qa') })
  expect(after.members.map(member => member.name)).toEqual(['lead', 'fe', 'be'])
  expect(after.edges).toEqual(group.edges.slice(0, 2))
  expect((await h.service.snapshot()).assignments.map(stored => stored.id)).not.toContain(assignment.id)
  expect((await h.service.snapshot()).assignments).toHaveLength(1)
  expect(h.service.isMember(session('qa'))).toBe(false)
  await expect.poll(() => qa.inject.mock.calls.length).toBe(1)
  expect(text(qa.inject.mock.calls[0]![0])).toBe('The user removed this conversation from group "Product". The group tools no longer apply here.')
  expect(h.live.has(session('qa'))).toBe(true)
})

it('resets a member to a new Session and drops the assignments its old Session held', async () => {
  const h = await fixture()
  const { group, id, session } = await team(h)
  await h.service.assign(session('fe'), 'qa', 'Test')
  const reset = await h.service.resetMemberSession({ groupId: group.id, memberId: id('qa') })
  const qa = reset.members.find(member => member.id === id('qa'))!
  expect(qa.sessionId).not.toBe(session('qa'))
  expect(qa.origin).toBe('created')
  expect((await h.service.snapshot()).assignments).toEqual([])
  expect(h.service.isMember(session('qa'))).toBe(false)
})

it('deletes a group with its assignments', async () => {
  const h = await fixture()
  const { group, session } = await team(h)
  await h.service.assign(session('lead'), 'fe', 'Build')
  await h.service.remove({ groupId: group.id })
  expect(await h.service.snapshot()).toEqual({ groups: [], assignments: [] })
  expect((await refusal(h.service.remove({ groupId: group.id }))).code).toBe('group-not-found')
})

it('carries refusals to Remote callers with their code and cycle', async () => {
  const h = await fixture()
  const { group, id } = await team(h)
  await expect(h.service.remoteSetEdges({
    groupId: group.id, expectedRevision: group.revision, edges: [{ superior: id('fe'), subordinate: id('be') }, { superior: id('be'), subordinate: id('fe') }],
  })).rejects.toMatchObject({ code: 'agent-group/refused', details: { code: 'cycle', cycle: ['fe', 'be', 'fe'] } })
  await expect(h.service.remoteCreate({ title: '' })).rejects.toMatchObject({ details: { code: 'invalid-input' } })
  expect((await h.service.remoteCreate({ title: 'Other' })).title).toBe('Other')
})

it('streams a snapshot at start and after every change until cancelled', async () => {
  const h = await fixture()
  const controller = new AbortController()
  const frames = h.service.watch(controller.signal)[Symbol.asyncIterator]()
  expect((await frames.next()).value).toEqual({ groups: [], assignments: [] })
  const pending = frames.next()
  const group = await h.service.create({ title: 'G' })
  expect((await pending).value).toEqual({ groups: [group], assignments: [] })
  const last = frames.next()
  controller.abort()
  expect((await last).done).toBe(true)
})

it('opens a member conversation for the user, creating it on first use', async () => {
  const h = await fixture()
  const { group, id, session } = await team(h)
  expect(await h.service.openMember({ groupId: group.id, memberId: id('be') })).toEqual({ sessionId: session('be') })
  expect(h.create).toHaveBeenCalledWith({ sessionId: session('be'), cwd: '/work/app' })
  expect(h.live.get(session('be'))!.followup).not.toHaveBeenCalled()
  h.archived.push(session('fe'))
  await expect(h.service.remoteOpenMember({ groupId: group.id, memberId: id('fe') })).rejects.toMatchObject({ details: { code: 'delivery-failed' } })
})
