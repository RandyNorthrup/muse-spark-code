// What a run of steps did, in one line (M87, PLAN.md D66 item 3): "Edited 2
// files, ran a command, read 3 files". The parts come in the order the steps
// first did them; files, folders and pages count distinct paths, commands and
// other tools count calls, and reasoning rows fold without a name. A failed
// step is never hidden: the count of failures ends the line. Pure: the row
// reads `describeTool()`'s body as the tool rows do.

import * as z from 'zod/mini'
import {
  MODEL_API_TOOLS,
  TOOL_STATUS_IN_PROGRESS,
  TOOL_STATUS_INTERRUPTED,
  UI_TEXT,
} from '../shared/constants'
import { capitalizeFirst, formatList, plural } from '../shared/l10n/text'
import type { TranscriptEntry } from './state/transcriptEntries'
import { describeTool, type ToolBody } from './toolPresentation'

export type StepEntry = Extract<TranscriptEntry, { kind: 'tool' | 'reasoning' }>

/** The kinds of work a summary names, as `UI_TEXT.stepSummary` keys them. */
export type StepPartKind =
  'edited' | 'read' | 'searched' | 'ran' | 'fetched' | 'searchedWeb' | 'used'

export interface StepPart {
  readonly kind: StepPartKind
  readonly count: number
}

export interface StepSummary {
  /** First-seen order; reasoning rows add none. */
  readonly parts: readonly StepPart[]
  readonly failed: number
}

const COMPLETED = 'completed'
// Both backends' workspace searches (MSP and the Model API share the names).
const SEARCH_TOOLS: ReadonlySet<string> = new Set([
  MODEL_API_TOOLS.search,
  MODEL_API_TOOLS.listFiles,
])
// Muse Code's `search` names folders in `paths`; a call naming none searched the workspace.
const searchArgsSchema = z.object({
  path: z.optional(z.string()),
  paths: z.optional(z.array(z.string())),
})
const WORKSPACE_SCOPE = ''

/** A step that is still running is not finished; a thought is finished once it stops streaming. */
export function isFinishedStep(step: StepEntry): boolean {
  return step.kind === 'reasoning' ? !step.isStreaming : step.status !== TOOL_STATUS_IN_PROGRESS
}

/** A tool row that ended in neither success nor an interruption: its dot is the failure's. */
function isFailedStep(step: StepEntry): boolean {
  return (
    step.kind === 'tool' &&
    step.status !== COMPLETED &&
    step.status !== TOOL_STATUS_IN_PROGRESS &&
    step.status !== TOOL_STATUS_INTERRUPTED
  )
}

/** The folders a search looked in; the workspace when it names none. */
function searchScopes(args: string): readonly string[] {
  let raw: unknown
  try {
    raw = JSON.parse(args)
  } catch {
    return [WORKSPACE_SCOPE]
  }
  const parsed = searchArgsSchema.safeParse(raw)
  if (!parsed.success) {
    return [WORKSPACE_SCOPE]
  }
  const named = [
    ...(parsed.data.paths ?? []),
    ...(parsed.data.path === undefined ? [] : [parsed.data.path]),
  ]
  return named.length === 0 ? [WORKSPACE_SCOPE] : named
}

/** One kind's tally: distinct targets plus the calls that name none. */
interface Tally {
  readonly targets: Set<string>
  extra: number
}

function kindOf(tool: string, body: ToolBody): StepPartKind {
  if (SEARCH_TOOLS.has(tool)) {
    return 'searched'
  }
  switch (body) {
    case 'edit': {
      return 'edited'
    }
    case 'read': {
      return 'read'
    }
    case 'shell': {
      return 'ran'
    }
    case 'fetch': {
      return 'fetched'
    }
    case 'web': {
      return 'searchedWeb'
    }
    default: {
      return 'used'
    }
  }
}

/** What the step adds to its kind's tally; `target` is its row's path or page. */
function count(
  tally: Tally,
  kind: StepPartKind,
  step: Extract<StepEntry, { kind: 'tool' }>,
  target: string,
): void {
  switch (kind) {
    case 'edited':
    case 'read':
    case 'fetched': {
      // An edit's patch that names several files without one path adds its own count.
      if (target === '') {
        tally.extra += kind === 'edited' ? (step.patchSummary?.files ?? 1) : 1
      } else {
        tally.targets.add(target)
      }
      return
    }
    case 'searched': {
      for (const scope of searchScopes(step.args)) {
        tally.targets.add(scope)
      }
      return
    }
    default: {
      tally.extra += 1
    }
  }
}

export function stepSummary(steps: readonly StepEntry[]): StepSummary {
  const tallies = new Map<StepPartKind, Tally>()
  let failed = 0
  for (const step of steps) {
    if (step.kind !== 'tool') {
      continue
    }
    if (isFailedStep(step)) {
      failed += 1
    }
    const { body, summary } = describeTool(step.tool, step.args)
    const kind = kindOf(step.tool, body)
    let tally = tallies.get(kind)
    if (tally === undefined) {
      tally = { targets: new Set(), extra: 0 }
      tallies.set(kind, tally)
    }
    count(tally, kind, step, summary)
  }
  const parts = Array.from(tallies, ([kind, tally]) => ({
    kind,
    count: tally.targets.size + tally.extra,
  }))
  return { parts, failed }
}

/**
 * The summary in the display language: each part's plural form, the
 * failures last, joined as the language lists units, the first letter
 * raised. A run of thoughts alone reads as a thought's row does.
 */
export function stepSummaryText(summary: StepSummary): string {
  const forms = UI_TEXT.stepSummary
  const parts = summary.parts.map((part) => plural(forms[part.kind], part.count))
  if (summary.failed > 0) {
    parts.push(plural(forms.failed, summary.failed))
  }
  return parts.length === 0 ? UI_TEXT.thoughtDone : capitalizeFirst(formatList(parts))
}
