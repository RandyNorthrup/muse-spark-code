// Replay authorization, context loaders and verification load on first use.
import type { ModelApiHostDeps, ModelApiSession, ActiveTurn, HookEffects } from './ModelApiHost'
import type { RuleFileLoad, RulesLoaderDeps } from '../../context/rules'
import type { SkillsLoad, SkillsLoaderDeps, SkillRoot } from '../../context/skills'
import type { AgentsLoad, AgentsLoaderDeps, AgentRoot } from '../../context/customAgents'
import type { MemoryStore, MemoryScopeSnapshot } from '../../memory/memoryStore'
import type { CodeIntelDeps } from '../../codeIntel/codeIntelQuery'
import type { AgentEvent, ItemSnapshot } from '../../../shared/agentEvents'
import type { TurnPart, TurnSubmission } from '../../agent/agentBackend'
import type { ConfirmedModelRequest } from './client'
import type { CreateResponseBody, InputItem } from './schemas'
import type { UnattendedRun } from '../../schedules/unattended'
import {
  ProvenanceLedger,
  contentHash,
  type ProvenanceEntry,
  type ContentSource,
} from '../../schedules/provenance'
import type { RecordingScope, ContentRead } from '../../context/recordingReader'
import { setUiText } from '../../../shared/l10n/text'
import type { VerifyLedger, CheckScope } from './verifyLedger'
import type { CheckRun, VerifyHooks, skippedCheck, checksSection } from './verifyLoop'
import type {
  EditedFile,
  FileDiagnostics,
  PendingReport,
  DiagnosticsHistory,
} from '../../verify/diagnosticsReport'
import { fill, plural } from '../../../shared/l10n/text'
import type { UiText } from '../../../shared/l10n/en'
import {
  scheduleCadenceSchema,
  scheduleViewOf,
  type ScheduleCadence,
  type ScheduledPrompt,
  type ScheduleRunConfirmation,
  type ScheduleStore,
} from '../../../shared/schedule'
import { nextScheduleFire } from './schedules'

import {
  CHECK_FIX_MAX_ROUNDS,
  VERIFY_NOTE_MAX_CHARS,
  VERIFY_SHOWN_FILES_MAX,
  VERIFY_TOOLS,
  type MODEL_API_MODEL_TEXT,
  type CheckCommandSetting,
  MODEL_API_SCHEDULED_TOOL,
  SCHEDULE_LIFETIME_MS,
  SCHEDULE_MAX_INTERVAL_MS,
  SCHEDULE_MAX_JOBS_PER_SESSION,
  SCHEDULE_MAX_PROMPT_CHARS,
  SCHEDULE_MIN_INTERVAL_MS,
  SCHEDULE_POLL_INTERVAL_MS,
  UI_TEXT,
} from '../../../shared/constants'

function isAbortRequested(signal: AbortSignal): boolean {
  return signal.aborted
}

// Every recorded read installs the caller's language; copying the whole table
// and rebuilding the Intl formatters each time cost ~4 ms per read.
const installed: { table: UiText | undefined; locale: string | undefined } = {
  table: undefined,
  locale: undefined,
}
export function installLanguage(table: UiText, locale: string): void {
  if (installed.table === table && installed.locale === locale) return
  setUiText(table, locale)
  Object.assign(installed, { table, locale })
}
export function createLedger(preFire: Iterable<ProvenanceEntry>): ProvenanceLedger {
  return new ProvenanceLedger(preFire)
}

interface ReplayContext {
  readonly run: UnattendedRun
  readonly body: CreateResponseBody
  readonly ledger: ProvenanceLedger
  readonly origins: ReadonlyMap<
    string,
    { readonly source: ContentSource; readonly scope: RecordingScope | undefined }
  >
  readonly material: readonly ContentRead[]
  readonly instructionScope: RecordingScope | undefined
  readonly mediaScope: RecordingScope | undefined
  readonly replay: readonly { readonly item: InputItem }[]
  readonly turnId: string
  readonly newId: () => string
  readonly abortError: () => Error
  readonly isCurrent: () => boolean
}

