// One conversation's side of turn checkpoints (M72, PLAN.md D51): which of
// its turns have a checkpoint, the capture before each turn and at its end,
// "Restore files" with its confirmation and report, and Redo. The
// controller tells it what the conversation does; it tells the panel.
//
// A turn gets the capture taken just before the message that starts it was
// sent (so the turn's first edit cannot land before it); captures waiting
// for their turns go to them oldest first. A turn no message of this panel
// started (a queued message, a scheduled run) is captured when it starts,
// which the backend does not wait for. A capture no turn takes is let go.

import type { Coverage, RefusalReason } from '../../core/checkpoints/restorePlan'
import {
  BYTES_PER_MIB,
  CHECKPOINT_CAPTURE_MAX_BYTES,
  CHECKPOINT_INITIAL_AVAILABILITY,
  CHECKPOINT_MAX_FILES,
  CHECKPOINT_NAMED_FILES_MAX,
  type CheckpointAvailability,
  UI_TEXT,
} from '../../shared/constants'
import type { PluralForms } from '../../shared/l10n/forms'
import { fill, plural } from '../../shared/l10n/text'
import type { HostToWebviewMessage } from '../../shared/protocol'
import type { CheckpointPort } from '../checkpoints/checkpointHost'
import type {
  CaptureRefusal,
  RestoreFailure,
  RestoreOutcome,
  Snapshot,
} from '../checkpoints/checkpointStore'
import { errorDetail, type Logger } from '../logger'

export type NoticeLevel = 'info' | 'warning' | 'error'

/** The capture before a message was sent, until the turn it starts takes it. */
export interface PendingCapture {
  readonly sessionId: string
  readonly snapshot: Snapshot
}

/**
 * A restore's result: whether it ran, whether every file it meant to
 * change was changed (so "Rewind conversation and restore files" may go
 * on), and its notices, posted when the caller says (after a fork, so the
 * new transcript shows them).
 */
export interface RestoreReport {
  readonly isRestored: boolean
  readonly isComplete: boolean
  readonly post: () => void
}

export interface ConversationCheckpointDeps {
  readonly port: CheckpointPort
  readonly post: (message: HostToWebviewMessage) => void
  /** A transcript notice; `redoRestoreId` puts a Redo button on it. */
  readonly notice: (level: NoticeLevel, text: string, redoRestoreId?: string) => void
  /** The one modal before a file restore (and a code rewind): true to go ahead. */
  readonly confirm: (title: string, detail: string, action: string) => Promise<boolean>
  /** Files (and notebooks) open with unsaved changes, absolute. */
  readonly unsavedPaths: () => readonly string[]
  readonly log: Logger
}

const LIST_SEPARATOR = ', '
const REFUSAL_ORDER: readonly RefusalReason[] = [
  'unsaved',
  'changedAfter',
  'noEarlierCopy',
  'notInCheckpoint',
  'failed',
]
// Refusals that leave the files short of the checkpoint for a reason the
// user can act on; the others (no copy kept, never in a checkpoint) cannot
// be undone by trying again.
const INCOMPLETE_REASONS: ReadonlySet<RefusalReason> = new Set([
  'unsaved',
  'changedAfter',
  'failed',
])

/** Names, the first few spelled out and the rest counted. */
function namedList(paths: readonly string[]): string {
  const shown = paths.slice(0, CHECKPOINT_NAMED_FILES_MAX).join(LIST_SEPARATOR)
  const more = paths.length - CHECKPOINT_NAMED_FILES_MAX
  return more > 0 ? fill(UI_TEXT.namedFilesMore, { files: shown, count: more }) : shown
}

// Built when used, never at module load: the display language's table is
// installed at activation, after this loads.
function refusalTemplate(reason: RefusalReason): string {
  const templates: Readonly<Record<RefusalReason, string>> = {
    unsaved: UI_TEXT.restoreRefusedUnsaved,
    changedAfter: UI_TEXT.restoreRefusedChanged,
    notInCheckpoint: UI_TEXT.restoreRefusedNotCovered,
    noEarlierCopy: UI_TEXT.restoreRefusedNoCopy,
    failed: UI_TEXT.restoreRefusedFailed,
  }
  return templates[reason]
}

