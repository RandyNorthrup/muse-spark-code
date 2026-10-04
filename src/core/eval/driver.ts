// One M75 task's turn (PLAN.md D49) on the extension's own Model API
// harness: a `ModelApiHost` over the task's workspace, the task's prompt
// sent as the user's message, and the turn waited for. The harness is the
// one users run (its system prompt, tools, permission engine and tool loop),
// so a mechanism measured here is the mechanism that ships. Only the panel is
// replaced: a card is allowed once, a question is answered with "proceed",
// and no paid feature is on or allowed (D48), child tasks included.
//
// A mechanism under test changes the host's dependencies (`EvalHostChange`),
// so the two arms of a paired run differ in that alone.

import type { AgentSession } from '../agent/agentBackend'
import type { ContextIo } from '../context/contextFiles'
import type { CoreLogger } from '../logging'
import type { ModelApiClient } from '../backends/modelapi/client'
import { ModelApiHost, type ModelApiHostDeps } from '../backends/modelapi/ModelApiHost'
import { APPROVAL_CHOICE_IDS } from '../backends/modelapi/permissions'
import type { ToolIo } from '../backends/modelapi/tools'
import type { AgentEvent, ItemSnapshot } from '../../shared/agentEvents'
import {
  EVAL_APPROVAL_MODE,
  EVAL_MODEL_ID,
  EVAL_TURN_COMPLETED,
  EVAL_TURN_TIMED_OUT,
  EVAL_TURN_TIMEOUT_MS,
  MODEL_API_MODEL_TEXT,
  MODEL_API_TOOLS,
  SETTING_DEFAULTS,
} from '../../shared/constants'

/** A mechanism: the change it makes to the harness's dependencies. */
export type EvalHostChange = (deps: ModelApiHostDeps) => ModelApiHostDeps

export interface EvalTurnDeps {
  readonly client: ModelApiClient
  /** The tools' file and shell access, confined to the task's workspace. */
  readonly io: ToolIo
  readonly contextIo: ContextIo
  readonly platform: NodeJS.Platform
  /** The key's SHA-256 digest, as the extension scopes sessions by it; never the key. */
  readonly accountId: string
  readonly log: CoreLogger
  readonly now: () => number
  readonly newId: () => string
  /** How long the turn may run; the constant unless a test shortens it. */
  readonly turnTimeoutMs?: number | undefined
}

export interface EvalTurnOptions {
  readonly deps: EvalTurnDeps
  readonly workspace: string
  readonly prompt: string
  readonly change?: EvalHostChange | undefined
}

export interface EvalTurnOutcome {
  /** The host's terminal (`completed`, `failed`, `cancelled`), or `timedOut`. */
  readonly terminal: string
  readonly reason: string | undefined
  /** Tool calls the model made, by tool name, in order. */
  readonly tools: readonly string[]
  /** Cards allowed once (shell commands, protected writes). */
  readonly approvals: number
  readonly questions: number
  /** Paid uses the harness asked for; the run refuses every one. */
  readonly paidRefusals: number
  /** Paid uses that happened anyway; a run with any is wrong. */
  readonly paidUses: number
  /** What the stand-in panel could not do (a card it could not answer). */
  readonly problems: readonly string[]
  /** The packing ledger's last total (M73); absent when no session packed. */
  readonly packedTokensAvoided?: number
  /**
   * What each `recall_output` call that succeeded returned (M73), for the
   * packing arm's own check; never copied into a report.
   */
  readonly recalledOutputs: readonly string[]
}

type TurnCompleted = Extract<AgentEvent, { type: 'turnCompleted' }>
type ApprovalRequested = Extract<AgentEvent, { type: 'approvalRequested' }>

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * What a mechanism may not change: the client (every request must pass the
 * trace), the workspace (the empty folder) and the paid-use hooks (the run
 * refuses and counts every paid use).
 */
const HELD_DEPS = [
  'client',
  'workspaceRoot',
  'allowsPaidUse',
  'isPaidUseRemembered',
  'notePaidUse',
  'noteSubagentUsage',
  'noteReviewerUsage',
] as const satisfies readonly (keyof ModelApiHostDeps)[]

/** The mechanism's harness; one that moves a held dependency does not run. */
function applyChange(deps: ModelApiHostDeps, change: EvalHostChange | undefined): ModelApiHostDeps {
  if (change === undefined) {
    return deps
  }
  const changed = change(deps)
  const moved = HELD_DEPS.filter((name) => changed[name] !== deps[name])
  if (moved.length > 0) {
    throw new Error(`the mechanism changed ${moved.join(', ')}, which the evaluation holds fixed`)
  }
  return changed
}

/** What the owner would click on a card: allow once. */
function allowOnce(session: AgentSession, card: ApprovalRequested, problems: string[]): void {
  void session
    .decideApproval({
      approvalId: card.approvalId,
      choiceId: APPROVAL_CHOICE_IDS.allowOnce,
      requirementId: card.requirementId,
    })
    .catch((error: unknown) => {
      problems.push(`card for ${card.toolName}: ${describe(error)}`)
    })
}