/** Checks exact replay/request bytes; cached sources never resolve a new alias. */
export async function checkScheduledReplay(context: ReplayContext): Promise<void> {
  const { ledger, run, body } = context
  const refuse = (): never => {
    throw new Error(
      run.refuse(
        {
          id: context.newId(),
          class: 'requiresAsking',
          tool: 'replay',
          paths: [],
          requiresAsking: true,
          protectedPath: false,
        },
        run.modelText.requiresAskingRefused,
      ),
    )
  }
  const canUseSource = async (input: ContentRead): Promise<boolean> => {
    if (ledger.allows(input.bytes)) return true
    const id = context.newId()
    const decision = await run.decideSource(input.source, id)
    if (
      !decision.allowed ||
      (input.source.kind !== 'file' &&
        input.source.kind !== 'skill' &&
        input.source.kind !== 'directory')
    )
      return false
    ledger.decidedSource(input.source, id)
    ledger.decided(input.bytes, input.source, id)
    return ledger.allows(input.bytes)
  }
  const visiting = new Set<string>()
  const canUseCached = async (bytes: string | Uint8Array): Promise<boolean> => {
    if (ledger.allows(bytes)) return true
    const hash = contentHash(bytes)
    if (visiting.has(hash)) return false
    const origin = context.origins.get(hash)
    if (origin === undefined) return false
    const inputs = origin.scope?.inventory()
    if (inputs === undefined || inputs.length === 0) return false
    visiting.add(hash)
    for (const input of inputs) {
      if (ledger.allows(input.bytes)) continue
      if (
        !(input.source.kind === 'harness'
          ? await canUseCached(input.bytes)
          : await canUseSource(input))
      )
        return false
    }
    visiting.delete(hash)
    ledger.derive(
      bytes,
      origin.scope,
      origin.source.kind === 'harness' ? `cached-${origin.source.operation}` : 'cached-tool-output',
    )
    return ledger.allows(bytes)
  }
  // Only the harness's fixed scaffolding is independent of repository bytes.
  ledger.decided(
    'instruction-scaffolding',
    { kind: 'harness', operation: 'instructions' },
    context.turnId,
  )
  const material = context.material
  for (const input of material) {
    if (ledger.allows(input.bytes)) continue
    if (
      !(input.source.kind === 'harness' || context.origins.has(contentHash(input.bytes))
        ? await canUseCached(input.bytes)
        : await canUseSource(input))
    )
      refuse()
  }
  ledger.derive(body.instructions, context.instructionScope, 'instruction-refresh')
  for (const entry of context.replay) {
    const bytes = JSON.stringify(entry.item)
    if (ledger.allows(bytes)) continue
    if (!(await canUseCached(bytes))) return refuse()
  }
  // Fitting/packing are projections of these exact replay bytes. A transform
  // of an unproved source never becomes allowed just because it is new.
  for (const [index, item] of body.input.entries()) {
    const original = context.replay[index]
    const bytes = JSON.stringify(item)
    if (original === undefined) {
      if (ledger.allows(bytes)) continue
      return refuse()
    }
    if (bytes !== JSON.stringify(original.item))
      ledger.derive(bytes, context.mediaScope, 'media-fit/packing')
    if (!ledger.allows(bytes)) refuse()
  }
  if (!ledger.allows(body.instructions) || !context.isCurrent() || !run.isActive())
    throw context.abortError()
}

interface SchedulePort {
  readonly deps: Pick<
    ModelApiHostDeps,
    | 'getAccountId'
    | 'scheduleStore'
    | 'workspaceRoot'
    | 'now'
    | 'newId'
    | 'log'
    | 'isPaidFeatureOn'
    | 'notePaidUse'
  >
  readonly sessionId: string
  readonly modelId: () => string
  readonly isDisposed: () => boolean
  readonly isSideChat: boolean
  readonly emit: (event: AgentEvent) => void
  readonly touch: () => void
  readonly onPersisted: () => Promise<void>
  readonly recordTranscript: (turnId: string, item: ItemSnapshot) => void
  readonly isScheduleBusy: () => boolean
  readonly sendTurn: (
    parts: readonly TurnPart[],
    displayText: string | undefined,
    requestFor: (turnId: string) => ConfirmedModelRequest,
  ) => Promise<TurnSubmission>
}