/** Why checkpoints are not available here, as the menu says it. */
function availabilityText(availability: CheckpointAvailability): string {
  const texts: Readonly<Record<CheckpointAvailability, string>> = {
    on: UI_TEXT.restoreNoCheckpoint,
    restricted: UI_TEXT.checkpointsRestricted,
    off: UI_TEXT.checkpointsOff,
    noGit: UI_TEXT.checkpointsNoGit,
    noFolder: UI_TEXT.restoreNoCheckpoint,
  }
  return texts[availability]
}

function captureRefusalText(reason: CaptureRefusal): string {
  const texts: Readonly<Record<CaptureRefusal, () => string>> = {
    tooManyFiles: () => fill(UI_TEXT.checkpointTooManyFiles, { count: CHECKPOINT_MAX_FILES }),
    tooLarge: () =>
      fill(UI_TEXT.checkpointTooLarge, { size: CHECKPOINT_CAPTURE_MAX_BYTES / BYTES_PER_MIB }),
    noGit: () => UI_TEXT.checkpointNoGit,
    failed: () => UI_TEXT.checkpointFailed,
  }
  return texts[reason]()
}

/**
 * What the panel knows of checkpoints, as one comparable value. A
 * conversation with no checkpoint reads the same whichever it is.
 */
function stateKey(
  availability: CheckpointAvailability,
  sessionId: string | undefined,
  turnIds: readonly string[],
): string {
  return JSON.stringify([availability, turnIds.length === 0 ? '' : (sessionId ?? ''), turnIds])
}

export class ConversationCheckpoints {
  private sessionId: string | undefined
  /** Turns of this conversation with a checkpoint, recorded or being recorded. */
  private readonly turns = new Set<string>()
  /** Each turn's recording, which its end waits for, with its conversation. */
  private readonly recordings = new Map<
    string,
    { readonly sessionId: string; readonly recording: Promise<void> }
  >()
  /** Turns ending (their end captures), which a restore waits for. */
  private readonly endings = new Set<Promise<void>>()
  /** This panel's turns the store counts as running, by turn, with their conversation. */
  private readonly running = new Map<string, string>()
  /** The captures before messages sent, oldest first: the next turn to start takes the first. */
  private readonly pending: PendingCapture[] = []
  private leftOutKey = ''
  private readonly refusalsSaid = new Set<CaptureRefusal>()
  private generation = 0
  /** What the panel was last told; at first, what it starts with. */
  private postedKey = stateKey(CHECKPOINT_INITIAL_AVAILABILITY, undefined, [])

  public constructor(private readonly deps: ConversationCheckpointDeps) {}

  private bind(sessionId: string, turnId: string, snapshot: Snapshot): void {
    this.turns.add(turnId)
    this.recordings.set(turnId, { sessionId, recording: this.record(sessionId, turnId, snapshot) })
  }

  private markRunning(sessionId: string, turnId: string): void {
    this.running.set(turnId, sessionId)
    this.deps.port.markTurn(sessionId, turnId, true)
  }

  private markEnded(turnId: string): void {
    const sessionId = this.running.get(turnId)
    if (sessionId === undefined) {
      return
    }
    this.running.delete(turnId)
    this.deps.port.markTurn(sessionId, turnId, false)
  }

  /** Lets go of a capture no turn will take (its pin in the shadow repository). */
  private release(capture: PendingCapture): void {
    void this.deps.port.release(capture.snapshot).catch((error: unknown) => {
      this.deps.log.warn(`A checkpoint capture was not let go: ${errorDetail(error)}`)
    })
  }

  /**
   * Ends every turn still recorded as running: the conversation left this
   * panel, or the panel closed, so no end would come for them here.
   */
  private endAll(): void {
    for (const [turnId, entry] of this.recordings) {
      this.end(entry.sessionId, turnId, entry.recording)
    }
    this.recordings.clear()
    for (const turnId of this.running.keys()) {
      this.markEnded(turnId)
    }
    for (const capture of this.pending.splice(0)) {
      this.release(capture)
    }
  }

