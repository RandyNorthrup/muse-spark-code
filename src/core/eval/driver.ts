import { Usd, sumUsd, type UsdAmount } from '../../shared/usd'
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
import {
  createAutoCompactionAdmission,
  type AutoCompactionLedger,
} from '../backends/modelapi/autoCompactionAdmission'
import { ModelApiHost, type ModelApiHostDeps } from '../backends/modelapi/ModelApiHost'
import { APPROVAL_CHOICE_IDS } from '../backends/modelapi/permissions'
import type { ToolIo } from '../backends/modelapi/tools'
import type { MemoryStore } from '../memory/memoryStore'
import type { AgentEvent, ItemSnapshot } from '../../shared/agentEvents'
import {
  EVAL_APPROVAL_MODE,
  EVAL_BUDGET_USD,
  EVAL_MODEL_ID,
  EVAL_TURN_COMPLETED,
  EVAL_TURN_TIMED_OUT,
  EVAL_TURN_TIMEOUT_MS,
  IS_AUTO_COMPACTION_EVALUATED,
  MODEL_API_CONTEXT_WINDOW,
  MODEL_API_MODEL_TEXT,
  MODEL_API_TOOLS,
  SETTING_DEFAULTS,
} from '../../shared/constants'
import type { ApprovalMode } from '../../shared/permissionModes'
import { EVAL_HELD_DEPS } from './heldDeps'
import { isMissingEvalAdmissionError } from './mechanisms'
import type { EvalBudget } from './wire'

/** A mechanism: the change it makes to the harness's dependencies. */
export type EvalHostChange = (deps: ModelApiHostDeps) => ModelApiHostDeps

/**
Installs the real shared D78 admission over `base`, with its switches
reading whatever `readArmed` returns when the turn asks to compact. The
driver passes the dependencies its frozen change is about to arm; a
caller that arms first (a session-level test) passes its armed result.
*/
export function bindEvalAdmission(
  base: ModelApiHostDeps,
  admission: EvalCompactionAdmission,
  log: CoreLogger,
  readArmed: () => ModelApiHostDeps,
): ModelApiHostDeps {
  return {
    ...base,
    admitAutoCompaction: createAutoCompactionAdmission({
      accounting: admission.ledger,
      allowsPaidUse: admission.allowsPaidUse,
      // The production compaction path through its on-demand pricing port,
      // exactly as a user's session loads it: price and model-policy code
      // stays out until the first compaction prepares, and the harness
      // never reaches past the port into the old import path.
      loadPricing: async () => {
        const [providers, policy] = await Promise.all([
          import('../../host/backend/providersEntry'),
          import('../backends/modelapi/modelPolicy'),
        ])
        return {
          reserveRequestAmount: providers.priceCard.reserveRequestAmount,
          requestImageCount: policy.requestImageCount,
        }
      },
      isOn: () => readArmed().autoCompaction?.() ?? SETTING_DEFAULTS.modelApiAutoCompaction,
      isTrusted: () => readArmed().isWorkspaceTrusted(),
      isEvaluated: () => readArmed().autoCompactionEvaluated?.() ?? IS_AUTO_COMPACTION_EVALUATED,
      paidUseFence: admission.paidUseFence,
      dailyBudgetUsd: admission.dailyBudgetUsd,
      notePaidUse: admission.notePaidUse,
      log,
    }),
  }
}

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
  /**
  A memory store for the turn; absent unless a test supplies a fake one.
  Never owner data: the counted run runs without memory, as the harness
  certifies. A mechanism must not change it (it is held fixed below).
  */
  readonly memory?: MemoryStore | undefined
  /**
  Lane E's spend authority for admitted compaction (PLAN.md M101): the
  counted runner binds it, tests bind it. Without it the auto-compaction
  arm fails closed: its frozen change requires the parent's admission.
  */
  readonly admission?: EvalCompactionAdmission | undefined
}

