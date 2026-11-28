/**
 * Pure edits of a group's draft reporting lines.
 *
 * The Host checks every saved set for cycles itself; the check here only keeps
 * a cycle out of the draft, because a browser bundle cannot import Host code.
 */
import type { AgentGroupEdge, AgentGroupMemberId } from '@deepseek-ai/dsh-alfredgo-agent-group/client'

/** Result of adding one line to a draft: the new lines, or the member ids of the cycle it would close. */
export type AddEdgeResult =
  | { readonly edges: readonly AgentGroupEdge[] }
  | { readonly cycle: readonly AgentGroupMemberId[] }

/**
 * Whether the lines contain one from `superior` to `subordinate`.
 * @param edges - reporting lines.
 * @param superior - upper member.
 * @param subordinate - lower member.
 * @returns true when that line exists.
 */
export function hasEdge(edges: readonly AgentGroupEdge[], superior: AgentGroupMemberId, subordinate: AgentGroupMemberId): boolean {
  return edges.some(edge => edge.superior === superior && edge.subordinate === subordinate)
}

/**
 * Find a chain of reporting lines that leads down from one member to another.
 * @param edges - acyclic reporting lines.
 * @param from - member the chain starts at.
 * @param to - member the chain must reach.
 * @returns the members along one chain, both ends included, or `undefined` when `to` is not below `from`.
 */
export function chainBetween(
  edges: readonly AgentGroupEdge[],
  from: AgentGroupMemberId,
  to: AgentGroupMemberId,
): AgentGroupMemberId[] | undefined {
  if (from === to) return [from]
  for (const edge of edges) {
    if (edge.superior !== from) continue
    const rest = chainBetween(edges, edge.subordinate, to)
    if (rest !== undefined) return [from, ...rest]
  }
  return undefined
}

/**
 * Add one reporting line unless it repeats a line, joins a member to itself, or closes a cycle.
 * @param edges - current lines, acyclic.
 * @param superior - member that will assign.
 * @param subordinate - member that will report.
 * @returns the lines with the new one, the unchanged lines for a repeat or a self-line, or the cycle the line would
 * close: the new superior, the chain from the new subordinate back to it.
 */
export function addEdge(edges: readonly AgentGroupEdge[], superior: AgentGroupMemberId, subordinate: AgentGroupMemberId): AddEdgeResult {
  if (superior === subordinate || hasEdge(edges, superior, subordinate)) return { edges }
  const back = chainBetween(edges, subordinate, superior)
  return back === undefined ? { edges: [...edges, { superior, subordinate }] } : { cycle: [superior, ...back] }
}

/**
 * Remove one reporting line.
 * @param edges - current lines.
 * @param superior - upper member of the line.
 * @param subordinate - lower member of the line.
 * @returns the lines without it.
 */
export function removeEdge(
  edges: readonly AgentGroupEdge[],
  superior: AgentGroupMemberId,
  subordinate: AgentGroupMemberId,
): readonly AgentGroupEdge[] {
  return edges.filter(edge => edge.superior !== superior || edge.subordinate !== subordinate)
}

/**
 * Compare two line sets without regard to order.
 * @param a - one set.
 * @param b - the other set.
 * @returns true when both hold the same lines.
 */
export function sameEdges(a: readonly AgentGroupEdge[], b: readonly AgentGroupEdge[]): boolean {
  return a.length === b.length && a.every(edge => hasEdge(b, edge.superior, edge.subordinate))
}

/**
 * Drop the lines that name a member outside the group.
 * @param edges - draft lines.
 * @param members - ids of the group's current members.
 * @returns the lines whose two ends are both current members.
 */
export function keepKnownEdges(edges: readonly AgentGroupEdge[], members: readonly AgentGroupMemberId[]): readonly AgentGroupEdge[] {
  return edges.filter(edge => members.includes(edge.superior) && members.includes(edge.subordinate))
}
