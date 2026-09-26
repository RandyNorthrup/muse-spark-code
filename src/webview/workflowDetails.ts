// What a workflow run's card and the Workflow tool's row show (M47, PLAN.md
// D40), read from what Muse Code 1.3.0 sent in a live capture on 2026-09-25
// (docs/certification/m47.md). Pure. A value Muse Code adds later (a status,
// a trigger source, a refusal) shows as it came.

import * as z from 'zod/mini'
import {
  GENERATED_WORKFLOW_PREFIX,
  UI_TEXT,
  WORKFLOW_CHILD_RUNNING_STATUSES,
} from '../shared/constants'
import { fill } from '../shared/l10n/text'
import { agentStatusLabel } from './agentFormat'
import type { WorkflowChild, WorkflowEntry } from './state/uiState'

/** How a run ended, read from its reconciled message. */
export interface WorkflowOutcome {
  /** What the run returned: its summary, or the message as it came. */
  readonly summary: string | undefined
  /** The last failure it reports, as it came. */
  readonly failure: string | undefined
}

/** What the Workflow tool was asked to run, and what it answered. */
export interface WorkflowLaunch {
  /** The inline script the model wrote. */
  readonly script: string | undefined
  /** A resumed run's script file. */
  readonly resumesFrom: string | undefined
  /** The launch was admitted: the run goes on in the background. */
  readonly isLaunched: boolean
  /** Where Muse Code kept the script. */
  readonly scriptPath: string | undefined
}

// The run's last message wraps a JSON report in this tag (live 2026-09-25).
const RECONCILED = /^<workflow-launch-reconciled>([\s\S]*)<\/workflow-launch-reconciled>$/
const reconciledSchema = z.object({
  final_summary: z.optional(z.nullable(z.object({ summary: z.optional(z.string()) }))),
  latest_failure: z.optional(z.unknown()),
})

const launchArgsSchema = z.object({
  script: z.optional(z.string()),
  scriptPath: z.optional(z.string()),
})
const launchResultSchema = z.object({
  status: z.string(),
  scriptPath: z.optional(z.string()),
})
const LAUNCHED = 'launched'
const JSON_INDENT = 2

/** The table's word for a key; one it does not list (only its own keys) is the key as it came. */
function tableLabel(table: Readonly<Record<string, string>>, key: string): string {
  return Object.hasOwn(table, key) ? (table[key] ?? key) : key
}

function json(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed
  } catch {
    return undefined
  }
}

/** A failure the run reported: text as it is, anything else as indented JSON. */
function failureText(failure: unknown): string | undefined {
  if (failure === undefined || failure === null) {
    return undefined
  }
  return typeof failure === 'string' ? failure : JSON.stringify(failure, undefined, JSON_INDENT)
}

/**
 * How a run ended: the summary and the last failure of Muse Code's
 * reconciled report, or, when the message is not that report, the message
 * itself as the summary. Undefined while the run has sent no message.
 */
export function workflowOutcome(message: string | undefined): WorkflowOutcome | undefined {
  if (message === undefined || message.trim() === '') {
    return undefined
  }
  const body = RECONCILED.exec(message.trim())?.[1]
  const parsed = body === undefined ? undefined : reconciledSchema.safeParse(json(body))
  if (parsed?.success !== true) {
    return { summary: message, failure: undefined }
  }
  return {
    summary: parsed.data.final_summary?.summary,
    failure: failureText(parsed.data.latest_failure),
  }
}

/** The Workflow tool call's script and launch, from its arguments and result. */
export function workflowLaunch(args: string, output: string): WorkflowLaunch {
  const given = launchArgsSchema.safeParse(json(args)).data
  const result = launchResultSchema.safeParse(json(output)).data
  return {
    script: given?.script,
    resumesFrom: given?.script === undefined ? given?.scriptPath : undefined,
    isLaunched: result?.status === LAUNCHED,
    scriptPath: result?.scriptPath,
  }
}

/** A run's name: a saved workflow's own, "Written for this task" for one the model wrote. */
export function workflowName(entry: WorkflowEntry): string {
  if (entry.entryId === undefined) {
    return entry.fallbackText ?? UI_TEXT.workflowRowLabel
  }
  return entry.entryId.startsWith(GENERATED_WORKFLOW_PREFIX)
    ? UI_TEXT.workflowGenerated
    : entry.entryId
}

/** What started a run, in words; a source the table does not list shows as it came. */
export function triggerSourceLabel(source: string): string {
  return tableLabel(UI_TEXT.workflowTriggerSources, source)
}

/** An agent's state: its outcome once it ended, else its status, each in words. */
export function childStatusLabel(child: WorkflowChild): string {
  return child.terminal === undefined
    ? tableLabel(UI_TEXT.workflowChildStatuses, child.status)
    : agentStatusLabel(child.terminal)
}

/** Whether Muse Code would skip or restart the agent now: it runs and has not ended. */
export function isChildRunning(child: WorkflowChild): boolean {
  return child.terminal === undefined && WORKFLOW_CHILD_RUNNING_STATUSES.has(child.status)
}

/** An agent's label; one the workflow did not name is numbered from 1. */
export function childName(child: WorkflowChild, index: number): string {
  return child.label ?? fill(UI_TEXT.workflowChildUntitled, { number: index + 1 })
}

/**
 * Latest reported input + output for each child's current attempt. A retry
 * resets that child's usage, so this is not the subscription's billed total.
 */
export function workflowTokens(entry: WorkflowEntry): number | undefined {
  const reported = entry.children.flatMap((child) =>
    child.usage === undefined ? [] : [child.usage.inputTokens + child.usage.outputTokens],
  )
  return reported.length === 0 ? undefined : reported.reduce((sum, tokens) => sum + tokens, 0)
}

/** Muse Code's `run.workflow_trigger_mode` in words, then how to change it. */
export function workflowTriggerText(mode: string): string {
  const sentences: Readonly<Record<string, string>> = UI_TEXT.workflowTriggerModes
  const sentence = Object.hasOwn(sentences, mode)
    ? tableLabel(sentences, mode)
    : fill(UI_TEXT.workflowTriggerOther, { mode })
  return `${sentence} ${UI_TEXT.workflowTriggerHowTo}`
}
