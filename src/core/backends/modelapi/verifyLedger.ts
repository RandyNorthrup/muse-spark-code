// The verify loop's record since the user's last input (M68, PLAN.md D49;
// the Codex review of PR #54, third round, and the review of its redesign):
// one ledger per session in place of the counters that were spread over the
// session and the turn.
//
// It keeps every file's version (advanced by each edit this session makes,
// and by each edit another live session makes in the same workspace) and every check
// that ran (automatic, `run_checks`, or an edit's `then_run` of a configured
// check's own command) against the versions of what it covered. A round is
// judged only when a run since the previous verdict is still on the latest
// state; it passes only when no current run of any check failed (the latest
// run of each check over the same files counts). The fix loop counts failing
// verdicts in a row and stops the checks at CHECK_FIX_MAX_ROUNDS.
//
// Two resets, one per kind of admitted user input: a user's message clears
// everything; a steered message clears the fix loop, the rejections and the
// runs, but not what the conversation wrote (the names that decide what a
// command runs, the code the editor runs), which stays until the next
// message. A goal's wake, and a parent model's message to a subagent, are
// not user input and reset nothing.
//
// Files are known by their real path (links and junctions resolved). Two
// hard links to one file are two paths here: an edit through one does not
// make runs over the other stale (PLAN.md §9). Pure.

import { CHECK_FIX_MAX_ROUNDS, type CheckOutcome } from '../../../shared/constants'
import { canChangeWhatRuns, isCodeLoading } from '../../verify/codeFiles'
import type { EditedFile } from '../../verify/diagnosticsReport'

/** What a check covered: the whole project, or the files passed to it. */
export type CheckScope = 'project' | readonly EditedFile[]

/** The state a run saw: the project's version, or each covered file's. */
type Coverage =
  | { readonly kind: 'project'; readonly version: number }
  | { readonly kind: 'files'; readonly versions: ReadonlyMap<string, number> }

/**
 * The state a check starts on: taken before the command runs, so an edit
 * made while it runs (a subagent's) leaves the run behind (Grok's review).
 */
export interface RunSnapshot {
  /** The check and what it covers: a later run with the same key supersedes this one. */
  readonly key: string
  readonly name: string
  readonly coverage: Coverage
}

interface RecordedRun extends RunSnapshot {
  /** Only runs that finished: passed, failed or timed out. */
  readonly outcome: CheckOutcome
}

interface PendingEdit {
  readonly file: EditedFile
  readonly names: readonly string[]
}

const KEY_SEPARATOR = '\u{0}'
const PATH_SEPARATOR = '\u{1}'
const PROJECT_KEY = 'project'

/** Outcomes that say something about the code: not run, or stopped by the user, say nothing. */
function isJudged(outcome: CheckOutcome): boolean {
  return outcome !== 'notRun' && outcome !== 'cancelled'
}

/** A check's key over a scope: its name and what it covered, in a fixed order. */
function runKey(name: string, scope: CheckScope): string {
  const covered =
    scope === 'project'
      ? PROJECT_KEY
      : scope
          .map((file) => file.absolute)
          .toSorted((a, b) => a.localeCompare(b))
          .join(PATH_SEPARATOR)
  return `${name}${KEY_SEPARATOR}${covered}`
}

/** Whether a run over `coverage` answers for `scope`: the whole project answers for any. */
function isCovering(coverage: Coverage, scope: CheckScope): boolean {
  return (
    coverage.kind === 'project' ||
    (scope !== 'project' && scope.every((file) => coverage.versions.has(file.absolute)))
  )
}

export class VerifyLedger {
  private failedRounds = 0
  private stopped = false
  private readonly rejectedChecks = new Set<string>()
  /** The files this session's edit tools wrote since the user's message, by real path. */
  private readonly files = new Map<string, EditedFile>()
  /** Each file's version, by real path: the project's version at the file's last known edit. */
  private readonly versions = new Map<string, number>()
  private readonly writtenNames = new Set<string>()
  private readonly pendingEdits = new Set<PendingEdit>()
  private firstCodeFile: string | undefined
  /** Advanced by every edit this session knows of. */
  private projectVersion = 0
  private readonly roundFiles = new Map<string, EditedFile>()
  private runs: RecordedRun[] = []
  /** Where the runs not yet judged start. */
  private judgedUpTo = 0

  private versionOf(absolute: string): number {
    return this.versions.get(absolute) ?? 0
  }

  private isCurrent(run: RecordedRun): boolean {
    const { coverage } = run
    if (
      [...this.pendingEdits].some(
        ({ file }) => coverage.kind === 'project' || coverage.versions.has(file.absolute),
      )
    ) {
      return false
    }
    return coverage.kind === 'project'
      ? coverage.version === this.projectVersion
      : [...coverage.versions].every(([absolute, version]) => this.versionOf(absolute) === version)
  }

  /** A user's message, admitted: the loop starts afresh. */
  public resetForMessage(): void {
    this.resetForSteer()
    this.files.clear()
    this.writtenNames.clear()
    this.firstCodeFile = undefined
    this.roundFiles.clear()
  }

  /**
   * A user's steered message, admitted mid-turn: the fix loop, the user's
   * rejections and the recorded runs start afresh. What the conversation
   * wrote stays until the next message, so a steer (even "stop") never lets
   * a session rule answer again for a check whose script the model rewrote,
   * nor the editor show or format again after the model wrote a config it
   * runs (the review of e4b035a3).
   */
  public resetForSteer(): void {
    this.failedRounds = 0
    this.stopped = false
    this.rejectedChecks.clear()
    this.runs = []
    this.judgedUpTo = 0
  }

