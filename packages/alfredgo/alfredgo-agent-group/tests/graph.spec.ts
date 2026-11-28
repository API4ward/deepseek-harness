/** Reporting lines: cycle detection. */
import { brandString } from '@deepseek-ai/dsh-brand'
import { expect, it } from 'vitest'
import { findCycle } from '../src/graph.ts'
import type { AgentGroupEdge, AgentGroupMemberId } from '../src/types.ts'

const id = (name: string): AgentGroupMemberId => brandString<AgentGroupMemberId>(name)
const edges = (...pairs: string[]): AgentGroupEdge[] => pairs.map((pair) => {
  const [superior, subordinate] = pair.split('>')
  return { superior: id(superior!), subordinate: id(subordinate!) }
})

it('accepts a member with several superiors and reports no cycle', () => {
  expect(findCycle(edges('lead>fe', 'lead>be', 'fe>qa', 'be>qa'))).toBeUndefined()
  expect(findCycle([])).toBeUndefined()
})

it('returns the members along a cycle, first member repeated last', () => {
  expect(findCycle(edges('a>b', 'b>c', 'c>a'))).toEqual(['a', 'b', 'c', 'a'])
  expect(findCycle(edges('x>y', 'a>b', 'b>a'))).toEqual(['a', 'b', 'a'])
  expect(findCycle(edges('a>a'))).toEqual(['a', 'a'])
})