  private end(sessionId: string, turnId: string, recording: Promise<void>): void {
    this.markEnded(turnId)
    const ending = this.endAfterRecording(sessionId, turnId, recording)
    this.endings.add(ending)
    void ending.finally(() => {
      this.endings.delete(ending)
    })
  }

  private async record(sessionId: string, turnId: string, snapshot: Snapshot): Promise<void> {
    try {
      await this.deps.port.record(sessionId, turnId, snapshot)
      this.noteLeftOut(snapshot.coverage)
    } catch (error: unknown) {
      this.turns.delete(turnId)
      this.deps.log.warn(`Checkpoint of turn ${turnId} was not recorded: ${errorDetail(error)}`)
      this.sayRefusal('failed')
    }
    if (this.sessionId === sessionId) {
      this.postState()
    }
  }

  /** The capture for a turn that started without one, then its record. */
  private async captureAndRecord(sessionId: string, turnId: string): Promise<void> {
    const snapshot = await this.capture()
    if (snapshot === undefined) {
      this.turns.delete(turnId)
      return
    }
    await this.record(sessionId, turnId, snapshot)
  }

  /** Waits for a turn's recording, then records its end. */
  private async endAfterRecording(
    sessionId: string,
    turnId: string,
    recording: Promise<void>,
  ): Promise<void> {
    try {
      await recording
      await this.deps.port.endTurn(sessionId, turnId)
    } catch (error: unknown) {
      this.deps.log.warn(`Checkpoint at the end of turn ${turnId}: ${errorDetail(error)}`)
    }
  }

  private async capture(): Promise<Snapshot | undefined> {
    try {
      const result = await this.deps.port.capture()
      if (result === undefined || result.ok) {
        return result?.snapshot
      }
      this.deps.log.warn(`No checkpoint for this turn (${result.reason}): ${result.detail}`)
      this.sayRefusal(result.reason)
    } catch (error: unknown) {
      this.deps.log.warn(`No checkpoint for this turn: ${errorDetail(error)}`)
      this.sayRefusal('failed')
    }
    return undefined
  }

  /** Why a turn has no checkpoint, said once per conversation and reason. */
  private sayRefusal(reason: CaptureRefusal): void {
    if (this.refusalsSaid.has(reason)) {
      return
    }
    this.refusalsSaid.add(reason)
    this.deps.notice(
      'warning',
      fill(UI_TEXT.checkpointUnavailable, { reason: captureRefusalText(reason) }),
    )
  }

  /** The files a checkpoint left out, named once for each set (PLAN.md M72). */
  private noteLeftOut(coverage: Coverage): void {
    const names = [...coverage.skipped, ...coverage.repositories]
    const key = names.join('\n')
    if (key === this.leftOutKey) {
      return
    }
    this.leftOutKey = key
    if (names.length > 0) {
      this.deps.notice('info', fill(UI_TEXT.checkpointLeftOut, { files: namedList(names) }))
    }
  }

  /** A restore or a redo that threw: its message in the transcript, its stack in the log. */
  private sayFailed(error: unknown): void {
    this.deps.log.warn(`Restore failed: ${errorDetail(error)}`)
    const reason = error instanceof Error ? error.message : String(error)
    this.deps.notice('error', `${UI_TEXT.restoreFailed}: ${reason}`)
  }

  /** The text for a restore or a redo that did nothing. */
  private failureText(reason: RestoreFailure, outcome: RestoreOutcome): string {
    if (reason === 'unavailable') {
      return availabilityText(this.deps.port.availability())
    }
    if (reason === 'captureFailed' && !outcome.ok && outcome.captureRefusal !== undefined) {
      return `${UI_TEXT.restoreFailed}: ${captureRefusalText(outcome.captureRefusal)}`
    }
    const texts: Readonly<Record<Exclude<RestoreFailure, 'unavailable'>, string>> = {
      noCheckpoint: UI_TEXT.restoreNoCheckpoint,
      turnRunning: UI_TEXT.restoreTurnRunning,
      captureFailed: UI_TEXT.restoreFailed,
      redoGone: UI_TEXT.redoGone,
    }
    return texts[reason]
  }

