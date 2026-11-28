import { describe, expect, it } from 'vitest'
import type { AgentGroupEdge, AgentGroupMemberId } from '@deepseek-ai/dsh-alfredgo-agent-group/client'
import { addEdge, chainBetween, hasEdge, keepKnownEdges, removeEdge, sameEdges } from '../src/client/edges.ts'
import { edgePath, layoutGraph, NODE_HEIGHT, NODE_WIDTH } from '../src/client/layout.ts'

const id = (name: string): AgentGroupMemberId => name as AgentGroupMemberId
const line = (superior: string, subordinate: string): AgentGroupEdge => ({ superior: id(superior), subordinate: id(subordinate) })

describe('draft reporting lines', () => {
  it('adds a line, so one member can have two superiors', () => {
    const edges = [line('lead', 'dev')]
    expect(addEdge(edges, id('design'), id('dev'))).toEqual({ edges: [line('lead', 'dev'), line('design', 'dev')] })
  })

  it('leaves the lines unchanged for a repeated line or a line from a member to itself', () => {
    const edges = [line('lead', 'dev')]
    expect(addEdge(edges, id('lead'), id('dev'))).toEqual({ edges })
    expect(addEdge(edges, id('dev'), id('dev'))).toEqual({ edges })
  })

  it('reports the cycle a line would close instead of adding it', () => {
    const edges = [line('lead', 'dev'), line('dev', 'qa')]
    expect(addEdge(edges, id('qa'), id('lead'))).toEqual({ cycle: [id('qa'), id('lead'), id('dev'), id('qa')] })
    expect(chainBetween([line('lead', 'ops'), ...edges], id('lead'), id('qa'))).toEqual([id('lead'), id('dev'), id('qa')])
    expect(chainBetween(edges, id('qa'), id('lead'))).toBeUndefined()
  })

  it('removes one line and compares line sets without regard to order', () => {
    const edges = [line('lead', 'dev'), line('lead', 'qa')]
    expect(removeEdge(edges, id('lead'), id('dev'))).toEqual([line('lead', 'qa')])
    expect(hasEdge(edges, id('lead'), id('qa'))).toBe(true)
    expect(hasEdge(edges, id('qa'), id('lead'))).toBe(false)
    expect(sameEdges(edges, [line('lead', 'qa'), line('lead', 'dev')])).toBe(true)
    expect(sameEdges(edges, [line('lead', 'qa')])).toBe(false)
    expect(sameEdges(edges, [line('lead', 'qa'), line('qa', 'dev')])).toBe(false)
  })

  it('drops lines whose member left the group', () => {
    expect(keepKnownEdges([line('lead', 'dev'), line('lead', 'gone'), line('gone', 'dev')], [id('lead'), id('dev')]))
      .toEqual([line('lead', 'dev')])
  })
})

describe('graph layout', () => {
  it('places a member with two superiors one layer below the deeper one', () => {
    const members = ['lead', 'design', 'dev', 'qa'].map(id)
    const layout = layoutGraph(members, [line('lead', 'design'), line('lead', 'dev'), line('design', 'dev'), line('dev', 'qa')])
    const y = (name: string): number => layout.positions.get(id(name))!.y
    expect(y('lead')).toBeLessThan(y('design'))
    expect(y('design')).toBeLessThan(y('dev'))
    expect(y('dev')).toBeLessThan(y('qa'))
    expect([...layout.entries]).toEqual([id('lead')])
    expect(layout.height).toBeGreaterThan(y('qa') + NODE_HEIGHT)
  })

  it('marks every member without a superior as an entry and keeps members of one layer apart', () => {
    const members = ['a', 'b', 'c'].map(id)
    const layout = layoutGraph(members, [line('a', 'c')])
    expect([...layout.entries]).toEqual([id('a'), id('b')])
    const a = layout.positions.get(id('a'))!
    const b = layout.positions.get(id('b'))!
    expect(a.y).toBe(b.y)
    expect(b.x - a.x).toBeGreaterThanOrEqual(NODE_WIDTH)
    expect(layout.width).toBeGreaterThanOrEqual(b.x + NODE_WIDTH)
  })

  it('orders a layer by where its superiors sit', () => {
    const members = ['left', 'right', 'under-right', 'under-left'].map(id)
    const layout = layoutGraph(members, [line('right', 'under-right'), line('left', 'under-left')])
    expect(layout.positions.get(id('under-left'))!.x).toBeLessThan(layout.positions.get(id('under-right'))!.x)
  })

  it('gives an empty group a canvas with room for one row', () => {
    const layout = layoutGraph([], [])
    expect(layout.positions.size).toBe(0)
    expect(layout.height).toBeGreaterThanOrEqual(NODE_HEIGHT)
  })

  it('draws a line from the bottom of the superior to the top of the subordinate', () => {
    expect(edgePath({ x: 0, y: 0 }, { x: 100, y: 200 }))
      .toBe(`M ${NODE_WIDTH / 2} ${NODE_HEIGHT} C ${NODE_WIDTH / 2} ${NODE_HEIGHT + 72}, ${100 + NODE_WIDTH / 2} ${200 - 72}, ${100 + NODE_WIDTH / 2} 200`)
  })
})
