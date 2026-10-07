import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  lstatSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import {
  CHECKPOINT_JOURNAL_FILE_MODE,
  CHECKPOINT_STORAGE_MODE,
  PLAYBOOK_RECORD_MAX,
  REVIEW_FINDING_PATH_MAX_CHARS,
} from '../../../shared/constants'
import { UI_TEXT } from '../../../shared/l10n/text'
import {
  playbookRecordFile,
  playbookRecordSchema,
  type PlaybookRecord,
} from '../../../shared/playbook'
import { redactSecrets } from '../../../shared/redact'
import {
  PLAYBOOK_BRIEF_NOTE,
  PLAYBOOK_IDENTITY_NOTE,
  PLAYBOOK_LEASE_NOTE,
  PLAYBOOK_RELEASE_NOTE,
  PLAYBOOK_USER_NOTE,
} from './modules'

/** The planner must share one journal per canonical workspace, across teams,
 * branches and lanes. replace is synchronous, atomic and compare-and-swap;
 * rejection must throw before the caller grants admission. */
export interface PlaybookJournal {
  read(): readonly unknown[]
  replace(records: readonly PlaybookRecord[], expected: readonly unknown[]): void
}

function workspaceIdentity(workspaceFolder: string): string {
  const canonical = realpathSync(workspaceFolder)
  let ancestor: string | undefined = canonical
  while (ancestor !== undefined) {
    const marker = path.join(ancestor, '.git')
    let stat: ReturnType<typeof lstatSync> | undefined
    try {
      stat = lstatSync(marker)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    if (stat) {
      if (stat.isDirectory()) return realpathSync(marker)
      if (!stat.isFile()) throw new Error(UI_TEXT.playbookUnavailable)
      const text = readFileSync(marker, 'utf8').trim()
      if (!text.startsWith('gitdir: ') || text.length > REVIEW_FINDING_PATH_MAX_CHARS)
        throw new Error(UI_TEXT.playbookUnavailable)
      const gitDir = realpathSync(path.resolve(ancestor, text.slice('gitdir: '.length)))
      let common: string
      try {
        common = readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim()
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        // A submodule or `--separate-git-dir` repository names its git
        // directory directly: with no `commondir` it is its own common
        // directory, while linked worktrees keep sharing theirs.
        return realpathSync(gitDir)
      }
      if (!common || common.length > REVIEW_FINDING_PATH_MAX_CHARS)
        throw new Error(UI_TEXT.playbookUnavailable)
      return realpathSync(path.resolve(gitDir, common))
    }
    const parent = path.dirname(ancestor)
    ancestor = parent === ancestor ? undefined : parent
  }
  return canonical
}

function scrub(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value)
  if (Array.isArray(value)) return value.map((item: unknown) => scrub(item))
  return value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]))
    : value
}

/** Second scrub applies on both publication and recovery, including reasons,
 * dispositions, paths and identifiers. Strict schemas forbid raw output. */
export function validatedRecords(records: readonly unknown[]): PlaybookRecord[] {
  if (records.length > PLAYBOOK_RECORD_MAX) throw new Error(UI_TEXT.playbookUnavailable)
  return records.map((record) => playbookRecordSchema.parse(scrub(record)))
}

/** Keep safety history, module lineage, every review identity and every design.
 * Evict oldest informational notes. Settings retain every audited opt-out.
 * Round snapshots stay in publication order: moving an answer ahead of a split would change
 * the evidence that the child inherited.
 * If mandatory evidence alone fills the bound, stop instead of resetting it. */