const COMPLETED = 'completed'
const IN_PROGRESS = 'inProgress'
const CANCELLED = 'cancelled'
const FAILED = 'failed'
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class ModelApiSchedules {
  private scheduleTimer: ReturnType<typeof setInterval> | undefined
  public constructor(private readonly port: SchedulePort) {}
  private async scheduleAccountId(): Promise<string> {
    const id = await this.port.deps.getAccountId()
    if (id === undefined) {
      throw new Error(UI_TEXT.scheduleAccountMissing)
    }
    return id
  }

  private scheduleStore(): ScheduleStore {
    const store = this.port.deps.scheduleStore
    if (store === undefined) {
      throw new Error(UI_TEXT.scheduleStorageMissing)
    }
    return store
  }

  private publishSchedules(jobs: readonly ScheduledPrompt[]): readonly ScheduledPrompt[] {
    this.port.emit({ type: 'schedulesChanged', jobs: jobs.map((job) => scheduleViewOf(job)) })
    if (this.scheduleTimer === undefined && !this.port.isDisposed()) {
      this.scheduleTimer = setInterval(() => {
        if (!this.port.isDisposed()) {
          void this.listSchedules().catch((error: unknown) => {
            this.port.deps.log.warn(`Scheduled prompts could not be refreshed: ${describe(error)}`)
          })
        }
      }, SCHEDULE_POLL_INTERVAL_MS)
    }
    return jobs
  }

  /** A loaded session polls only its own jobs. Polls never make model calls. */
  public dispose(): void {
    if (this.scheduleTimer !== undefined) clearInterval(this.scheduleTimer)
  }

  public async listSchedules(): Promise<readonly ScheduledPrompt[]> {
    // A removed key clears the panel without waiting for storage. Check again
    // after the read so a slow poll cannot publish a previous account's jobs.
    if ((await this.port.deps.getAccountId()) === undefined) {
      return this.publishSchedules([])
    }
    const store = this.scheduleStore()
    const stored = await store.list(this.port.sessionId)
    const accountId = await this.port.deps.getAccountId()
    const jobs =
      accountId === undefined
        ? []
        : stored.filter(
            (job) =>
              job.workspaceRoot === this.port.deps.workspaceRoot && job.accountId === accountId,
          )
    return this.publishSchedules(jobs)
  }

  public async createSchedule(cadence: ScheduleCadence, prompt: string): Promise<ScheduledPrompt> {
    if (this.port.isSideChat) {
      throw new Error(UI_TEXT.sideChatPlanOnly)
    }
    const parsed = scheduleCadenceSchema.safeParse(cadence)
    const cleanPrompt = prompt.trim()
    if (
      cleanPrompt === '' ||
      cleanPrompt.length > SCHEDULE_MAX_PROMPT_CHARS ||
      !parsed.success ||
      (parsed.data.kind === 'interval' &&
        (!Number.isSafeInteger(parsed.data.everyMs) ||
          parsed.data.everyMs < SCHEDULE_MIN_INTERVAL_MS ||
          parsed.data.everyMs > SCHEDULE_MAX_INTERVAL_MS))
    ) {
      throw new Error(UI_TEXT.scheduleInvalid)
    }
    const existing = await this.listSchedules()
    if (existing.length >= SCHEDULE_MAX_JOBS_PER_SESSION) {
      throw new Error(UI_TEXT.scheduleTooMany)
    }
    const now = this.port.deps.now()
    const expiresAtMs = now + SCHEDULE_LIFETIME_MS
    const nextFireAtMs = nextScheduleFire(parsed.data, now, expiresAtMs)
    if (nextFireAtMs === undefined) {
      throw new Error(UI_TEXT.scheduleNoFire)
    }
    const job: ScheduledPrompt = {
      id: this.port.deps.newId(),
      sessionId: this.port.sessionId,
      workspaceRoot: this.port.deps.workspaceRoot,
      accountId: await this.scheduleAccountId(),
      prompt: cleanPrompt,
      cadence: parsed.data,
      createdAtMs: now,
      expiresAtMs,
      nextFireAtMs,
      fireCount: 0,
    }
    await this.scheduleStore().create(job)
    this.port.touch()
    try {
      // The schedule must not be reported as created until its owning session
      // is durable too; a crash would otherwise leave an orphaned job.
      await this.port.onPersisted()
    } catch (error: unknown) {
      await this.scheduleStore().remove(this.port.sessionId, job.id)
      throw error
    }
    await this.listSchedules()
    return job
  }

  public async cancelSchedule(id: string): Promise<boolean> {
    if (this.port.isSideChat) {
      throw new Error(UI_TEXT.sideChatPlanOnly)
    }
    const jobs = await this.listSchedules()
    const job = jobs.find((entry) => entry.id === id)
    if (job === undefined) {
      return false
    }
    const isRemoved = await this.scheduleStore().remove(this.port.sessionId, id)
    await this.listSchedules()
    if (isRemoved) {
      this.port.touch()
    }
    return isRemoved
  }

  /** A confirmed occurrence: check gate and identity again, then claim before spending. */
  public async runSchedule(
    id: string,
    occurrenceMs: number,
    confirmed: ScheduleRunConfirmation,
  ): Promise<TurnSubmission> {
    if (this.port.isSideChat) {
      throw new Error(UI_TEXT.sideChatPlanOnly)
    }
    if (confirmed.sessionId !== this.port.sessionId || confirmed.modelId !== this.port.modelId()) {
      throw new Error(UI_TEXT.scheduleConfirmationExpired)
    }
    if (!this.port.deps.isPaidFeatureOn('scheduledPrompts')) {
      throw new Error(UI_TEXT.schedulePaidOff)
    }
    if (this.port.isScheduleBusy()) {
      throw new Error(UI_TEXT.scheduleBusy)
    }
    const jobs = await this.listSchedules()
    const job = jobs.find((entry) => entry.id === id)
    if (job?.nextFireAtMs !== occurrenceMs || occurrenceMs > this.port.deps.now()) {
      throw new Error(UI_TEXT.scheduleNotDue)
    }
    if (job.prompt !== confirmed.prompt || this.port.modelId() !== confirmed.modelId) {
      throw new Error(UI_TEXT.scheduleConfirmationExpired)
    }
    if (!(await this.scheduleStore().claim(job, occurrenceMs))) {
      throw new Error(UI_TEXT.scheduleAlreadyRun)
    }
    const accountId = await this.scheduleAccountId()
    if (this.port.isDisposed() || this.port.isScheduleBusy()) {
      throw new Error(UI_TEXT.scheduleBusy)
    }
    if (!this.port.deps.isPaidFeatureOn('scheduledPrompts')) {
      throw new Error(UI_TEXT.schedulePaidOff)
    }
    if (this.port.modelId() !== confirmed.modelId || accountId !== job.accountId) {
      throw new Error(UI_TEXT.scheduleConfirmationExpired)
    }
    // The request carries only the confirmed model and a digest of the key.
    // The client checks the actual SecretStorage key just before HTTP.
    const requestFor = (turnId: string): ConfirmedModelRequest => {
      let hasStarted = false
      return {
        modelId: confirmed.modelId,
        keyDigest: job.accountId,
        isStillAllowed: () =>
          !this.port.isDisposed() &&
          this.port.modelId() === confirmed.modelId &&
          this.port.deps.isPaidFeatureOn('scheduledPrompts'),
        onRequestStarted: () => {
          if (hasStarted) {
            return
          }
          hasStarted = true
          const item: ItemSnapshot = {
            itemId: this.port.deps.newId(),
            kind: 'toolCall',
            status: COMPLETED,
            turnId,
            tool: MODEL_API_SCHEDULED_TOOL,
            args: JSON.stringify({ id: job.id, prompt: job.prompt }),
            visibleOutput: UI_TEXT.scheduleRunStarted,
            paid: 'scheduledPrompts',
          }
          this.port.recordTranscript(turnId, item)
          this.port.emit({ type: 'itemCompleted', item })
          this.port.deps.notePaidUse('scheduledPrompts', 1)
          this.port.touch()
        },
      }
    }
    // No await between this check and sendTurn: a new turn cannot slip in and
    // turn a confirmed scheduled prompt into a silently queued later run.
    const submission = await this.port.sendTurn(
      [{ type: 'text', text: job.prompt }],
      job.prompt,
      requestFor,
    )
    this.port.touch()
    try {
      await this.listSchedules()
    } catch (error: unknown) {
      // A run already admitted and started must never be reported as rejected.
      this.port.deps.log.warn(`Scheduled prompts could not be refreshed: ${describe(error)}`)
    }
    return submission
  }
}