/**
What the parent binds behind one evaluation turn's automatic compaction
(PLAN.md M101 lane E): the REAL shared D78 admission and a ledger against
the run's own hard budget — never a test double that admits without
charge. Consent admits because launching the counted run is the opt-in;
every admitted attempt is trace-counted and settled against the budget.
*/
export interface EvalCompactionAdmission {
  /** Reserves and settles admitted attempts; a refusal throws. It tallies started and settled attempts. */
  readonly ledger: AutoCompactionLedger & { readonly tally: EvalCompactionTally }
  /** The counted run's own consent. */
  readonly allowsPaidUse: ModelApiHostDeps['allowsPaidUse']
  /** Admitted attempts, tallied on the ledger; never the paid-use failure counter. */
  readonly notePaidUse: ModelApiHostDeps['notePaidUse']
  /** Revocation source; the runner binds the run budget, tests bind true. */
  readonly paidUseFence: (sessionId: string) => () => boolean
  readonly dailyBudgetUsd: () => UsdAmount | Promise<UsdAmount>
}

/** Admitted attempts, started and settled, on one evaluation ledger. */
export interface EvalCompactionTally {
  started: number
  settled: number
  reservedUsd: UsdAmount
  settledUsd: UsdAmount
  outstandingUsd: UsdAmount
  retainedUsd: UsdAmount
}

/**
The evaluation ledger: a real D78 ledger, not an allowance stub. It
reserves each admitted attempt against the run's hard budget and refuses
(by throwing, as the interface requires) past it, on unknown usage, or
on abort. Settling releases the reservation without adding to the spent
total: the trace owns actual spend — the wire adds every reply's usage
when it arrives — so settling here must not count it twice. Unknown cost
stops the run, like the wire's own rule.
*/
export function createEvalCompactionLedger(
  budget: EvalBudget,
): AutoCompactionLedger & { readonly tally: EvalCompactionTally } {
  const tally: EvalCompactionTally = {
    started: 0,
    settled: 0,
    reservedUsd: Usd.from(0).toAmount(),
    settledUsd: Usd.from(0).toAmount(),
    outstandingUsd: Usd.from(0).toAmount(),
    retainedUsd: Usd.from(0).toAmount(),
  }
  const headroom = (): Usd =>
    Usd.from(EVAL_BUDGET_USD)
      .subtract(Usd.from(budget.spentUsd))
      .subtract(Usd.from(tally.outstandingUsd))
  return {
    tally,
    reserveCompaction: (amount, signal) => {
      signal.throwIfAborted()
      if (budget.hasUnknownUsage === true)
        return Promise.reject(evalLedgerRefusal('a sent model call has unknown usage'))
      if (headroom().compare(Usd.from(amount)) < 0)
        return Promise.reject(evalLedgerRefusal('the run budget cannot cover it'))
      tally.outstandingUsd = sumUsd(tally.outstandingUsd, amount)
      tally.reservedUsd = sumUsd(tally.reservedUsd, amount)
      let isOpen = true
      return Promise.resolve({
        estimateUsd: amount,
        check(): void {
          signal.throwIfAborted()
          if (budget.hasUnknownUsage === true)
            throw evalLedgerRefusal('a sent model call has unknown usage')
          if (headroom().compare(Usd.from(0)) < 0)
            throw evalLedgerRefusal('the run budget is spent')
        },
        settle: (costUsd) => {
          if (isOpen) {
            isOpen = false
            tally.outstandingUsd = Usd.from(tally.outstandingUsd)
              .subtract(Usd.from(amount))
              .toAmount()
            // D121: a call without its usage adds nothing; the unknown
            // stops the run through the flag below, like the wire's rule.
            if (costUsd !== undefined) tally.settledUsd = sumUsd(tally.settledUsd, costUsd)
            tally.settled += 1
          }
          if (costUsd === undefined) budget.hasUnknownUsage = true
          return Promise.resolve()
        },
      })
    },
  }
}

function evalLedgerRefusal(why: string): Error {
  return new Error(`the evaluation cannot reserve an admitted compaction: ${why}`)
}

