/** Layered placement of a group's members for the reporting-line graph. */
import type { AgentGroupEdge, AgentGroupMemberId } from '@deepseek-ai/dsh-alfredgo-agent-group/client'

/** Width of one member box. */
export const NODE_WIDTH = 160
/** Height of one member box. */
export const NODE_HEIGHT = 56
const GAP_X = 32
const GAP_Y = 72
const PADDING = 24

/** Top-left corner of one member box. */
export interface NodePosition {
  readonly x: number
  readonly y: number
}

/** Placement of every member and the canvas that holds them. */
export interface GraphLayout {
  readonly width: number
  readonly height: number
  readonly positions: ReadonlyMap<AgentGroupMemberId, NodePosition>
  /** Members without a superior, which the user addresses first. */
  readonly entries: ReadonlySet<AgentGroupMemberId>
}

/**
 * Group members by the length of their longest chain of superiors.
 * @param members - member ids in display order.
 * @param edges - acyclic reporting lines among those members.
 * @returns layers from the top, each in display order.
 */
function layerMembers(members: readonly AgentGroupMemberId[], edges: readonly AgentGroupEdge[]): AgentGroupMemberId[][] {
  const depth = new Map(members.map(id => [id, 0]))
  const waiting = new Map(members.map(id => [id, edges.filter(edge => edge.subordinate === id).length]))
  // Members become ready once every superior has a depth, so each line is followed exactly once.
  const ready = members.filter(id => waiting.get(id) === 0)
  for (const id of ready) {
    for (const edge of edges) {
      if (edge.superior !== id) continue
      depth.set(edge.subordinate, Math.max(depth.get(edge.subordinate) ?? 0, (depth.get(id) ?? 0) + 1))
      const left = (waiting.get(edge.subordinate) ?? 1) - 1
      waiting.set(edge.subordinate, left)
      if (left === 0) ready.push(edge.subordinate)
    }
  }
  const layers: AgentGroupMemberId[][] = []
  for (const id of members) (layers[depth.get(id) ?? 0] ??= []).push(id)
  return layers
}

/**
 * Place members in layers so every reporting line points downward.
 *
 * A member sits one layer below its deepest superior. Within a layer, members
 * are ordered by the mean position of their superiors, which keeps most lines
 * from crossing; a line that spans several layers may pass behind a box.
 * @param members - member ids in display order.
 * @param edges - acyclic reporting lines among those members.
 * @returns box positions and the canvas size.
 */
export function layoutGraph(members: readonly AgentGroupMemberId[], edges: readonly AgentGroupEdge[]): GraphLayout {
  const layers = layerMembers(members, edges)
  const widest = Math.max(1, ...layers.map(layer => layer.length))
  const width = PADDING * 2 + widest * NODE_WIDTH + (widest - 1) * GAP_X
  const positions = new Map<AgentGroupMemberId, NodePosition>()
  const centre = (id: AgentGroupMemberId): number => (positions.get(id)?.x ?? 0) + NODE_WIDTH / 2
  layers.forEach((layer, depth) => {
    const mean = (id: AgentGroupMemberId): number => {
      const above = edges.filter(edge => edge.subordinate === id).map(edge => centre(edge.superior))
      return above.length === 0 ? Number.POSITIVE_INFINITY : above.reduce((sum, x) => sum + x, 0) / above.length
    }
    const ordered = depth === 0 ? layer : layer.map((id, index) => ({ id, index, at: mean(id) }))
      .sort((a, b) => a.at === b.at ? a.index - b.index : a.at - b.at).map(item => item.id)
    const row = ordered.length * NODE_WIDTH + (ordered.length - 1) * GAP_X
    const left = (width - row) / 2
    ordered.forEach((id, column) => {
      positions.set(id, { x: left + column * (NODE_WIDTH + GAP_X), y: PADDING + depth * (NODE_HEIGHT + GAP_Y) })
    })
  })
  const height = PADDING * 2 + Math.max(1, layers.length) * NODE_HEIGHT + Math.max(0, layers.length - 1) * GAP_Y
  const entries = new Set(members.filter(id => !edges.some(edge => edge.subordinate === id)))
  return { width, height, positions, entries }
}

/**
 * Curve of one reporting line from the bottom of the superior to the top of the subordinate.
 * @param from - box of the superior.
 * @param to - box of the subordinate.
 * @returns SVG path data.
 */
export function edgePath(from: NodePosition, to: NodePosition): string {
  const x1 = from.x + NODE_WIDTH / 2
  const y1 = from.y + NODE_HEIGHT
  const x2 = to.x + NODE_WIDTH / 2
  const y2 = to.y
  const bend = (y2 - y1) / 2
  return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`
}
