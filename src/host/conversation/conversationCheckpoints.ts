// One conversation's side of turn checkpoints (M72, M86; PLAN.md D51, D63):
// which of its turns offer "Restore files" (a Model API turn with a record)
// and which an earlier version recorded (listed, never restored), the
// running marks of its turns, "Restore files" with its confirmation and
// report, and Redo. The controller tells it what the conversation does; it
// tells the panel.
//
// Before a message that may start a turn is sent, it is published as running
// (the store's presence file, no lock), so another window on the folder
// refuses a restore from then on; the turn it starts takes over the mark
// until it ends. A Model API turn's own mark and record belong to the
// backend's turn lifecycle (checkpointHost.ts), which can outlive this panel.

import { randomUUID } from 'node:crypto'
import type { BackendKind } from '../../core/agent/agentBackend'
import { failureForLog } from '../../core/backends/musecode/logText'
import type { PathRefusal } from '../../core/checkpoints/toolWrites'
import { turnKey } from '../../core/checkpoints/turnKey'
import {
  CHECKPOINT_INITIAL_AVAILABILITY,
  CHECKPOINT_NAMED_FILES_MAX,
  type CheckpointAvailability,
  type CheckpointRestoreBlocker,
  UI_TEXT,
} from '../../shared/constants'
import type { PluralForms } from '../../shared/l10n/forms'
import { fill, plural } from '../../shared/l10n/text'
import type { HostToWebviewMessage } from '../../shared/protocol'
import type { CheckpointPort } from '../checkpoints/checkpointHost'
import type { RestoreFailure, RestoreOutcome } from '../checkpoints/checkpointStore'
import type { Logger } from '../logger'

export type NoticeLevel = 'info' | 'warning' | 'error'

/** A message about to start a turn: its running mark, published before it was sent. */
export interface PendingMark {
  readonly sessionId: string
  readonly marker: string
}

const PENDING_MARKER = 'pending:'

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
  /** Actual attached host kind; disconnected/unknown is never admitted. */
  readonly backend: (sessionId: string | undefined) => BackendKind | undefined
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
const REFUSAL_ORDER: readonly PathRefusal[] = [
  'unsaved',
  'changedAfter',
  'changedBetween',
  'orderUnknown',
  'linked',
  'notKept',
  'tooLarge',
  'failed',
]
/** Names, the first few spelled out and the rest counted. */
function namedList(paths: readonly string[]): string {
  const shown = paths.slice(0, CHECKPOINT_NAMED_FILES_MAX).join(LIST_SEPARATOR)
  const more = paths.length - CHECKPOINT_NAMED_FILES_MAX
  return more > 0 ? fill(UI_TEXT.namedFilesMore, { files: shown, count: more }) : shown
}

