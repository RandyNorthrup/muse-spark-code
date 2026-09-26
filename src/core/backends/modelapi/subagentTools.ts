// The Model API backend's subagent tools (M48, PLAN.md D45). The spawn and
// wait names and core arguments came from the 2026-09-23 Muse Code capture;
// the other arguments are our own tool interface. This is not an MSP parser.

import * as z from 'zod/mini'
import {
  MODEL_API_SUBAGENT_TOOLS,
  SUBAGENT_CAPACITY,
  SUBAGENT_WAIT_DEFAULT_MS,
  SUBAGENT_WAIT_MAX_MS,
  SUBAGENT_WAIT_MIN_MS,
} from '../../../shared/constants'

/** A child's state as the tools report it (Muse Code's snake_case vocabulary). */
const SUBAGENT_STATES = ['queued', 'running', 'interrupted', 'result_ready', 'closed'] as const
export type SubagentState = (typeof SUBAGENT_STATES)[number]
const STATUS_FILTERS = ['all', ...SUBAGENT_STATES] as const

const SUBAGENT_ID = {
  type: 'string',
  description: 'The id subagent_spawn returned, e.g. subagent-1',
}
const COMMAND_ID = {
  type: 'string',
  description: 'Optional request id; spawn reuses an existing child when the same id is retried',
}

export const SUBAGENT_TOOL_DEFINITIONS: readonly {
  readonly name: string
  readonly description: string
  readonly properties: Record<string, unknown>
  readonly required: readonly string[]
}[] = [
  {
    name: MODEL_API_SUBAGENT_TOOLS.spawn,
    description: `Start a subagent: another agent with a conversation of its own that works on one objective in this workspace, with your tools except these and the same approvals, while you carry on. Use it for independent, bounded work that gains from running in parallel; do quick or sequential work yourself. Spawn follows the current approval mode. Up to ${String(SUBAGENT_CAPACITY)} work at once; later ones queue.`,
    properties: {
      role: {
        type: 'string',
        description: 'A short name for the agent, e.g. explorer or test-runner',
      },
      objective: {
        type: 'string',
        description:
          'The whole task and what to report back. The agent sees nothing else of this conversation.',
      },
      worktree_isolation: {
        type: 'boolean',
        description: 'Isolated worktrees are unavailable here: omit this or set false.',
      },
      command_id: COMMAND_ID,
    },
    required: ['role', 'objective'],
  },
  {
    name: MODEL_API_SUBAGENT_TOOLS.status,
    description: 'List your subagents with their state, or one of them.',
    properties: {
      subagent_id: SUBAGENT_ID,
      status_filter: {
        type: 'string',
        enum: [...STATUS_FILTERS],
        description: 'Only the agents in this state; all when absent',
      },
    },
    required: [],
  },
  {
    name: MODEL_API_SUBAGENT_TOOLS.wait,
    description:
      'Wait until a subagent has its result, up to a deadline, and return its summary. The wait never stops the agent. Do not poll: a result you do not collect arrives with the user’s next message.',
    properties: {
      subagent_id: SUBAGENT_ID,
      timeout_ms: {
        type: 'integer',
        description: `Milliseconds to wait, ${String(SUBAGENT_WAIT_MIN_MS)} to ${String(SUBAGENT_WAIT_MAX_MS)}; ${String(SUBAGENT_WAIT_DEFAULT_MS)} when absent`,
      },
    },
    required: ['subagent_id'],
  },
  {
    name: MODEL_API_SUBAGENT_TOOLS.sendMessage,
    description:
      'Send a subagent a message: a note it reads while it works, or, once it has a result, its next task.',
    properties: {
      subagent_id: SUBAGENT_ID,
      message: { type: 'string', description: 'The note or the next task' },
      interrupt: {
        type: 'boolean',
        description: 'Stop what the agent is doing and give it this message at once',
      },
    },
    required: ['subagent_id', 'message'],
  },
  {
    name: MODEL_API_SUBAGENT_TOOLS.readResult,
    description: 'Read a subagent’s result in full: its summary and its whole reply.',
    properties: { subagent_id: SUBAGENT_ID },
    required: ['subagent_id'],
  },
  {
    name: MODEL_API_SUBAGENT_TOOLS.cancel,
    description:
      'Stop a subagent. Cooperative: what it already did stays done; a result it already has is kept.',
    properties: {
      subagent_id: SUBAGENT_ID,
      reason: { type: 'string', description: 'Why, recorded with the cancellation' },
    },
    required: ['subagent_id'],
  },
]

// --- argument schemas (validated before anything runs) ---

export const spawnArgs = z.object({
  role: z.string().check(z.trim(), z.minLength(1)),
  objective: z.string().check(z.trim(), z.minLength(1)),
  worktree_isolation: z.optional(z.union([z.boolean(), z.record(z.string(), z.unknown())])),
  command_id: z.optional(z.string()),
})

export const statusArgs = z.object({
  subagent_id: z.optional(z.string()),
  status_filter: z.optional(z.enum(STATUS_FILTERS)),
})

export const waitArgs = z.object({
  subagent_id: z.string(),
  timeout_ms: z.optional(z.int().check(z.gte(SUBAGENT_WAIT_MIN_MS), z.lte(SUBAGENT_WAIT_MAX_MS))),
})

export const sendMessageArgs = z.object({
  subagent_id: z.string(),
  message: z.string().check(z.trim(), z.minLength(1)),
  interrupt: z.optional(z.boolean()),
})

export const targetArgs = z.object({
  subagent_id: z.string(),
  reason: z.optional(z.string()),
})

/** Whether a tool is one of the six (M48). */
export function isSubagentTool(name: string): boolean {
  const names: readonly string[] = Object.values(MODEL_API_SUBAGENT_TOOLS)
  return names.includes(name)
}