interface VerificationContext {
  readonly getScheduledRun: () => UnattendedRun | undefined
  readonly verificationRefusal: () => { readonly value: string; readonly scope: RecordingScope }
  readonly deps: Pick<ModelApiHostDeps, 'verify' | 'isWorkspaceTrusted' | 'log' | 'newId'>
  readonly ledger: VerifyLedger
  readonly checkScope: (check: CheckCommandSetting, files: readonly EditedFile[]) => CheckScope
  readonly text: typeof MODEL_API_MODEL_TEXT
  readonly scheduleLedger: ProvenanceLedger | undefined
  readonly replay: { readonly turnId: string; readonly item: InputItem }[]
  readonly contentOrigins: Map<
    string,
    { readonly source: ContentSource; readonly scope: RecordingScope | undefined }
  >
  readonly diagnosticsHistory: Pick<DiagnosticsHistory, 'report'>
  readonly verificationAdmission: (signal: AbortSignal) => (canRunDetached?: boolean) => boolean
  readonly verificationAllowed: (files: readonly EditedFile[], wasTrusted: boolean) => boolean
  readonly canRunVerifyCommands: () => boolean
  readonly workspaceAccess: (path: string, action: 'mcp') => Promise<void>
  readonly existingFiles: (
    files: readonly EditedFile[],
    isAllowed: () => boolean,
  ) => Promise<readonly EditedFile[]>
  readonly runChecks: (
    itemId: string,
    checks: readonly CheckCommandSetting[],
    files: readonly EditedFile[],
    signal: AbortSignal,
    effects: HookEffects,
    maxChars: number,
    isAllowed: () => boolean,
  ) => Promise<readonly CheckRun[]>
  readonly refusedDiagnostics: (files: readonly EditedFile[]) => PendingReport
  readonly isDenied: (names: readonly string[]) => boolean
  readonly newEffects: () => HookEffects
  readonly emit: (event: AgentEvent) => void
  readonly recordTranscript: (turnId: string, item: ItemSnapshot) => void
  readonly rerecordTranscript: (item: ItemSnapshot) => void
  readonly appendHookEffects: (turnId: string, effects: HookEffects) => void
  readonly abortError: () => Error
  readonly isAbortError: (error: unknown) => boolean
  readonly unlessStopped: <T>(promise: Promise<T>, signal: AbortSignal) => Promise<T>
  readonly skippedCheck: typeof skippedCheck
  readonly checksSection: typeof checksSection
}
const NOTHING_TO_COMMIT = () => {
  // Diagnostics only read the live file; no staged reservation needs committing.
}

