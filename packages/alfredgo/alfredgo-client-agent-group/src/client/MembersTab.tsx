/** One group's settings and members: edit the group, create a member, attach an existing Session, and manage each member. */
import { useMemo, useState, type ReactNode } from 'react'
import { Button, Input, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentGroup, AgentGroupMember } from '@deepseek-ai/dsh-alfredgo-agent-group/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { GroupPageProps } from './GroupPage.tsx'
import type { PresetOption } from './group-actions.ts'
import css from './GroupPage.module.css'

type TabProps = GroupPageProps & { readonly group: AgentGroup }

function PresetSelect({ value, onChange, presets, t }: {
  value: string
  onChange: (value: string) => void
  presets: readonly PresetOption[]
  t: GroupPageProps['t']
}): ReactNode {
  return (
    <label className={css.field}>
      <span>{t('member.preset')}</span>
      <select className={css.select} value={value} onChange={(event) => { onChange(event.target.value) }}>
        <option value="">{t('member.presetDefault')}</option>
        {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
        {value !== '' && !presets.some(preset => preset.id === value) && <option value={value}>{value}</option>}
      </select>
    </label>
  )
}

function GroupForm({ group, t, updateGroup, useWorkspaces }: TabProps): ReactNode {
  const [title, setTitle] = useState(group.title)
  const [description, setDescription] = useState(group.description)
  const [cwd, setCwd] = useState(group.cwd ?? '')
  const workspaces = useWorkspaces(snapshot => snapshot.items)
  const changed = title !== group.title || description !== group.description || cwd !== (group.cwd ?? '')
  return (
    <form
      className={css.section}
      onSubmit={(event) => {
        event.preventDefault()
        void updateGroup({ groupId: group.id, title, description, cwd })
      }}
    >
      <div className={css.row}>
        <label className={css.field}>
          <span>{t('group.title')}</span>
          <Input value={title} maxLength={60} onChange={(event) => { setTitle(event.target.value) }} />
        </label>
        <label className={css.field}>
          <span>{t('group.cwd')}</span>
          <select className={css.select} value={cwd} onChange={(event) => { setCwd(event.target.value) }}>
            <option value="">{t('group.cwdDefault')}</option>
            {workspaces.map(workspace => <option key={workspace.path} value={workspace.path}>{workspace.title}</option>)}
            {cwd !== '' && !workspaces.some(workspace => workspace.path === cwd) && <option value={cwd}>{cwd}</option>}
          </select>
        </label>
      </div>
      <label className={css.field}>
        <span>{t('group.description')}</span>
        <Input value={description} placeholder={t('group.descriptionPlaceholder')} onChange={(event) => { setDescription(event.target.value) }} />
      </label>
      <p className={css.muted}>{t('group.cwdHelp')}</p>
      <div className={css.row}>
        <Button type="submit" variant="primary" size="sm" disabled={!changed || title.trim() === ''}>{t('group.save')}</Button>
      </div>
    </form>
  )
}

function MemberRow({ group, member, presets, onAsk, ...props }: TabProps & {
  readonly member: AgentGroupMember
  readonly presets: readonly PresetOption[]
  readonly onAsk: (ask: Ask) => void
}): ReactNode {
  const { t, updateMember, openMember } = props
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(member.name)
  const [role, setRole] = useState(member.role)
  const [preset, setPreset] = useState(member.agentPreset ?? '')
  const ref = { groupId: group.id, memberId: member.id }
  if (editing) {
    return (
      <li className={css.member}>
        <form
          className={css.editRow}
          onSubmit={(event) => {
            event.preventDefault()
            void updateMember({ ...ref, name, role, ...member.origin === 'created' ? { agentPreset: preset } : {} })
              .then((ok) => { if (ok) setEditing(false) })
          }}
        >
          <label className={css.field}>
            <span>{t('member.name')}</span>
            <Input value={name} maxLength={60} onChange={(event) => { setName(event.target.value) }} />
          </label>
          <label className={css.field}>
            <span>{t('member.role')}</span>
            <Input value={role} placeholder={t('member.rolePlaceholder')} onChange={(event) => { setRole(event.target.value) }} />
          </label>
          {member.origin === 'created' && <PresetSelect value={preset} onChange={setPreset} presets={presets} t={t} />}
          <div className={css.actions}>
            <Button type="submit" variant="primary" size="sm" disabled={name.trim() === ''}>{t('member.save')}</Button>
            <Button variant="ghost" size="sm" onClick={() => { setEditing(false) }}>{t('cancel')}</Button>
          </div>
        </form>
      </li>
    )
  }
  return (
    <li className={css.member}>
      <div className={css.memberText}>
        <span className={css.memberName}>
          {member.name}
          <Tag tone={member.origin === 'attached' ? 'info' : 'neutral'}>{t(`member.origin.${member.origin}`)}</Tag>
          {member.agentPreset !== undefined && (
            <Tag>{presets.find(option => option.id === member.agentPreset)?.name ?? member.agentPreset}</Tag>
          )}
        </span>
        {member.role !== '' && <span className={css.muted}>{member.role}</span>}
      </div>
      <div className={css.actions}>
        <Button variant="outline" size="sm" onClick={() => { void openMember(ref) }}>{t('member.open')}</Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setName(member.name); setRole(member.role); setPreset(member.agentPreset ?? ''); setEditing(true) }}
        >
          {t('member.edit')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => { onAsk({ kind: 'reset', member }) }}>{t('member.reset')}</Button>
        <Button variant="ghost" size="sm" onClick={() => { onAsk({ kind: 'remove', member }) }}>{t('member.remove')}</Button>
      </div>
    </li>
  )
}

/** A member action waiting for the user's confirmation. */
interface Ask {
  readonly kind: 'reset' | 'remove'
  readonly member: AgentGroupMember
}

