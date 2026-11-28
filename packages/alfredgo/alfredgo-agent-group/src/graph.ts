/** Pure checks of a group's reporting lines. */
import type { AgentGroupEdge, AgentGroupMemberId } from './types.ts'

/**
 * Find one cycle among reporting lines.
 * @param edges - directed superior-to-subordinate lines.
 * @returns the member ids along one cycle, first id repeated last, or `undefined` when the lines are acyclic.
 */
export function findCycle(edges: readonly AgentGroupEdge[]): AgentGroupMemberId[] | undefined {
  const below = new Map<AgentGroupMemberId, AgentGroupMemberId[]>()
  for (const edge of edges) below.set(edge.superior, [...below.get(edge.superior) ?? [], edge.subordinate])
  const done = new Set<AgentGroupMemberId>()
  const path: AgentGroupMemberId[] = []
  const visit = (id: AgentGroupMemberId): AgentGroupMemberId[] | undefined => {
    const at = path.indexOf(id)
    if (at !== -1) return [...path.slice(at), id]
    if (done.has(id)) return undefined
    path.push(id)
    for (const next of below.get(id) ?? []) {
      const cycle = visit(next)
      if (cycle !== undefined) return cycle
    }
    path.pop()
    done.add(id)
    return undefined
  }
  for (const id of below.keys()) {
    const cycle = visit(id)
    if (cycle !== undefined) return cycle
  }
  return undefined
}