  /** The notices for a restore's or a redo's outcome. */
  private notices(outcome: RestoreOutcome, done: PluralForms): () => void {
    return () => {
      if (!outcome.ok) {
        const level = outcome.reason === 'captureFailed' ? 'error' : 'warning'
        this.deps.notice(level, this.failureText(outcome.reason, outcome))
        if (outcome.detail !== undefined) {
          this.deps.log.warn(`Restore failed: ${outcome.detail}`)
        }
        return
      }
      const count = outcome.changed.length
      if (count > 0) {
        this.deps.notice('info', plural(done, count), outcome.restoreId)
      } else if (outcome.refused.length === 0) {
        this.deps.notice('info', UI_TEXT.restoreNothing)
      }
      if (outcome.unsure.length > 0) {
        this.deps.notice(
          'warning',
          fill(UI_TEXT.restoreUnsure, { files: namedList(outcome.unsure) }),
        )
      }
      for (const reason of REFUSAL_ORDER) {
        const paths = outcome.refused
          .filter((refusal) => refusal.reason === reason)
          .map((refusal) => refusal.path)
        if (paths.length > 0) {
          this.deps.notice('warning', fill(refusalTemplate(reason), { files: namedList(paths) }))
        }
      }
      if (outcome.isIgnoredIncomplete) {
        this.deps.notice('warning', UI_TEXT.restoreIgnoredIncomplete)
      }
    }
  }

  /** The conversation shown changed: its checkpoints are read and the panel told. */
  public async sessionChanged(sessionId: string | undefined): Promise<void> {
    if (sessionId === this.sessionId) {
      return
    }
    this.endAll()
    this.sessionId = sessionId
    this.turns.clear()
    this.leftOutKey = ''
    this.refusalsSaid.clear()
    this.generation += 1
    await this.refresh()
  }

  /**
   * Whether checkpoints run changed, a conversation was archived, or the
   * panel reloaded: the conversation's turns are read afresh and the panel
   * told.
   */
  public async refresh(): Promise<void> {
    const { sessionId, generation } = this
    this.postState()
    if (sessionId === undefined) {
      return
    }
    try {
      const stored = await this.deps.port.turns(sessionId)
      if (generation !== this.generation) {
        return
      }
      this.turns.clear()
      for (const turnId of [...stored, ...this.recordings.keys()]) {
        this.turns.add(turnId)
      }
      this.postState()
    } catch (error: unknown) {
      this.deps.log.warn(
        `Checkpoints of session ${sessionId} could not be read: ${errorDetail(error)}`,
      )
    }
  }

  /** The panel was (re)built: it knows nothing, so it is told what differs from that. */
  public panelReady(): void {
    this.postedKey = stateKey(CHECKPOINT_INITIAL_AVAILABILITY, undefined, [])
    this.postState()
  }

  /**
   * Tells the panel whether checkpoints run and which turns offer a restore
   * (none unless they run), when that changed since it was last told.
   */
  public postState(): void {
    const availability = this.deps.port.availability()
    const turnIds = availability === 'on' ? [...this.turns] : []
    const key = stateKey(availability, this.sessionId, turnIds)
    if (key === this.postedKey) {
      return
    }
    this.postedKey = key
    this.deps.post({
      type: 'checkpointState',
      availability,
      ...(this.sessionId !== undefined && { sessionId: this.sessionId }),
      turnIds,
    })
  }

  /** Before a message that may start a turn: the capture its checkpoint will hold. */
  public async beforeTurn(sessionId: string): Promise<PendingCapture | undefined> {
    const snapshot = await this.capture()
    if (snapshot === undefined) {
      return undefined
    }
    const capture = { sessionId, snapshot }
    if (this.sessionId !== sessionId) {
      this.release(capture)
      return undefined
    }
    this.pending.push(capture)
    return capture
  }

  /** The message was not sent: its capture belongs to no turn. */
  public dropPending(capture: PendingCapture | undefined): void {
    const index = capture === undefined ? -1 : this.pending.indexOf(capture)
    if (capture === undefined || index === -1) {
      return
    }
    this.pending.splice(index, 1)
    this.release(capture)
  }