/** The name and role inputs shared by the two forms that add a member. */
function NameRoleFields({ t, name, role, onName, onRole }: Pick<TabProps, 't'> & {
  readonly name: string
  readonly role: string
  readonly onName: (value: string) => void
  readonly onRole: (value: string) => void
}): ReactNode {
  return (
    <>
      <label className={css.field}>
        <span>{t('member.name')}</span>
        <Input value={name} maxLength={60} onChange={(event) => { onName(event.target.value) }} />
      </label>
      <label className={css.field}>
        <span>{t('member.role')}</span>
        <Input value={role} placeholder={t('member.rolePlaceholder')} onChange={(event) => { onRole(event.target.value) }} />
      </label>
    </>
  )
}

function AddMember({ group, t, addMember, presets }: TabProps & { readonly presets: readonly PresetOption[] }): ReactNode {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [preset, setPreset] = useState('')
  return (
    <form
      className={css.section}
      aria-label={t('member.add')}
      onSubmit={(event) => {
        event.preventDefault()
        void addMember({ groupId: group.id, name, role, ...preset === '' ? {} : { agentPreset: preset } })
          .then((ok) => { if (ok) { setName(''); setRole('') } })
      }}
    >
      <h3>{t('member.add')}</h3>
      <p className={css.muted}>{t('member.addHelp')}</p>
      <div className={css.row}>
        <NameRoleFields t={t} name={name} role={role} onName={setName} onRole={setRole} />
        <PresetSelect value={preset} onChange={setPreset} presets={presets} t={t} />
      </div>
      <div className={css.row}>
        <Button type="submit" variant="primary" size="sm" disabled={name.trim() === ''}>{t('member.add')}</Button>
      </div>
    </form>
  )
}

function AttachSession({ group, t, attachSession, useSessions, useWorkspaces, useGroups }: TabProps): ReactNode {
  const [sessionId, setSessionId] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const sessions = useSessions(snapshot => snapshot)
  const archived = useWorkspaces(snapshot => snapshot.archivedSessionIds)
  const groups = useGroups(state => state.groups)
  const choices = useMemo(() => {
    const taken = new Set<SessionId>(groups.flatMap(each => each.members.map(member => member.sessionId)))
    return sessions.ids
      .filter(id => !taken.has(id) && !archived.includes(id) && sessions.byId[id]?.origin !== 'subagent')
      .map(id => ({ id, label: sessions.byId[id]?.displayTitle ?? id }))
  }, [sessions, archived, groups])
  const chosen = choices.find(choice => choice.id === sessionId)
  return (
    <form
      className={css.section}
      aria-label={t('member.attach')}
      onSubmit={(event) => {
        event.preventDefault()
        if (chosen === undefined) return
        void attachSession({ groupId: group.id, sessionId: chosen.id, name, role })
          .then((ok) => { if (ok) { setSessionId(''); setName(''); setRole('') } })
      }}
    >
      <h3>{t('member.attach')}</h3>
      <p className={css.muted}>{t('member.attachHelp')}</p>
      <div className={css.row}>
        <label className={css.field}>
          <span>{t('member.session')}</span>
          <select
            className={css.select}
            value={chosen === undefined ? '' : sessionId}
            onChange={(event) => {
              setSessionId(event.target.value)
              // The Session title is the suggested member name until the user types one.
              const label = choices.find(choice => choice.id === event.target.value)?.label
              if (label !== undefined && name.trim() === '') setName(label.slice(0, 60))
            }}
          >
            <option value="">{choices.length === 0 ? t('member.noSessions') : t('member.sessionPlaceholder')}</option>
            {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
          </select>
        </label>
        <NameRoleFields t={t} name={name} role={role} onName={setName} onRole={setRole} />
      </div>
      <div className={css.row}>
        <Button type="submit" variant="primary" size="sm" disabled={chosen === undefined || name.trim() === ''}>{t('member.attach')}</Button>
      </div>
    </form>
  )
}

/**
 * Render the group's settings, its members, and the two ways to add a member.
 * @param props - page props and the group being edited.
 * @returns the members tab body.
 */
export function MembersTab(props: TabProps): ReactNode {
  const { group, t, usePresets, removeMember, resetMember } = props
  const presets = usePresets(list => list)
  const [ask, setAsk] = useState<Ask | null>(null)
  const confirm = (): void => {
    if (ask === null) return
    const ref = { groupId: group.id, memberId: ask.member.id }
    void (ask.kind === 'reset' ? resetMember(ref) : removeMember(ref))
    setAsk(null)
  }
  return (
    <div role="tabpanel" id="agent-group-panel-members" aria-labelledby="agent-group-tab-members" className={css.tabBody}>
      <GroupForm {...props} />
      <section className={css.section}>
        <h3>{t('tab.members')}</h3>
        {group.members.length === 0 ? <p className={css.muted}>{t('member.none')}</p> : (
          <ul className={css.members}>
            {group.members.map(member => <MemberRow key={member.id} {...props} member={member} presets={presets} onAsk={setAsk} />)}
          </ul>
        )}
      </section>
      <AddMember {...props} presets={presets} />
      <AttachSession {...props} />
      <Modal
        open={ask !== null}
        onClose={() => { setAsk(null) }}
        closeLabel={t('cancel')}
        title={ask?.kind === 'reset' ? t('member.reset') : t('member.remove')}
        description={ask === null ? '' : t(ask.kind === 'reset' ? 'member.resetConfirm' : 'member.removeConfirm', { name: ask.member.name })}
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setAsk(null) }}>{t('cancel')}</Button>
            <Button variant="primary" onClick={confirm}>{t('confirm')}</Button>
          </>
        )}
      />
    </div>
  )
}
