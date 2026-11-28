/** Layered graph of a group's reporting lines: drag from a member's handle to add a line, select a line to remove it. */
import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { AgentGroupEdge, AgentGroupMember, AgentGroupMemberId } from '@deepseek-ai/dsh-alfredgo-agent-group/client'
import { edgePath, layoutGraph, NODE_HEIGHT, NODE_WIDTH } from './layout.ts'
import type { NS } from './locales.ts'
import css from './GroupPage.module.css'

/** Props of the reporting-line graph. */
export interface RelationGraphProps {
  readonly members: readonly AgentGroupMember[]
  /** Acyclic lines among `members`. */
  readonly edges: readonly AgentGroupEdge[]
  readonly selectedMember: AgentGroupMemberId | null
  readonly selectedEdge: AgentGroupEdge | null
  readonly onSelectMember: (id: AgentGroupMemberId | null) => void
  readonly onSelectEdge: (edge: AgentGroupEdge | null) => void
  /** A line was dragged from `superior` and dropped on `subordinate`. */
  readonly onConnect: (superior: AgentGroupMemberId, subordinate: AgentGroupMemberId) => void
  /** Delete or Backspace was pressed on a focused line. */
  readonly onRemoveEdge: (edge: AgentGroupEdge) => void
  readonly t: TranslateNS<typeof NS>
}

interface Drag {
  readonly from: AgentGroupMemberId
  readonly x: number
  readonly y: number
}

/**
 * Render the members in layers with their reporting lines.
 * @param props - members, lines, the selection, and the edit callbacks.
 * @returns the graph canvas.
 */
export function RelationGraph(props: RelationGraphProps): ReactNode {
  const { members, edges, selectedMember, selectedEdge, onSelectMember, onSelectEdge, onConnect, onRemoveEdge, t } = props
  const canvas = useRef<HTMLDivElement>(null)
  const arrow = useId()
  const [drag, setDrag] = useState<Drag | null>(null)
  const layout = useMemo(() => layoutGraph(members.map(member => member.id), edges), [members, edges])
  const names = useMemo(() => new Map(members.map(member => [member.id, member.name])), [members])

  const point = (event: PointerEvent): { x: number; y: number } => {
    const box = canvas.current?.getBoundingClientRect()
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) }
  }
  const finish = (event: PointerEvent): void => {
    if (drag === null) return
    setDrag(null)
    const target = event.target instanceof Element ? event.target.closest('[data-member]') : null
    const id = members.find(member => member.id === target?.getAttribute('data-member'))?.id
    if (id !== undefined && id !== drag.from) onConnect(drag.from, id)
  }
  const edgeKey = (event: KeyboardEvent, edge: AgentGroupEdge): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelectEdge(edge)
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      onRemoveEdge(edge)
    }
  }
  const dragStart = drag === null ? undefined : layout.positions.get(drag.from)

  return (
    <div className={css.canvasScroll}>
      <div
        ref={canvas}
        role="group"
        aria-label={t('relations.graphLabel')}
        className={css.canvas}
        style={{ width: layout.width, height: layout.height }}
        onPointerMove={(event) => { if (drag !== null) setDrag({ from: drag.from, ...point(event) }) }}
        onPointerUp={finish}
        onPointerLeave={() => { setDrag(null) }}
        onClick={(event) => {
          if (event.target === event.currentTarget) { onSelectMember(null); onSelectEdge(null) }
        }}
      >
        <svg className={css.edges} width={layout.width} height={layout.height}>
          <defs>
            <marker id={arrow} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className={css.arrow} />
            </marker>
          </defs>
          {edges.map((edge) => {
            const from = layout.positions.get(edge.superior)
            const to = layout.positions.get(edge.subordinate)
            if (from === undefined || to === undefined) return null
            const d = edgePath(from, to)
            const selected = selectedEdge?.superior === edge.superior && selectedEdge.subordinate === edge.subordinate
            return (
              <g key={`${edge.superior}>${edge.subordinate}`}>
                <path d={d} className={clsx(css.edge, selected && css.edgeSelected)} markerEnd={`url(#${arrow})`} />
                <path
                  d={d}
                  className={css.edgeHit}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  aria-label={t('relations.edge', { superior: names.get(edge.superior), subordinate: names.get(edge.subordinate) })}
                  onClick={() => { onSelectEdge(selected ? null : edge) }}
                  onKeyDown={(event) => { edgeKey(event, edge) }}
                />
              </g>
            )
          })}
          {drag !== null && dragStart !== undefined && (
            <path
              className={css.dragLine}
              d={`M ${dragStart.x + NODE_WIDTH / 2} ${dragStart.y + NODE_HEIGHT} L ${drag.x} ${drag.y}`}
            />
          )}
        </svg>
        {members.map((member) => {
          const at = layout.positions.get(member.id)
          if (at === undefined) return null
          return (
            <div
              key={member.id}
              data-member={member.id}
              className={css.node}
              style={{ left: at.x, top: at.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
            >
              <button
                type="button"
                className={css.nodeBody}
                aria-pressed={selectedMember === member.id}
                onClick={() => { onSelectMember(selectedMember === member.id ? null : member.id) }}
              >
                <span className={css.nodeName}>{member.name}</span>
                {member.role !== '' && <span className={css.nodeRole}>{member.role}</span>}
              </button>
              {layout.entries.has(member.id) && <span className={css.entry}>{t('relations.entry')}</span>}
              <span
                className={css.handle}
                title={t('relations.handle', { name: member.name })}
                data-handle={member.id}
                onPointerDown={(event) => {
                  event.preventDefault()
                  setDrag({ from: member.id, ...point(event) })
                }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
