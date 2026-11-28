/** Durable agent groups and assignments. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  AgentGroup, AgentGroupAssignment, AgentGroupAssignmentId, AgentGroupId, AgentGroupMemberId,
} from './types.ts'

const text = z.string().min(1)
const instant = z.iso.datetime({ precision: 3 })
const memberId = text.transform(brandString<AgentGroupMemberId>)
const groupId = text.transform(brandString<AgentGroupId>)

const memberSchema = z.object({
  id: memberId,
  name: text,
  role: z.string(),
  origin: z.enum(['created', 'attached']),
  agentPreset: text.exactOptional(),
  sessionId: text.transform(brandString<SessionId>),
}).strict()

/** Stored group; the service revalidates names, Session uniqueness, and acyclic lines before every write. */
export const groupSchema: z.ZodType<AgentGroup> = z.object({
  id: groupId,
  title: text,
  description: z.string(),
  cwd: text.exactOptional(),
  members: z.array(memberSchema),
  edges: z.array(z.object({ superior: memberId, subordinate: memberId }).strict()),
  revision: z.number().int().min(1),
  createdAt: instant,
  updatedAt: instant,
}).strict()

/** Stored assignment. */
export const assignmentSchema: z.ZodType<AgentGroupAssignment> = z.object({
  id: text.transform(brandString<AgentGroupAssignmentId>),
  groupId,
  from: memberId,
  to: memberId,
  summary: z.string(),
  status: z.enum(['open', 'reported']),
  createdAt: instant,
  reportedAt: instant.exactOptional(),
}).strict()

/** The `agent_group` storage domain: one row per group and one per retained assignment. */
export const agentGroupDomain = defineDomain({
  name: 'agent_group',
  version: 1,
  tables: {
    groups: domainTable<AgentGroupId, AgentGroup>(groupSchema),
    assignments: domainTable<AgentGroupAssignmentId, AgentGroupAssignment>(assignmentSchema),
  },
})
