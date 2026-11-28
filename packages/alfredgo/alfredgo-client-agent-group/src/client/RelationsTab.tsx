/** Editor of one group's reporting lines: the graph, a checkbox editor for the selected member, and save or revert. */
import { useState, type ReactNode } from 'react'
import { Button, Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentGroup, AgentGroupEdge, AgentGroupMemberId } from '@deepseek-ai/dsh-alfredgo-agent-group/client'
import { addEdge, hasEdge, keepKnownEdges, removeEdge, sameEdges } from './edges.ts'
import type { GroupPageProps } from './GroupPage.tsx'
import { RelationGraph } from './RelationGraph.tsx'
import css from './GroupPage.module.css'

/**
 * Edit a draft of the group's lines; nothing reaches the Host until the user saves.
 *
 * The draft rejects a line that would close a cycle before it is drawn, and
 * the Host checks the saved set again against the revision this editor read.
 * @param props - page props and the group being edited.
 * @returns the relations tab body.
 */
export function RelationsTab(props: GroupPageProps & { readonly group: AgentGroup }): ReactNode {
  const { group, t, setEdges, reportFailure, clearFailure } = props
  const [draft, setDraft] = useState<readonly AgentGroupEdge[] | null>(null)
  const [selectedMember, setSelectedMember] = useState<AgentGroupMemberId | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<AgentGroupEdge | null>(null)
  const [saving, setSaving] = useState(false)
  const ids = group.members.map(member => member.id)
  const edges = keepKnownEdges(draft ?? group.edges, ids)
  const changed = !sameEdges(edges, group.edges)
  const nameOf = (id: AgentGroupMemberId): string => group.members.find(member => member.id === id)?.name ?? id
  const member = group.members.find(candidate => candidate.id === selectedMember)

  const connect = (superior: AgentGroupMemberId, subordinate: AgentGroupMemberId): void => {
    const result = addEdge(edges, superior, subordinate)
    if ('cycle' in result) {
      reportFailure({ key: 'relations.cycle', params: { cycle: result.cycle.map(nameOf).join(' → ') } })
      return
    }
    clearFailure()
    setDraft(result.edges)
  }
  const disconnect = (edge: AgentGroupEdge): void => {
    clearFailure()
    setDraft(removeEdge(edges, edge.superior, edge.subordinate))
    setSelectedEdge(null)
  }
  const save = async (): Promise<void> => {
    setSaving(true)
    // A refused save keeps the draft: after a conflict the next save carries the revision the stream delivered.
    if (await setEdges({ groupId: group.id, edges, expectedRevision: group.revision })) setDraft(null)
    setSaving(false)
  }

  if (group.members.length < 2) return <p className={css.muted}>{t('relations.empty')}</p>
  return (
    <div className={css.section} role="tabpanel" id="agent-group-panel-relations" aria-labelledby="agent-group-tab-relations">
      <p className={css.muted}>{t('relations.help')}</p>
      <div className={css.row}>
        <Button variant="primary" size="sm" disabled={!changed || saving} onClick={() => { void save() }}>{t('relations.save')}</Button>
        <Button variant="outline" size="sm" disabled={!changed || saving} onClick={() => { setDraft(null); setSelectedEdge(null); clearFailure() }}>
          {t('relations.revert')}
        </Button>
        {selectedEdge !== null && (
          <Button variant="outline" size="sm" onClick={() => { disconnect(selectedEdge) }}>{t('relations.removeEdge')}</Button>
        )}
        {changed && <span className={css.muted} role="status">{t('relations.unsaved')}</span>}
      </div>
      <div className={css.relations}>
        <RelationGraph
          members={group.members}
          edges={edges}
          selectedMember={selectedMember}
          selectedEdge={selectedEdge}
          onSelectMember={(id) => { setSelectedMember(id); setSelectedEdge(null) }}
          onSelectEdge={(edge) => { setSelectedEdge(edge); if (edge !== null) setSelectedMember(null) }}
          onConnect={connect}
          onRemoveEdge={disconnect}
          t={t}
        />
        <div className={css.editor}>
          {member === undefined ? <p className={css.muted}>{t('member.noneSelected')}</p> : (
            <>
              <strong>{member.name}</strong>
              {(['superiors', 'subordinates'] as const).map(side => (
                <div key={side} className={css.checks} role="group" aria-label={t(`member.${side}`)}>
                  <h4>{t(`member.${side}`)}</h4>
                  {group.members.filter(other => other.id !== member.id).map((other) => {
                    const superior = side === 'superiors' ? other.id : member.id
                    const subordinate = side === 'superiors' ? member.id : other.id
                    return (
                      <Checkbox
                        key={other.id}
                        label={other.name}
                        checked={hasEdge(edges, superior, subordinate)}
                        onChange={(next) => {
                          if (next) connect(superior, subordinate)
                          else disconnect({ superior, subordinate })
                        }}
                      />
                    )
                  })}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