export async function verifyRound(
  context: VerificationContext,
  turn: ActiveTurn,
  isLastRound: boolean,
): Promise<string | undefined> {
  const admission = context.verificationAdmission(turn.abort.signal)
  const edited = context.ledger.takeRoundEdits()
  const wasTrusted = context.deps.isWorkspaceTrusted()
  // Filtering denied files out of lookup must not authorize checks over the revoked edit.
  const isAllowed: (canRunDetached?: boolean) => boolean = (canRunDetached) =>
    admission(canRunDetached) && context.verificationAllowed(edited, wasTrusted)
  const { verify } = context.deps
  const { signal } = turn.abort
  if (verify === undefined || isAbortRequested(signal)) {
    return undefined
  }
  if (
    (context.getScheduledRun() !== undefined || turn.scheduleRun !== undefined) &&
    edited.length > 0
  ) {
    // Language-server/check dependencies cannot be confined or inventoried
    // by the editor port. Refuse before it can disclose protected content.
    const recorded = context.verificationRefusal()
    turn.scheduleLedger?.decided(
      recorded.value,
      { kind: 'harness', operation: 'verification-refusal' },
      turn.turnId,
    )
    appendVerificationNote(context, turn.turnId, recorded.value, recorded.scope)
    return undefined
  }
  if (isLastRound || edited.length === 0) {
    // The round's runs are judged, edits or not (the Codex review of PR #54).
    if (context.ledger.judgeRound()) {
      noteFixLoopStopped(context, turn.turnId, [])
    }
    return undefined
  }
  const isDiagnosticsOn = verify.isDiagnosticsOn()
  // Restricted Mode runs no shell (D13): the checks are left out, not refused
  // one by one. A check already run on the latest state of what it covers
  // (by run_checks, or an edit's then_run of its command) is not run again.
  const selectedChecks =
    context.ledger.isStopped || !context.deps.isWorkspaceTrusted()
      ? []
      : verify
          .checkCommands()
          .filter(
            (check) =>
              !context.ledger.isRejected(check.name) &&
              !context.ledger.hasCurrentRun(check.name, context.checkScope(check, edited)),
          )
  const canRunChecks = context.canRunVerifyCommands()
  const checks = canRunChecks ? selectedChecks : []
  const refusedChecks = canRunChecks
    ? []
    : selectedChecks.map((check) =>
        context.skippedCheck(check, 'refused', context.text.agentToolNotOffered),
      )
  if (!isDiagnosticsOn && selectedChecks.length === 0) {
    if (context.ledger.judgeRound()) {
      noteFixLoopStopped(context, turn.turnId, [])
    }
    return undefined
  }
  for (const file of edited) await context.workspaceAccess(file.absolute, 'mcp')
  const paths = edited.map((file) => file.relative)
  const parts = (isDiagnosticsOn ? 1 : 0) + selectedChecks.length
  const share = Math.floor(VERIFY_NOTE_MAX_CHARS / Math.max(parts, 1))
  const started: ItemSnapshot = {
    itemId: context.deps.newId(),
    kind: 'toolCall',
    status: IN_PROGRESS,
    turnId: turn.turnId,
    tool: VERIFY_TOOLS.verifyEdits,
    args: JSON.stringify({ paths }),
  }
  context.recordTranscript(turn.turnId, started)
  context.emit({ type: 'itemStarted', item: started })
  const effects = context.newEffects()
  let pending: PendingReport | undefined
  let runs: readonly CheckRun[]
  try {
    pending = isDiagnosticsOn
      ? await editDiagnostics(context, verify, edited, signal, share, isAllowed)
      : undefined
    // Looked up after the language servers' wait, so a file gone by now is not passed.
    const existing =
      checks.length === 0 || !isAllowed() ? [] : await context.existingFiles(edited, isAllowed)
    runs = isAllowed()
      ? [
          ...refusedChecks,
          ...(await context.runChecks(
            started.itemId,
            checks,
            existing,
            signal,
            effects,
            share,
            isAllowed,
          )),
        ]
      : selectedChecks.map((check) =>
          context.skippedCheck(check, 'refused', context.text.verifyAccessRefused),
        )
    if (isAbortRequested(signal)) {
      throw context.abortError()
    }
    if (!isAllowed()) {
      pending = context.refusedDiagnostics(edited)
      runs = runs.map((run) => ({
        summary: {
          name: run.summary.name,
          outcome: run.summary.outcome,
          ...(run.summary.skip !== undefined && { skip: run.summary.skip }),
        },
        text: context.text.verifyAccessRefused,
      }))
    }
  } catch (error: unknown) {
    const isStopped = context.isAbortError(error) || isAbortRequested(signal)
    const ended: ItemSnapshot = {
      ...started,
      status: isStopped ? CANCELLED : FAILED,
      ...(!isStopped && { failureReason: describe(error) }),
    }
    context.emit({ type: 'itemCompleted', item: ended })
    context.rerecordTranscript(ended)
    throw isStopped ? context.abortError() : error
  }
  const report = pending?.report
  const sections = [
    ...(report === undefined ? [] : [report.text]),
    ...(runs.length === 0 ? [] : [context.checksSection(runs)]),
  ]
  const completed: ItemSnapshot = {
    ...started,
    status: COMPLETED,
    visibleOutput: sections.join('\n\n'),
    verifySummary: {
      files: paths,
      ...(report?.errors !== undefined && { errors: report.errors }),
      ...(report?.warnings !== undefined && { warnings: report.warnings }),
      ...(report?.unchecked !== undefined && { unchecked: report.unchecked }),
      checks: runs.map((run) => run.summary),
    },
  }
  context.emit({ type: 'itemCompleted', item: completed })
  context.rerecordTranscript(completed)
  if (context.ledger.judgeRound()) {
    noteFixLoopStopped(context, turn.turnId, sections)
  } else {
    appendVerificationNote(
      context,
      turn.turnId,
      [context.text.verifyLead, ...sections].join('\n\n'),
      undefined,
    )
  }
  // The model has the reads now: they become the baseline of the next check.
  pending?.commit()
  context.appendHookEffects(turn.turnId, effects)
  return effects.stopReason
}