/**
The evaluation's paid-use fence: current while the run budget can still
cover a send. Read live, so an admitted use revokes the moment the run
cannot cover it.
*/
export function evalPaidUseFence(budget: EvalBudget): () => boolean {
  return () =>
    budget.hasUnknownUsage !== true &&
    Usd.from(budget.spentUsd).compare(Usd.from(EVAL_BUDGET_USD)) < 0
}

export interface EvalTurnOptions {
  readonly deps: EvalTurnDeps
  readonly workspace: string
  readonly prompt: string
  readonly change?: EvalHostChange | undefined
  /**
  The context window both arms of the turn share (M101 R2: the window is
  harness condition, never a mechanism — a mechanism that changed it
  would also change file-read truncation). The runner resolves it per
  task; a test passes it directly. The default is the shipped window.
  */
  readonly windowTokens?: number | undefined
  /**
  The approval mode for the turn; the frozen constant unless a test needs
  a refusing disposition (denied automatic memory flush) on the same
  harness. The counted run never overrides it.
  */
  readonly approvalMode?: ApprovalMode | undefined
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
  /** The host accepted a summary and replaced history, independent of failed attempts. */
  readonly compactionsApplied: number
  /**
  What each `recall_output` call that succeeded returned (M73), for the
  packing arm's own check; never copied into a report.
  */
  readonly recalledOutputs: readonly string[]
}