export async function runEvalTurn(options: EvalTurnOptions): Promise<EvalTurnOutcome> {
  const { deps } = options
  const counts = { approvals: 0, questions: 0, paidRefusals: 0, paidUses: 0 }
  const problems: string[] = []
  const items: ItemSnapshot[] = []
  const finished: TurnCompleted[] = []
  let packedTokensAvoided: number | undefined
  let wake: (() => void) | undefined

  const hostDeps: ModelApiHostDeps = {
    client: deps.client,
    workspaceRoot: options.workspace,
    platform: deps.platform,
    io: deps.io,
    contextIo: deps.contextIo,
    newId: deps.newId,
    now: deps.now,
    log: deps.log,
    // Nothing from the owner's profile: no personal skills, agents, memory or hooks.
    personalSkillsRoot: undefined,
    personalAgentsRoot: undefined,
    memory: undefined,
    isWorkspaceTrusted: () => true,
    isConfidentialWorkspace: () => false,
    // The run already opts into the contributor model; its paid-use hook still refuses children.
    confirmContributorModel: () => Promise.resolve(true),
    describeEnvironment: () => Promise.resolve({ git: undefined }),
    promptCacheRetention: () => SETTING_DEFAULTS.modelApiPromptCacheRetention,
    // M82's cap and reply line as a fresh panel has them: no cap, no line.
    // The evaluation's own wire counts its spend and refuses past its budget.
    sessionBudgetUsd: () => SETTING_DEFAULTS.modelApiSessionBudgetUsd,
    showReplyUsage: () => SETTING_DEFAULTS.modelApiReplyUsage,
    getAccountId: () => Promise.resolve(deps.accountId),
    isPaidFeatureOn: () => false,
    notePaidUse: (_feature, units) => {
      counts.paidUses += units
    },
    allowsPaidUse: () => {
      counts.paidRefusals += 1
      return Promise.resolve(false)
    },
    isPaidUseRemembered: () => false,
    // A child task that ran is a paid use (D48) the run should have refused;
    // its requests went through the same client, so the trace counts them.
    noteSubagentUsage: () => {
      counts.paidUses += 1
    },
    // So is an Auto review (M78): no paid feature is on, so one that
    // reported usage ran anyway.
    noteReviewerUsage: () => {
      counts.paidUses += 1
    },
  }
  const host = new ModelApiHost(applyChange(hostDeps, options.change))
  try {
    const session = await host.startSession({
      workspaceRoot: options.workspace,
      modelId: EVAL_MODEL_ID,
      approvalMode: EVAL_APPROVAL_MODE,
    })
    session.onEvent((event) => {
      switch (event.type) {
        case 'approvalRequested': {
          if (event.isReplayed !== true) {
            counts.approvals += 1
            allowOnce(session, event, problems)
          }
          break
        }
        case 'questionRequested': {
          counts.questions += 1
          void session
            .clarifyQuestions(event.userInputId, MODEL_API_MODEL_TEXT.evalClarification)
            .catch((error: unknown) => {
              problems.push(`question: ${describe(error)}`)
            })
          break
        }
        case 'itemCompleted': {
          items.push(event.item)
          break
        }
        case 'tokenUsage': {
          // A session total: the last one is the turn's.
          packedTokensAvoided = event.packedTokensAvoided ?? packedTokensAvoided
          break
        }
        case 'turnCompleted': {
          finished.push(event)
          wake?.()
          break
        }
        default: {
          break
        }
      }
    })
    const { turnId } = await session.sendTurn([{ type: 'text', text: options.prompt }])
    const turn = await new Promise<TurnCompleted | undefined>((resolve) => {
      const timer = setTimeout(() => {
        wake = undefined
        resolve(undefined)
      }, deps.turnTimeoutMs ?? EVAL_TURN_TIMEOUT_MS)
      wake = () => {
        const found = finished.find((event) => event.turnId === turnId)
        if (found === undefined) {
          return
        }
        clearTimeout(timer)
        wake = undefined
        resolve(found)
      }
      wake()
    })
    if (turn === undefined) {
      await session.cancel()
    }
    const calls = items.filter((item) => item.turnId === turnId && item.kind === 'toolCall')
    return {
      terminal: turn?.terminal ?? EVAL_TURN_TIMED_OUT,
      reason: turn?.reason,
      tools: calls.map((item) => item.tool ?? item.kind),
      ...counts,
      // A copy: a card answered after the turn cannot change the outcome.
      problems: [...problems],
      ...(packedTokensAvoided !== undefined && { packedTokensAvoided }),
      recalledOutputs: calls.flatMap((item) =>
        item.tool === MODEL_API_TOOLS.recallOutput &&
        // An item completes with the same word a turn does.
        item.status === EVAL_TURN_COMPLETED &&
        item.failureReason === undefined &&
        item.visibleOutput !== undefined
          ? [item.visibleOutput]
          : [],
      ),
    }
  } finally {
    await host.close()
  }
}