export function retainRecords(records: readonly PlaybookRecord[]): PlaybookRecord[] {
  let excess = records.length - PLAYBOOK_RECORD_MAX
  const bounded = records.filter((record) => {
    if (
      record.kind === 'note' &&
      [
        PLAYBOOK_BRIEF_NOTE,
        PLAYBOOK_IDENTITY_NOTE,
        PLAYBOOK_LEASE_NOTE,
        PLAYBOOK_RELEASE_NOTE,
        PLAYBOOK_USER_NOTE,
      ].includes(record.value.laneId ?? '')
    )
      return true
    if (
      (excess > 0 && record.kind === 'note' && record.value.code === 'checksPassed') ||
      (excess > 0 &&
        record.kind === 'note' &&
        record.value.rule !== 'neverAround' &&
        !record.value.needsUser)
    ) {
      excess -= 1
      return false
    }
    return true
  })
  if (excess > 0) throw new Error(UI_TEXT.playbookUnavailable)
  return bounded
}

/** Bindings surface this storage failure as a user recovery item. */
export class PlaybookHistoryLostError extends Error {
  readonly needsUser = true
  constructor() {
    super(UI_TEXT.playbookUnavailable)
  }
}

/** No branch/lane/team component in this key; directory aliases agree. */
export class FilePlaybookJournal implements PlaybookJournal {
  private readonly marker: string
  readonly file: string

  constructor(agentDataFolder: string, workspaceFolder: string) {
    const canonical = workspaceIdentity(workspaceFolder)
    const identity = process.platform === 'win32' ? canonical.toLowerCase() : canonical
    const key = createHash('sha256').update(identity).digest('hex')
    this.file = path.join(agentDataFolder, playbookRecordFile(key))
    this.marker = path.join(agentDataFolder, 'playbook', 'workspace-state', `${key}.established`)
  }

  private markEstablished(): void {
    if (existsSync(this.marker)) {
      if (!lstatSync(this.marker).isFile()) throw new PlaybookHistoryLostError()
      return
    }
    mkdirSync(path.dirname(this.marker), { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
    const fd = openSync(this.marker, 'a', CHECKPOINT_JOURNAL_FILE_MODE)
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  }

  read(): readonly unknown[] {
    let text: string
    try {
      if (!lstatSync(this.file).isFile()) throw new Error(UI_TEXT.playbookUnavailable)
      text = readFileSync(this.file, 'utf8')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        if (existsSync(this.marker)) throw new PlaybookHistoryLostError()
        return []
      }
      throw new PlaybookHistoryLostError()
    }
    // Also mark journals written by builds predating this loss guard.
    this.markEstablished()
    if (text.length === 0 || !text.endsWith('\n')) throw new Error(UI_TEXT.playbookUnavailable)
    const lines = text.split('\n')
    if (lines.at(-1) === '') lines.pop()
    if (lines.length > PLAYBOOK_RECORD_MAX) throw new Error(UI_TEXT.playbookUnavailable)
    return lines.map((line): unknown => {
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        parsed = undefined
      }
      // JSON.parse errors quote input. Never expose even a malformed record's
      // free text through an exception on its way to a host log or report.
      if (parsed === undefined) throw new Error(UI_TEXT.playbookUnavailable)
      return parsed
    })
  }

  replace(records: readonly PlaybookRecord[], expected: readonly unknown[]): void {
    const safe = validatedRecords(records)
    if (safe.length === 0) throw new Error(UI_TEXT.playbookUnavailable)
    // Reuse the existing private-journal permission constants; no new tunable.
    mkdirSync(path.dirname(this.file), { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
    const lock = `${this.file}.lock`
    const stage = `${this.file}.${randomUUID()}.tmp`
    // A crashed holder leaves a visible lock; never steal it on a timeout.
    mkdirSync(lock)
    try {
      if (JSON.stringify(this.read()) !== JSON.stringify(expected))
        throw new Error(UI_TEXT.playbookUnavailable)
      const fd = openSync(stage, 'wx', CHECKPOINT_JOURNAL_FILE_MODE)
      try {
        writeFileSync(fd, `${safe.map((record) => JSON.stringify(record)).join('\n')}\n`)
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      // The marker is durable first: a crash here requires recovery, never
      // fresh initialization. Losing the JSONL cannot reset safety history.
      this.markEstablished()
      renameSync(stage, this.file)
    } finally {
      rmSync(stage, { force: true })
      rmSync(lock, { recursive: true })
    }
  }
}