/** The verify note with the fix loop's stop at its end, and the panel's notice (M68). */
function noteFixLoopStopped(
  context: VerificationContext,
  turnId: string,
  sections: readonly string[],
): void {
  const stopped = fill(context.text.checksStopped, {
    count: String(CHECK_FIX_MAX_ROUNDS),
  })
  appendVerificationNote(
    context,
    turnId,
    [context.text.verifyLead, ...sections, stopped].join('\n\n'),
    undefined,
  )
  context.emit({
    type: 'backendNotice',
    level: 'warning',
    text: plural(UI_TEXT.checksStoppedNotice, CHECK_FIX_MAX_ROUNDS),
  })
}

function appendVerificationNote(
  context: VerificationContext,
  turnId: string,
  text: string,
  scope?: RecordingScope,
): void {
  const entry: { readonly turnId: string; readonly item: InputItem } = {
    turnId,
    item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
  }
  context.scheduleLedger?.derive(JSON.stringify(entry.item), scope, 'verification-note')
  context.contentOrigins.set(contentHash(JSON.stringify(entry.item)), {
    source: { kind: 'harness', operation: 'verification-note' },
    scope,
  })
  context.replay.push(entry)
}

/**
 * The edited files' diagnostics, compared with their previous check (M68).
 * At most VERIFY_SHOWN_FILES_MAX files are shown and read, none once the
 * conversation wrote a file the editor's tools run as code (the M68
 * review); the others are "not checked" with the reason. Diagnostics that
 * cannot be read at all are said so, to the model and the log, rather than
 * reported clean.
 */