// Built when used, never at module load: the display language's table is
// installed at activation, after this loads.
function refusalTemplate(reason: PathRefusal): string {
  const templates: Readonly<Record<PathRefusal, string>> = {
    unsaved: UI_TEXT.restoreRefusedUnsaved,
    changedAfter: UI_TEXT.restoreRefusedChanged,
    changedBetween: UI_TEXT.restoreRefusedBetween,
    orderUnknown: UI_TEXT.restoreRefusedOrderUnknown,
    linked: UI_TEXT.restoreRefusedLinked,
    notKept: UI_TEXT.restoreRefusedNotKept,
    tooLarge: UI_TEXT.restoreRefusedTooLarge,
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

/**
 * What the panel knows of checkpoints, as one comparable value. A
 * conversation with no checkpoint reads the same whichever it is.
 */
function stateKey(
  availability: CheckpointAvailability,
  sessionId: string | undefined,
  turnIds: readonly string[],
  blocker?: CheckpointRestoreBlocker,
  legacyTurnIds: readonly string[] = [],
): string {
  return JSON.stringify([
    availability,
    blocker,
    turnIds.length === 0 && legacyTurnIds.length === 0 ? '' : (sessionId ?? ''),
    turnIds,
    legacyTurnIds,
  ])
}

export class ConversationCheckpoints {
  private sessionId: string | undefined
  private isCoreOwnedSession = false
  /** Turns of this conversation with a record. */
  private readonly turns = new Set<string>()
  private readonly legacyTurns = new Set<string>()
  /** This panel's turns published as running, by turn, with their conversation. */
  private readonly running = new Map<
    string,
    { readonly sessionId: string; readonly isCoreOwned: boolean }
  >()
  /** The marks of messages sent, oldest first: the next turn to start takes over the first. */
  private readonly pending: PendingMark[] = []
  private generation = 0
  /** What the panel was last told; at first, what it starts with. */
  private postedKey = stateKey(CHECKPOINT_INITIAL_AVAILABILITY, undefined, [])

  public constructor(private readonly deps: ConversationCheckpointDeps) {}

  private restoreBlocker(): CheckpointRestoreBlocker | undefined {
    if (this.deps.backend(this.sessionId) !== 'modelApi') {
      return 'modelApiOnly'
    }
    return this.deps.port.isNativeUnsafe() ? 'nativeUnsafe' : undefined
  }

  /** Publishes a running mark (or its end); a failure is logged. */
  private publish(key: string, isRunning: boolean): void {
    void this.deps.port.markTurn(key, isRunning).catch((error: unknown) => {
      this.deps.log.warn(`A running turn was not published: ${failureForLog(error)}`)
    })
  }

  private markRunning(sessionId: string, turnId: string): void {
    this.running.set(turnId, { sessionId, isCoreOwned: this.isCoreOwnedSession })
    if (!this.isCoreOwnedSession) {
      this.publish(turnKey(sessionId, turnId), true)
    }
  }

  private markEnded(turnId: string): void {
    const entry = this.running.get(turnId)
    if (entry === undefined) {
      return
    }
    this.running.delete(turnId)
    if (!entry.isCoreOwned) {
      this.publish(turnKey(entry.sessionId, turnId), false)
    }
  }

  /** Lets go of a message's mark. */
  private release(mark: PendingMark): void {
    this.publish(mark.marker, false)
  }

  /**
   * Drops this surface's state. Native turns' marks end here; a Model API
   * turn's mark belongs to the core lifecycle and can outlive this surface.
   */
  private endAll(): void {
    for (const turnId of this.running.keys()) {
      this.markEnded(turnId)
    }
    for (const mark of this.pending.splice(0)) {
      this.release(mark)
    }
  }

  /** A restore or a Redo that threw: its message in the transcript, its stack in the log. */
  private sayFailed(error: unknown): void {
    this.deps.log.warn(`Restore failed: ${failureForLog(error)}`)
    this.deps.notice('error', UI_TEXT.restoreFailed)
  }

  /** The text for a restore or a Redo that did nothing. */
  private failureText(reason: RestoreFailure): string {
    if (reason === 'unavailable') {
      return availabilityText(this.deps.port.availability())
    }
    const texts: Readonly<Record<Exclude<RestoreFailure, 'unavailable'>, string>> = {
      noCheckpoint: UI_TEXT.restoreNoCheckpoint,
      turnRunning: UI_TEXT.restoreTurnRunning,
      turnElsewhere: UI_TEXT.restoreTurnElsewhere,
      redoGone: UI_TEXT.redoGone,
      backendUnsupported: UI_TEXT.checkpointsModelApiOnly,
      nativeUnsafe: UI_TEXT.checkpointsNativeUnsafe,
      writesIncomplete: UI_TEXT.restoreWritesIncomplete,
      legacyInRange: UI_TEXT.restoreLegacyInRange,
      legacyWindowOpen: UI_TEXT.restoreLegacyWindowOpen,
    }
    return texts[reason]
  }

  /**
   * The notices for a restore's or a Redo's outcome: what changed (with its
   * Redo), what was already as before, each refusal, and, when commands,
   * hooks or MCP tools ran in the turns, that what they changed was not
   * undone. That note never stops a rewind; a refusal does.
   */
  private notices(outcome: RestoreOutcome, done: PluralForms): () => void {
    return () => {
      if (!outcome.ok) {
        this.deps.notice('warning', this.failureText(outcome.reason))
        return
      }
      const count = outcome.changed.length
      const isActed = count > 0 || outcome.refused.length > 0
      if (count > 0) {
        this.deps.notice('info', plural(done, count), outcome.restoreId)
      } else if (outcome.refused.length === 0) {
        this.deps.notice('info', UI_TEXT.restoreNothing)
      }
      if (isActed && outcome.unchanged.length > 0) {
        this.deps.notice('info', plural(UI_TEXT.restoreUnchanged, outcome.unchanged.length))
      }
      for (const reason of REFUSAL_ORDER) {
        const paths = outcome.refused
          .filter((refusal) => refusal.reason === reason)
          .map((refusal) => refusal.path)
        if (paths.length > 0) {
          this.deps.notice('warning', fill(refusalTemplate(reason), { files: namedList(paths) }))
        }
      }
      if (outcome.ranProcesses) {
        this.deps.notice('warning', UI_TEXT.restoreCommandsNote)
      }
    }
  }

  /** The conversation shown changed: its turns are read and the panel told. */
  public async sessionChanged(sessionId: string | undefined): Promise<void> {
    const isCoreOwned = this.deps.backend(sessionId) === 'modelApi'
    if (sessionId === this.sessionId && isCoreOwned === this.isCoreOwnedSession) {
      return
    }
    this.endAll()
    this.sessionId = sessionId
    this.isCoreOwnedSession = isCoreOwned
    this.turns.clear()
    this.legacyTurns.clear()
    this.generation += 1
    await this.refresh()
  }

  /**
   * Whether checkpoints run changed, a conversation was archived, a turn
   * ended, or the panel reloaded: the conversation's turns are read afresh
   * and the panel told.
   */
  public async refresh(): Promise<void> {
    const { sessionId, generation } = this
    this.postState()
    if (sessionId === undefined) {
      return
    }
    try {
      const stored = await this.deps.port.turns(sessionId)
      const legacy = await this.deps.port.legacyTurns(sessionId)
      if (generation !== this.generation) {
        return
      }
      this.turns.clear()
      this.legacyTurns.clear()
      for (const turnId of legacy) {
        this.legacyTurns.add(turnId)
      }
      for (const turnId of stored) {
        this.turns.add(turnId)
      }
      this.postState()
    } catch (error: unknown) {
      this.deps.log.warn(
        `Checkpoints of session ${sessionId} could not be read: ${failureForLog(error)}`,
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
    const restoreBlocker = this.restoreBlocker()
    const canRestore =
      restoreBlocker === undefined && (availability === 'on' || availability === 'off')
    const turnIds = canRestore && availability === 'on' ? [...this.turns] : []
    const legacyTurnIds = [...this.legacyTurns].filter((turnId) => !this.turns.has(turnId))
    const key = stateKey(availability, this.sessionId, turnIds, restoreBlocker, legacyTurnIds)
    if (key === this.postedKey) {
      return
    }
    this.postedKey = key
    this.deps.post({
      type: 'checkpointState',
      availability,
      canRestore,
      legacyTurnIds,
      ...(restoreBlocker !== undefined && { restoreBlocker }),
      ...(this.sessionId !== undefined && { sessionId: this.sessionId }),
      turnIds,
    })
  }

  /**
   * Before a message that may start a turn: the message is published as
   * running, awaited, so no edit of its turn can come first. When the mark
   * cannot be published, this throws and the message is not sent.
   */
  public async beforeTurn(sessionId: string): Promise<PendingMark | undefined> {
    const marker = `${PENDING_MARKER}${randomUUID()}`
    try {
      await this.deps.port.markTurn(marker, true)
    } catch (error: unknown) {
      // Another window could not be told: the message is not sent, so no
      // restore there can land on what its turn edits.
      this.deps.log.warn(`A running turn was not published: ${failureForLog(error)}`)
      this.publish(marker, false)
      throw new Error(UI_TEXT.sendMarkFailed, { cause: error })
    }
    const mark = { sessionId, marker }
    if (this.sessionId !== sessionId) {
      this.release(mark)
      return undefined
    }
    this.pending.push(mark)
    return mark
  }

  /** The message was not sent: its mark goes. */
  public dropPending(mark: PendingMark | undefined): void {
    const index = mark === undefined ? -1 : this.pending.indexOf(mark)
    if (mark === undefined || index === -1) {
      return
    }
    this.pending.splice(index, 1)
    this.release(mark)
  }

  /**
   * The message was accepted: a turn it started is running (its own mark
   * from now on); a queued or steered one is not. The message's mark goes.
   */
  public accepted(mark: PendingMark | undefined, turnId: string, isNewTurn: boolean): void {
    const index = mark === undefined ? -1 : this.pending.indexOf(mark)
    if (mark === undefined || index === -1) {
      return
    }
    this.pending.splice(index, 1)
    if (isNewTurn && mark.sessionId === this.sessionId) {
      this.markRunning(mark.sessionId, turnId)
    }
    this.release(mark)
  }

  /** A turn started: it takes over the oldest message's mark waiting. */
  public turnStarted(sessionId: string, turnId: string): void {
    if (this.sessionId !== sessionId) {
      return
    }
    this.markRunning(sessionId, turnId)
    const mark = this.pending.shift()
    if (mark !== undefined) {
      this.release(mark)
    }
  }

  /** A turn ended (or was ended here, D25): its mark goes, and a Model API turn's record is read. */
  public turnCompleted(turnId: string): void {
    this.markEnded(turnId)
    if (this.isCoreOwnedSession) {
      void this.refresh()
    }
  }

  /** The confirmation before "Restore files" or "Rewind conversation and restore files". */
  public async confirmRestore(isWithRewind: boolean): Promise<boolean> {
    const blocker = this.restoreBlocker()
    if (blocker !== undefined) {
      this.deps.notice(
        'warning',
        blocker === 'modelApiOnly'
          ? UI_TEXT.checkpointsModelApiOnly
          : UI_TEXT.checkpointsNativeUnsafe,
      )
      return false
    }
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

  /**
   * Restores the files (confirmed already) from `turnId` on; the transcript's
   * turn ids from it on, child sessions' included, must each have a record.
   * Its notices wait for `post`.
   */
  public async restore(
    sessionId: string,
    turnId: string,
    transcriptTurnIds: readonly string[],
  ): Promise<RestoreReport> {
    try {
      const outcome = await this.deps.port.restore({
        backend: () => this.deps.backend(sessionId),
        sessionId,
        turnId,
        transcriptTurnIds,
        unsavedPaths: this.deps.unsavedPaths,
      })
      return {
        isRestored: outcome.ok,
        // Any file left as it is makes the restore incomplete, as the
        // confirmation says. Commands having run does not.
        isComplete: outcome.ok && outcome.refused.length === 0,
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
   * A restore's Redo, from the conversation it was offered in: what it
   * replaced goes back, and the panel learns whether its button is spent (a
   * Redo that left paths it could not do keeps it for another try).
   */
  public async redo(restoreId: string, sourceSessionId: string): Promise<void> {
    let isSpent = false
    try {
      const outcome = await this.deps.port.redo({
        backend: () => this.deps.backend(sourceSessionId),
        sourceSessionId,
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

  /** The conversation was archived: its records go. */
  public async forget(sessionId: string): Promise<void> {
    try {
      await this.deps.port.forgetSession(sessionId)
    } catch (error: unknown) {
      this.deps.log.warn(
        `Checkpoints of session ${sessionId} were not removed: ${failureForLog(error)}`,
      )
    }
    if (sessionId === this.sessionId) {
      await this.refresh()
    }
  }

  /** The conversation was unarchived: its new records are kept again. */
  public async unforget(sessionId: string): Promise<void> {
    try {
      await this.deps.port.unforgetSession(sessionId)
    } catch (error: unknown) {
      this.deps.log.warn(
        `Archives of session ${sessionId} were not removed: ${failureForLog(error)}`,
      )
    }
    if (sessionId === this.sessionId) {
      await this.refresh()
    }
  }

  /** The panel closed: its running turns are ended, its messages' marks let go. */
  public dispose(): void {
    this.endAll()
  }
}