  /**
   * The message was accepted: a turn it started takes its capture (unless
   * the turn's start took one already); a queued or steered one does not.
   */
  public accepted(capture: PendingCapture | undefined, turnId: string, isNewTurn: boolean): void {
    const index = capture === undefined ? -1 : this.pending.indexOf(capture)
    if (capture === undefined || index === -1) {
      return
    }
    this.pending.splice(index, 1)
    if (isNewTurn && capture.sessionId === this.sessionId && !this.turns.has(turnId)) {
      this.markRunning(capture.sessionId, turnId)
      this.bind(capture.sessionId, turnId, capture.snapshot)
      return
    }
    this.release(capture)
  }

  /** A turn started: the oldest capture waiting, or one taken now for a turn no message here started. */
  public turnStarted(sessionId: string, turnId: string): void {
    if (this.sessionId !== sessionId) {
      return
    }
    this.markRunning(sessionId, turnId)
    if (this.turns.has(turnId)) {
      return
    }
    const capture = this.pending.shift()
    if (capture !== undefined) {
      this.bind(sessionId, turnId, capture.snapshot)
      return
    }
    this.turns.add(turnId)
    this.recordings.set(turnId, {
      sessionId,
      recording: this.captureAndRecord(sessionId, turnId),
    })
  }

  /** A turn ended (or was ended here, D25): its end capture, once its start is recorded. */
  public turnCompleted(turnId: string): void {
    const entry = this.recordings.get(turnId)
    if (entry === undefined) {
      this.markEnded(turnId)
      return
    }
    this.recordings.delete(turnId)
    this.end(entry.sessionId, turnId, entry.recording)
  }

  /** The confirmation before "Restore files" or "Rewind conversation and restore files". */
  public async confirmRestore(isWithRewind: boolean): Promise<boolean> {
    return isWithRewind
      ? await this.deps.confirm(
          UI_TEXT.restoreBothConfirmTitle,
          UI_TEXT.restoreBothConfirmDetail,
          UI_TEXT.restoreBothConfirmAction,
        )
      : await this.deps.confirm(
          UI_TEXT.restoreConfirmTitle,
          UI_TEXT.restoreConfirmDetail,
          UI_TEXT.restoreConfirmAction,
        )
  }

  /** Restores the files (confirmed already); its notices wait for `post`. */
  public async restore(sessionId: string, turnId: string): Promise<RestoreReport> {
    try {
      await Promise.all(this.endings)
      const outcome = await this.deps.port.restore({
        sessionId,
        turnId,
        unsavedPaths: this.deps.unsavedPaths,
      })
      return {
        isRestored: outcome.ok,
        isComplete:
          outcome.ok && outcome.refused.every((refusal) => !INCOMPLETE_REASONS.has(refusal.reason)),
        post: this.notices(outcome, UI_TEXT.restoreDone),
      }
    } catch (error: unknown) {
      return {
        isRestored: false,
        isComplete: false,
        post: () => {
          this.sayFailed(error)
        },
      }
    }
  }

  /**
   * A restore's Redo: what it replaced goes back, and the panel learns
   * whether its button is spent (a redo that could not do everything keeps
   * it for another try).
   */
  public async redo(restoreId: string): Promise<void> {
    let isSpent = false
    try {
      await Promise.all(this.endings)
      const outcome = await this.deps.port.redo({
        restoreId,
        unsavedPaths: this.deps.unsavedPaths,
      })
      isSpent = outcome.ok ? outcome.isRedoSpent : outcome.reason === 'redoGone'
      this.notices(outcome, UI_TEXT.redoDone)()
    } catch (error: unknown) {
      this.sayFailed(error)
    }
    this.deps.post({ type: 'restoreRedone', restoreId, isSpent })
  }

  /** The conversation was archived: its checkpoints go. */
  public async forget(sessionId: string): Promise<void> {
    try {
      await this.deps.port.forgetSession(sessionId)
    } catch (error: unknown) {
      this.deps.log.warn(
        `Checkpoints of session ${sessionId} were not removed: ${errorDetail(error)}`,
      )
    }
    if (sessionId === this.sessionId) {
      await this.refresh()
    }
  }

  /** The panel closed: its running turns are ended, its captures let go. */
  public dispose(): void {
    this.endAll()
  }
}