async function editDiagnostics(
  context: VerificationContext,
  verify: VerifyHooks,
  edited: readonly EditedFile[],
  signal: AbortSignal,
  maxChars: number,
  isAllowed: () => boolean,
): Promise<PendingReport> {
  const canReadFile = (file: EditedFile) =>
    isAllowed() && !context.isDenied([file.relative, file.absolute])
  if (edited.some((file) => !canReadFile(file))) return context.refusedDiagnostics(edited)
  const { codeFile } = context.ledger
  const shown = codeFile === undefined ? edited.slice(0, VERIFY_SHOWN_FILES_MAX) : []
  const skipped: FileDiagnostics[] = edited.slice(shown.length).map((file) => ({
    file,
    entries: [],
    unchecked: codeFile === undefined ? 'tooMany' : 'codeLoading',
  }))
  let read: readonly FileDiagnostics[] = []
  if (shown.length > 0) {
    try {
      read = await context.unlessStopped(
        verify.diagnosticsAfterEdit(shown, signal, canReadFile),
        signal,
      )
    } catch (error: unknown) {
      if (context.isAbortError(error)) {
        throw error
      }
      if (edited.some((file) => !canReadFile(file))) return context.refusedDiagnostics(edited)
      context.deps.log.warn(`Verify: the diagnostics could not be read: ${describe(error)}`)
      return {
        report: {
          text: fill(context.text.verifyDiagnosticsUnavailable, {
            reason: describe(error),
          }),
          unchecked: edited.length,
        },
        commit: NOTHING_TO_COMMIT,
      }
    }
  }
  if (edited.some((file) => !canReadFile(file))) return context.refusedDiagnostics(edited)
  return context.diagnosticsHistory.report([...read, ...skipped], {
    maxChars,
    ...(codeFile !== undefined && { codeFile }),
  })
}

