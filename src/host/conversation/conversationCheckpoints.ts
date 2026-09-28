// One conversation's side of turn checkpoints (M72, PLAN.md D51): which of
// its turns have a checkpoint, the capture before each turn and at its end,
// "Restore files" with its confirmation and result, and Redo. The
// controller tells it what the conversation does; it tells the panel.
//
// A turn gets the capture taken just before the message that starts it was
// sent (so the turn's first edit cannot land before it). A turn no message
// of this panel started (a queued message, a scheduled run) is captured
// when it starts, which the backend does not wait for.

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

export interface ConversationCheckpointDeps {
  readonly port: CheckpointPort
  readonly post: (message: HostToWebviewMessage) => void
  /** A transcript notice; `redoRestoreId` puts a Redo button on it. */
  readonly notice: (level: NoticeLevel, text: string, redoRestoreId?: string) => void
  /** The one modal before a file restore (and a code rewind): true to go ahead. */
  readonly confirm: (title: string, detail: string, action: string) => Promise<boolean>
  /** Files open with unsaved changes, absolute. */
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

/** Names, the first few spelled out and the rest counted. */
function namedList(paths: readonly string[]): string {
  const shown = paths.slice(0, CHECKPOINT_NAMED_FILES_MAX).join(LIST_SEPARATOR)
  const more = paths.length - CHECKPOINT_NAMED_FILES_MAX
  return more > 0 ? `${shown} (+${String(more)})` : shown
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

function failureText(reason: RestoreFailure): string {
  const texts: Readonly<Record<RestoreFailure, string>> = {
    noCheckpoint: UI_TEXT.restoreNoCheckpoint,
    turnRunning: UI_TEXT.restoreTurnRunning,
    captureFailed: UI_TEXT.restoreFailed,
    redoGone: UI_TEXT.redoGone,
  }
  return texts[reason]
}

function captureRefusalText(reason: CaptureRefusal): string {
  const texts: Readonly<Record<CaptureRefusal, () => string>> = {
    tooManyFiles: () => fill(UI_TEXT.checkpointTooManyFiles, { count: CHECKPOINT_MAX_FILES }),
    tooLarge: () =>
      fill(UI_TEXT.checkpointTooLarge, { size: CHECKPOINT_CAPTURE_MAX_BYTES / BYTES_PER_MIB }),
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

  /**
   * Ends every turn still recorded as running: the conversation left this
   * panel, or the panel closed, so no end would come for them here.
   */
  private endAll(): void {
    for (const [turnId, { sessionId, recording }] of this.recordings) {
      void this.endAfterRecording(sessionId, turnId, recording)
    }
    this.recordings.clear()
  }

  private async record(sessionId: string, turnId: string, snapshot: Snapshot): Promise<void> {
    try {
      await this.deps.port.record(sessionId, turnId, snapshot)
      this.noteLeftOut(snapshot.coverage)
    } catch (error: unknown) {
      this.turns.delete(turnId)
      this.deps.log.warn(`Checkpoint of turn ${turnId} was not recorded: ${errorDetail(error)}`)
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

  /** The notices for a restore's or a redo's outcome; true when it ran. */
  private report(outcome: RestoreOutcome, done: PluralForms): boolean {
    if (!outcome.ok) {
      const level = outcome.reason === 'captureFailed' ? 'error' : 'warning'
      this.deps.notice(level, failureText(outcome.reason))
      if (outcome.detail !== undefined) {
        this.deps.log.warn(`Restore failed: ${outcome.detail}`)
      }
      return false
    }
    const count = outcome.changed.length
    if (count > 0) {
      this.deps.notice('info', plural(done, count), outcome.restoreId)
    } else if (outcome.refused.length === 0) {
      this.deps.notice('info', UI_TEXT.restoreNothing)
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
    return true
  }

  /** The conversation shown changed: its checkpoints are read and the panel told. */
  public async sessionChanged(sessionId: string | undefined): Promise<void> {
    if (sessionId === this.sessionId) {
      return
    }
    this.endAll()
    this.sessionId = sessionId
    this.turns.clear()
    this.pending.length = 0
    this.leftOutKey = ''
    this.refusalsSaid.clear()
    this.generation += 1
    await this.refresh()
  }

  /** Whether checkpoints run changed, or the panel reloaded: read and tell again. */
  public async refresh(): Promise<void> {
    const { sessionId, generation } = this
    this.postState()
    if (sessionId === undefined) {
      return
    }
    try {
      const turns = await this.deps.port.turns(sessionId)
      if (generation !== this.generation) {
        return
      }
      for (const turnId of turns) {
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
   * Tells the panel whether checkpoints run and which turns have one, when
   * that changed since it was last told.
   */
  public postState(): void {
    const availability = this.deps.port.availability()
    const turnIds = [...this.turns]
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
    if (snapshot === undefined || this.sessionId !== sessionId) {
      return undefined
    }
    const capture = { sessionId, snapshot }
    this.pending.push(capture)
    return capture
  }

  /** The message was not sent: its capture belongs to no turn. */
  public dropPending(capture: PendingCapture | undefined): void {
    const index = capture === undefined ? -1 : this.pending.indexOf(capture)
    if (index >= 0) {
      this.pending.splice(index, 1)
    }
  }

  /**
   * The message was accepted: a turn it started takes its capture (unless
   * the turn's start took it already); a queued or steered one does not.
   */
  public accepted(capture: PendingCapture | undefined, turnId: string, isNewTurn: boolean): void {
    const index = capture === undefined ? -1 : this.pending.indexOf(capture)
    if (capture === undefined || index < 0) {
      return
    }
    this.pending.splice(index, 1)
    if (isNewTurn && capture.sessionId === this.sessionId && !this.turns.has(turnId)) {
      this.bind(capture.sessionId, turnId, capture.snapshot)
    }
  }

  /** A turn started: the oldest capture waiting, or one taken now for a turn no message here started. */
  public turnStarted(sessionId: string, turnId: string): void {
    if (this.sessionId !== sessionId || this.turns.has(turnId)) {
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
      return
    }
    this.recordings.delete(turnId)
    void this.endAfterRecording(entry.sessionId, turnId, entry.recording)
  }

  /** The panel closed: its running turns are ended, its captures dropped. */
  public dispose(): void {
    this.endAll()
    this.pending.length = 0
  }

  /** "Restore files to here": confirmed, then restored; false when nothing was restored. */
  public async restoreFiles(sessionId: string, turnId: string): Promise<boolean> {
    const isConfirmed = await this.deps.confirm(
      UI_TEXT.restoreConfirmTitle,
      UI_TEXT.restoreConfirmDetail,
      UI_TEXT.restoreConfirmAction,
    )
    if (!isConfirmed) {
      return false
    }
    try {
      const outcome = await this.deps.port.restore({
        sessionId,
        turnId,
        unsavedPaths: this.deps.unsavedPaths(),
      })
      return this.report(outcome, UI_TEXT.restoreDone)
    } catch (error: unknown) {
      this.deps.notice('error', `${UI_TEXT.restoreFailed}: ${errorDetail(error)}`)
      return false
    }
  }

  /** A restore's Redo: what it replaced goes back. */
  public async redo(restoreId: string): Promise<void> {
    const { sessionId } = this
    if (sessionId === undefined) {
      this.deps.notice('info', UI_TEXT.redoGone)
      return
    }
    try {
      const outcome = await this.deps.port.redo({
        sessionId,
        restoreId,
        unsavedPaths: this.deps.unsavedPaths(),
      })
      this.report(outcome, UI_TEXT.redoDone)
    } catch (error: unknown) {
      this.deps.notice('error', `${UI_TEXT.restoreFailed}: ${errorDetail(error)}`)
    }
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
    if (sessionId !== this.sessionId) {
      return
    }
    this.turns.clear()
    this.postState()
  }
}
