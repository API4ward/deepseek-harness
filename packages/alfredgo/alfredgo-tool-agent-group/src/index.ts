/**
 * Model tools and guidance for members of an agent group. The tools and the
 * prompt section exist only in Sessions that are group members.
 * @module @deepseek-ai/dsh-alfredgo-tool-agent-group
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AgentGroupAssignmentId } from '@deepseek-ai/dsh-alfredgo-agent-group'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineTool, ToolContextUnavailableError } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { GROUP_POLICY } from './policy.ts'

/** Cordis plugin name. */
export const name = 'alfredgo-tool-agent-group'
/** Services required by the group tool plugin. */
export const inject = ['agentGroups', 'tools', 'systemPrompt']

/** The group tool plugin takes no configuration. */
export type Config = Record<never, never>

/** Loader schema of the group tool plugin. */
export const Config: z<Config> = z.object({})

const NEIGHBOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    role: { type: 'string', required: true },
    running: { type: 'boolean', required: true },
  },
} as const

const OPEN_ASSIGNMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    member: { type: 'string', required: true },
    summary: { type: 'string', required: true },
  },
} as const

const MEMBERS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    group: { type: 'string', required: true },
    description: { type: 'string', required: true },
    name: { type: 'string', required: true },
    role: { type: 'string', required: true },
    superiors: { type: 'array', required: true, items: NEIGHBOR_SCHEMA },
    subordinates: { type: 'array', required: true, items: NEIGHBOR_SCHEMA },
    received: { type: 'array', required: true, items: OPEN_ASSIGNMENT_SCHEMA },
    given: { type: 'array', required: true, items: OPEN_ASSIGNMENT_SCHEMA },
  },
} as const

const DELIVERY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    assignment_id: { type: 'string', required: true },
    delivered: { type: 'boolean', required: true },
  },
} as const

/**
 * Declare one output schema rendered as compact JSON.
 * @param schema - value schema of one tool.
 * @returns the `output` declaration accepted by {@link defineTool}.
 */
function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return { schema, render: (_args: unknown, value: InferValue<S>) => [{ type: 'text', text: JSON.stringify(value) }] }
}

/** Recover the caller that the membership condition guarantees. */
function callingAgent(agent: Agent | undefined, toolName: string): Agent {
  /* v8 ignore next 2 -- the membership condition rejects callers without an Agent before execution. */
  if (agent === undefined) throw new ToolContextUnavailableError(`${toolName} requires a calling Agent`)
  return agent
}

/**
 * Register the group tools and guidance for Sessions that are group members.
 * @param ctx - context carrying the group, tool, and system prompt services.
 */
export function apply(ctx: Context): void {
  const member = (agent: Agent | undefined): boolean => agent !== undefined && ctx.agentGroups.isMember(agent.id)

  ctx.systemPrompt.section({
    name: 'alfredgo:agent-group',
    order: ctx.systemPrompt.getSectionOrder('TEAM_POLICY') + 1,
    text: ({ agent }) => member(agent) ? GROUP_POLICY : '',
  })

  ctx.tools.register(defineTool({
    name: 'group_members',
    description: 'Read your position in your agent group: the group, your role, your direct superiors and subordinates, and open assignments you received or gave.',
    parameters: {},
    output: jsonOutput(MEMBERS_SCHEMA),
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const view = await ctx.agentGroups.memberView(callingAgent(exec.agent, 'group_members').id)
      return {
        ...view,
        superiors: view.superiors.map(neighbor => ({ ...neighbor })),
        subordinates: view.subordinates.map(neighbor => ({ ...neighbor })),
        received: view.received.map(assignment => ({ ...assignment })),
        given: view.given.map(assignment => ({ ...assignment })),
      }
    },
  }), { when: ({ agent }) => member(agent) })

  ctx.tools.register(defineTool({
    name: 'group_assign',
    description: 'Assign a task to one of your direct subordinates in your agent group. Returns once the task reached that member; its report arrives later as a message.',
    parameters: {
      to: { type: 'string', required: true, description: 'Name of a direct subordinate, as group_members lists it.' },
      task: {
        type: 'string',
        required: true,
        description: 'The complete task: goal, relevant context, constraints, and what the report should contain. The first line is shown as its summary.',
      },
    },
    output: jsonOutput(DELIVERY_SCHEMA),
    async execute(args, exec) {
      const assignment = await ctx.agentGroups.assign(callingAgent(exec.agent, 'group_assign').id, args.to, args.task)
      return { assignment_id: assignment.id, delivered: true }
    },
  }), { when: ({ agent }) => member(agent) })

  ctx.tools.register(defineTool({
    name: 'group_report',
    description: 'Report the outcome of an assignment to the superior who gave it. Call it once per assignment, when the task is done or cannot be done.',
    parameters: {
      report: { type: 'string', required: true, description: 'What you did, what you found, and anything left open.' },
      assignment_id: {
        type: 'string',
        description: 'Assignment being reported, from the assignment message or group_members. Required when you hold more than one open assignment.',
      },
    },
    output: jsonOutput(DELIVERY_SCHEMA),
    async execute(args, exec) {
      const assignment = await ctx.agentGroups.report(
        callingAgent(exec.agent, 'group_report').id,
        args.report,
        args.assignment_id === undefined ? undefined : brandString<AgentGroupAssignmentId>(args.assignment_id),
      )
      return { assignment_id: assignment.id, delivered: true }
    },
  }), { when: ({ agent }) => member(agent) })
}