  /** A new turn: what a stopped turn left for its round is neither checked nor judged. */
  public beginTurn(): void {
    this.roundFiles.clear()
    this.judgedUpTo = this.runs.length
  }

  /**
   * A file this session's edit tools wrote, with the names it was written
   * under (as given and after links): a new version of it and of the project.
   */
  public noteEdit(file: EditedFile, names: readonly string[]): void {
    this.noteOutsideEdit(file, names)
    this.files.set(file.absolute, file)
    this.roundFiles.set(file.absolute, file)
  }

  /**
   * A workspace write about to start. Pending names survive user-input resets;
   * runs taken before or during the write cannot certify its completed state.
   * Even a failed write remains conservatively known until the next message.
   */
  public beginEdit(file: EditedFile, names: readonly string[]): () => void {
    const edit: PendingEdit = { file, names }
    this.pendingEdits.add(edit)
    this.noteOutsideEdit(file, names)
    return () => {
      this.pendingEdits.delete(edit)
      this.noteOutsideEdit(file, names)
    }
  }

  /**
   * A file written in this workspace by another live session, with the names
   * it was written under: runs over it, and over
   * the whole project, are no longer on the latest state, and what it
   * decides (a check's script, code the editor runs) counts as this
   * session's own (Grok's review). It is not this session's to check, so
   * it is not among its edited files.
   */
  public noteOutsideEdit(file: EditedFile, names: readonly string[]): void {
    this.projectVersion += 1
    this.versions.set(file.absolute, this.projectVersion)
    for (const name of names) {
      this.writtenNames.add(name)
    }
    if (this.firstCodeFile === undefined && names.some((name) => isCodeLoading(name))) {
      this.firstCodeFile = file.relative
    }
  }

  /** The first file written that the editor's tools run as code, if any. */
  public get codeFile(): string | undefined {
    return (
      this.firstCodeFile ??
      [...this.pendingEdits].find(({ names }) => names.some((name) => isCodeLoading(name)))?.file
        .relative
    )
  }

  /** Whether the fix loop stopped the checks. */
  public get isStopped(): boolean {
    return this.stopped
  }

  public isRejected(name: string): boolean {
    return this.rejectedChecks.has(name)
  }

  public reject(name: string): void {
    this.rejectedChecks.add(name)
  }

  /** Whether a file written since the user's message decides what `command` runs. */
  public changesWhatRuns(command: string): boolean {
    return (
      [...this.writtenNames].some((name) => canChangeWhatRuns(name, command)) ||
      [...this.pendingEdits].some(({ names }) =>
        names.some((name) => canChangeWhatRuns(name, command)),
      )
    )
  }

  /** The files written since the user's message: `run_checks`'s default. */
  public editedFiles(): readonly EditedFile[] {
    return Array.from(this.files, ([, file]) => file)
  }

  /** The files written in the round that just ended, taken for its checks. */
  public takeRoundEdits(): readonly EditedFile[] {
    const edited = Array.from(this.roundFiles, ([, file]) => file)
    this.roundFiles.clear()
    return edited
  }

  /** The state `name` is about to run on over `scope`: take it before the command starts. */
  public snapshot(name: string, scope: CheckScope): RunSnapshot {
    const coverage: Coverage =
      scope === 'project'
        ? { kind: 'project', version: this.projectVersion }
        : {
            kind: 'files',
            versions: new Map(scope.map((file) => [file.absolute, this.versionOf(file.absolute)])),
          }
    return { key: runKey(name, scope), name, coverage }
  }

  /** A check that ran, recorded against the state it started on. */
  public record(outcome: CheckOutcome, startedOn: RunSnapshot): void {
    if (isJudged(outcome)) {
      this.runs.push({ ...startedOn, outcome })
    }
  }

  /** Whether `name` already ran on the latest state of everything `scope` holds. */
  public hasCurrentRun(name: string, scope: CheckScope): boolean {
    return this.runs.some(
      (run) => run.name === name && this.isCurrent(run) && isCovering(run.coverage, scope),
    )
  }

  /**
   * The round's verdict, when a run since the previous one is still on the
   * latest state: passed only when no current run of any check failed or
   * timed out (the latest run of each check over the same files counts, so a
   * failure no edit has touched still counts), else failed; nothing when no
   * such run. The fix loop advances on a failed verdict and resets on a
   * passed one; true when this verdict stopped the checks.
   */
  public judgeRound(): boolean {
    const isFresh = this.runs.slice(this.judgedUpTo).some((run) => this.isCurrent(run))
    this.judgedUpTo = this.runs.length
    if (!isFresh) {
      return false
    }
    const latest = new Map(this.runs.map((run) => [run.key, run]))
    const current = Array.from(latest, ([, run]) => run).filter((run) => this.isCurrent(run))
    if (current.every((run) => run.outcome === 'passed')) {
      this.failedRounds = 0
      return false
    }
    if (this.stopped) {
      return false
    }
    this.failedRounds += 1
    if (this.failedRounds < CHECK_FIX_MAX_ROUNDS) {
      return false
    }
    this.stopped = true
    return true
  }
}