export { nextScheduleFire } from './schedules'

export interface RecordedResults {
  readonly tool: Awaited<ReturnType<ModelApiSession['runRecordedTool']>>
  readonly rules: RuleFileLoad
  readonly skills: SkillsLoad
  readonly agents: AgentsLoad
  readonly memory: readonly MemoryScopeSnapshot[]
  readonly repoMap: string | undefined
}

export type RecordedOperation =
  | {
      readonly kind: 'tool'
      readonly session: ModelApiSession
      readonly args: Parameters<ModelApiSession['runRecordedTool']>
    }
  | {
      readonly kind: 'rules'
      readonly deps: RulesLoaderDeps
      readonly directory: string
    }
  | {
      readonly kind: 'skills'
      readonly deps: SkillsLoaderDeps
      readonly roots: readonly SkillRoot[]
    }
  | {
      readonly kind: 'agents'
      readonly deps: AgentsLoaderDeps
      readonly roots: readonly AgentRoot[]
    }
  | {
      readonly kind: 'memory'
      readonly store: MemoryStore
    }
  | {
      readonly kind: 'repoMap'
      readonly session: ModelApiSession
      readonly deps: CodeIntelDeps
      readonly signal: AbortSignal
    }

/** Adapter operations own ports; registered builders see only the recording reader. */
export async function loadRecordedOperation(
  operation: RecordedOperation,
  reader: RecordingScope,
): Promise<RecordedResults[keyof RecordedResults]> {
  switch (operation.kind) {
    case 'tool': {
      return await operation.session.runRecordedTool(...operation.args)
    }
    case 'rules': {
      const { loadRuleFile } = await import('../../context/rules.js')
      return await loadRuleFile(
        { ...operation.deps, io: reader.context(operation.deps.io) },
        operation.directory,
      )
    }
    case 'skills': {
      const { loadSkills } = await import('../../context/skills.js')
      return await loadSkills(
        { ...operation.deps, io: reader.context(operation.deps.io) },
        operation.roots,
      )
    }
    case 'agents': {
      const { loadAgents } = await import('../../context/customAgents.js')
      return await loadAgents(
        { ...operation.deps, io: reader.context(operation.deps.io) },
        operation.roots,
      )
    }
    case 'memory': {
      return await operation.store.snapshot()
    }
    case 'repoMap': {
      return await operation.session.readRecordedRepoMap(reader, operation.deps, operation.signal)
    }
  }
}