type TurnCompleted = Extract<AgentEvent, { type: 'turnCompleted' }>
type ApprovalRequested = Extract<AgentEvent, { type: 'approvalRequested' }>

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The mechanism's harness; one that moves a held dependency does not run. */
function applyChange(deps: ModelApiHostDeps, change: EvalHostChange | undefined): ModelApiHostDeps {
  if (change === undefined) {
    return deps
  }
  const changed = change(deps)
  const moved = EVAL_HELD_DEPS.filter((name) => changed[name] !== deps[name])
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
  // The frozen arm's missing-admission marker, when the turn's admission
  // threw it: the shipped host carries none of this marker (bundle diet
  // pin), so the driver fails the turn closed below instead of the product.
  let missingAdmission: Error | undefined

  const hostDeps: ModelApiHostDeps = {
    client: deps.client,
    workspaceRoot: options.workspace,
    platform: deps.platform,
    io: deps.io,
    contextIo: deps.contextIo,
    newId: deps.newId,
    now: deps.now,
    log: deps.log,
    // The window is harness condition, shared by both arms of a pair (M101
    // R2): the evaluation window for a long-context task, the shipped
    // window otherwise. A mechanism that overrode it would also move
    // file-read truncation, so the held-deps check above refuses one.
    contextModel: () => ({
      format: 'responses',
      contextTokens: options.windowTokens ?? MODEL_API_CONTEXT_WINDOW,
    }),
    // Nothing from the owner's profile: no personal skills or agents, no
    // owner memory or hooks. A test may supply a fake memory store to
    // exercise the automatic memory flush path; the counted run has none.
    personalSkillsRoot: undefined,
    personalAgentsRoot: undefined,
    memory: deps.memory,
    isWorkspaceTrusted: () => true,
    isConfidentialWorkspace: () => false,
    // The run already opts into the contributor model; its paid-use hook still refuses children.
    confirmContributorModel: () => Promise.resolve(true),
    describeEnvironment: () => Promise.resolve({ git: undefined }),
    promptCacheRetention: () => SETTING_DEFAULTS.modelApiPromptCacheRetention,
    // M82's cap and reply line as a fresh panel has them: no cap, no line.
    // The evaluation's own wire counts its spend and refuses past its budget.
    sessionBudgetUsd: () => Usd.from(SETTING_DEFAULTS.modelApiSessionBudgetUsd).toAmount(),
    showReplyUsage: () => SETTING_DEFAULTS.modelApiReplyUsage,
    // M91 lane S: M75 records the shell-directory setting as off (PLAN.md
    // M91 step 4), matching the recorded baseline, which predates it: every
    // arm still runs under the baseline's conditions. The shipped default
    // stays on; flipping this needs a fresh baseline run.
    shellKeepsDirectory: () => false,
    getAccountId: () => Promise.resolve(deps.accountId),
    isPaidFeatureOn: () => false,
    // M101 CM1013R9: M75 records automatic compaction as off, matching the
    // recorded baseline the binding run certified: an arm that compacts says
    // so through its frozen change, and the shipped default stays on (the
    // same split as shellKeepsDirectory above). Without this the evaluated
    // production latch would compact the baseline, packing and strict-tools
    // arms, and every settled attempt would fail its task as a paid use.
    autoCompaction: () => false,
    autoCompactionEvaluated: () => false,
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
  // Lane E binds the REAL shared D78 admission behind the turn (never a
  // test double): consent once per use, reserve/recheck/settle each attempt
  // against the run's own ledger. The window, memory, client, workspace and
  // paid hooks stay held — only this key is the mechanism's. The admission
  // is installed before the frozen change (so the auto-compaction arm's
  // wrapper delegates to it), but its switches read the ARMED dependencies:
  // the change below sets the mechanism's flags, and the factory reads them
  // lazily when the turn asks to compact. Without a bound admission the
  // host gets none, and the auto-compaction arm fails closed in its change.
  // The admission reads through this holder so its switches see the
  // dependencies the frozen change arms below, not the unarmed base.
  const armedRef: { current: ModelApiHostDeps } = { current: hostDeps }
  const withAdmission: ModelApiHostDeps =
    deps.admission === undefined
      ? hostDeps
      : bindEvalAdmission(hostDeps, deps.admission, deps.log, () => armedRef.current)
  armedRef.current = applyChange(withAdmission, options.change)
  // Watch the armed admission for the frozen arm's marker: the wrapper
  // rethrows it untouched, so the host sees the identical error, while the
  // driver learns whether the turn ran without its parent's admission.
  const admit = armedRef.current.admitAutoCompaction
  if (admit !== undefined) {
    armedRef.current = {
      ...armedRef.current,
      admitAutoCompaction: async (request) => {
        try {
          return await admit(request)
        } catch (error: unknown) {
          if (isMissingEvalAdmissionError(error)) missingAdmission = error
          throw error
        }
      },
    }
  }
  const host = new ModelApiHost(armedRef.current)
  try {
    const session = await host.startSession({
      workspaceRoot: options.workspace,
      modelId: EVAL_MODEL_ID,
      approvalMode: options.approvalMode ?? EVAL_APPROVAL_MODE,
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
    // Fail closed: the arm ran without its parent's admission. When the
    // turn already failed its reason stands; otherwise the driver fails it
    // here with the marker's reason, so the run never passes as if
    // uncompacted were the mechanism.
    const terminal = turn?.terminal ?? EVAL_TURN_TIMED_OUT
    const failure =
      missingAdmission !== undefined && terminal !== 'failed' ? missingAdmission : undefined
    return {
      terminal: failure === undefined ? terminal : 'failed',
      reason: failure?.message ?? turn?.reason,
      tools: calls.map((item) => item.tool ?? item.kind),
      ...counts,
      // A copy: a card answered after the turn cannot change the outcome.
      problems: [...problems],
      ...(packedTokensAvoided !== undefined && { packedTokensAvoided }),
      // The host emits this completed paid row only AFTER accepting the summary
      // and replacing replay history; rejected attempts emit no such row.
      compactionsApplied: items.filter(
        (item) =>
          item.kind === 'compaction' &&
          item.status === EVAL_TURN_COMPLETED &&
          item.paid === 'autoCompaction',
      ).length,
      recalledOutputs: calls.flatMap((item) =>
        item.tool === MODEL_API_TOOLS.recallOutput &&
        // An item completes with the same word a turn does.
        item.status === EVAL_TURN_COMPLETED &&
        item.failureReason === undefined &&
        item.visibleOutput !== undefined
          ? item.visibleOutput
          : [],
      ),
    }
  } finally {
    await host.close()
  }
}
