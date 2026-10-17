// The workspace's saved plans (M79, PLAN.md D49): `.agents/plans/*.md`.
// A save never replaces a file: it makes a new one, or finds the same plan
// already saved under one of its names. Every path is confined to the
// workspace, links and junctions resolved (PLAN.md D24), and the plans
// folder must be the workspace's own `.agents/plans`, not a link to
// somewhere else inside it. Reads are bounded. The file system is a port.

import {
  PLAN_FILE_MAX_BYTES,
  PLAN_FILE_MAX_KB,
  PLAN_LIST_MAX,
  PLAN_NAME_ATTEMPTS,
  PLANS_DIR_SEGMENTS,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { hasBinaryControlCharacters } from '../attachments'
import { confineWorkspacePath, type RealPathIo } from '../workspacePath'
import type { EditedFile } from '../verify/diagnosticsReport'
import type { WorkspaceEditRecorder } from '../verify/workspaceEdits'
import {
  isPlanFileName,
  type PlanContent,
  type PlanDocument,
  type PlanMarkdown,
  parsePlanFile,
  planFileName,
  planSlug,
} from './planDocument'

export interface PlanDirectoryEntry {
  readonly name: string
  /** A link or junction is `other`: never followed. */
  readonly kind: 'file' | 'directory' | 'other'
}

export interface PlanIo extends RealPathIo {
  /**
   * Publishes a new file with `content` at `absolutePath`, the checked
   * canonical target, its folder created and checked again before the file
   * appears; false when a file of that name exists already, which is left
   * as it was. Any other failure rejects.
   */
  createFile(absolutePath: string, content: string): Promise<boolean>
  /**
   * The file's bytes, read only from `expectedCanonicalPath`'s target, never
   * more than `maxBytes` whatever the file is; `bytes` is undefined when it
   * is missing or larger.
   */
  readFile(
    absolutePath: string,
    maxBytes: number,
    expectedCanonicalPath: string,
  ): Promise<{ readonly bytes: Uint8Array | undefined; readonly isPdf: boolean }>
  /** A folder's entries; none when it does not exist, a rejection when it is not a folder. */
  listEntries(absolutePath: string): Promise<readonly PlanDirectoryEntry[]>
  /** Removes the hidden stages a failed or interrupted save left in the folder, once stale. */
  removeStaleStages(absolutePath: string): Promise<void>
}

export interface PlanStoreDeps {
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly io: PlanIo
  /**
   * The panel's Markdown parser for a plan's title (dist/planMarkdown.js,
   * loaded on first use); throws, with the reason, when it cannot load.
   */
  readonly markdown: () => PlanMarkdown
  /** Host-owned notices; only a true new-file result counts as the captured owner's edit. */
  readonly beginEdit?: (
    file: EditedFile,
    ownerRecorder: WorkspaceEditRecorder | undefined,
  ) => (wasWritten: boolean) => void
}

/** Where a saved plan landed. */
export interface SavedPlan {
  readonly fileName: string
  /** Workspace-relative, forward slashes: `.agents/plans/<file>`. */
  readonly relativePath: string
}

/** What a save did: a new file, or the same plan found saved already. */
export interface SaveOutcome extends SavedPlan {
  readonly isNew: boolean
}

/** A plan read back whole. */
export interface PlanFile extends SavedPlan {
  readonly bytes: Uint8Array
  readonly document: PlanDocument
}

/** One row of Plans…. */
export interface PlanSummary extends SavedPlan {
  readonly title: string
}

const PLANS_DIR = PLANS_DIR_SEGMENTS.join('/')

interface PlanPlace {
  readonly relativePath: string
  /** The target as the file system resolves it: what is written and read. */
  readonly checkedAbsolute: string
}

/** Case folds where the usual file systems fold it (Windows, macOS). */
function isSameRelative(left: string, right: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'darwin'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

function isSameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index])
}

/** The refusal for a plan over the size limit, in the user's language. */
export function planTooLargeText(): string {
  return fill(UI_TEXT.planTooLarge, { size: PLAN_FILE_MAX_KB })
}

export class PlanStore {
  public constructor(private readonly deps: PlanStoreDeps) {}

  /** A path under the plans folder, confined; throws with the reason otherwise. */
  private async place(relativePath: string): Promise<PlanPlace> {
    const resolution = await confineWorkspacePath(
      this.deps.workspaceRoot,
      relativePath,
      this.deps.platform,
      this.deps.io,
    )
    if (!resolution.ok) {
      throw new Error(resolution.reason)
    }
    // `.agents` or `plans` as a link to another folder of the workspace
    // would put the plans where nobody looks for them.
    if (!isSameRelative(resolution.canonical, relativePath, this.deps.platform)) {
      throw new Error(`${PLANS_DIR} leads to ${resolution.canonical} through a link`)
    }
    return { relativePath, checkedAbsolute: resolution.checkedAbsolute }
  }

  private async planPlace(fileName: string): Promise<PlanPlace> {
    if (!isPlanFileName(fileName)) {
      throw new Error(`${fileName} is not a plan file name`)
    }
    return await this.place(`${PLANS_DIR}/${fileName}`)
  }

  /** Whether the taken name already holds exactly these bytes (the same plan saved before). */
  private async holds(fileName: string, bytes: Uint8Array): Promise<boolean> {
    try {
      const saved = await this.read(fileName)
      return isSameBytes(saved.bytes, bytes)
    } catch {
      // Unreadable (a folder of that name, too large, gone again): not this plan.
      return false
    }
  }

  /**
   * Where this plan is saved already under one of the names a save would
   * give it (the same bytes), so a second press asks nothing and writes
   * nothing; undefined when it is not.
   */
  public async find(content: PlanContent): Promise<SavedPlan | undefined> {
    const bytes = new TextEncoder().encode(content.text)
    const folder = await this.place(PLANS_DIR)
    const entries = await this.deps.io.listEntries(folder.checkedAbsolute)
    const taken = new Set(entries.map((entry) => entry.name))
    const slug = planSlug(content.title)
    for (let attempt = 1; attempt <= PLAN_NAME_ATTEMPTS; attempt += 1) {
      const fileName = planFileName(content.savedAt, slug, attempt)
      if (!taken.has(fileName)) {
        return undefined
      }
      if (await this.holds(fileName, bytes)) {
        return { fileName, relativePath: `${PLANS_DIR}/${fileName}` }
      }
    }
    return undefined
  }

  /**
   * Saves the plan byte for byte as `<date>-<slug>.md`, or the first free
   * `-<n>` after it. A name that already holds exactly this plan is the
   * plan's (saved before, from this or another panel): no second copy.
   */
  public async save(
    content: PlanContent,
    ownerRecorder?: WorkspaceEditRecorder,
  ): Promise<SaveOutcome> {
    const bytes = new TextEncoder().encode(content.text)
    if (bytes.byteLength > PLAN_FILE_MAX_BYTES) {
      throw new Error(planTooLargeText())
    }
    const folder = await this.place(PLANS_DIR)
    await this.deps.io.removeStaleStages(folder.checkedAbsolute)
    const slug = planSlug(content.title)
    for (let attempt = 1; attempt <= PLAN_NAME_ATTEMPTS; attempt += 1) {
      const fileName = planFileName(content.savedAt, slug, attempt)
      const place = await this.planPlace(fileName)
      const complete = this.deps.beginEdit?.(
        { relative: place.relativePath, absolute: place.checkedAbsolute },
        ownerRecorder,
      )
      let wasWritten = false
      try {
        wasWritten = await this.deps.io.createFile(place.checkedAbsolute, content.text)
      } finally {
        complete?.(wasWritten)
      }
      if (wasWritten) {
        return { fileName, relativePath: place.relativePath, isNew: true }
      }
      if (await this.holds(fileName, bytes)) {
        return { fileName, relativePath: place.relativePath, isNew: false }
      }
    }
    throw new Error(UI_TEXT.planNamesTaken)
  }

  /** Whether the plans folder holds this file (a regular file, not a link). */
  public async has(fileName: string): Promise<boolean> {
    const folder = await this.place(PLANS_DIR)
    const entries = await this.deps.io.listEntries(folder.checkedAbsolute)
    return entries.some((entry) => entry.kind === 'file' && entry.name === fileName)
  }

  /** A plan whole, bounded; throws with the reason when it cannot be read as one. */
  public async read(fileName: string): Promise<PlanFile> {
    const markdown = this.deps.markdown()
    const place = await this.planPlace(fileName)
    const read = await this.deps.io.readFile(
      place.checkedAbsolute,
      PLAN_FILE_MAX_BYTES,
      place.checkedAbsolute,
    )
    if (read.isPdf) {
      throw new Error(UI_TEXT.textFileInvalid)
    }
    if (read.bytes === undefined) {
      throw new Error((await this.has(fileName)) ? planTooLargeText() : UI_TEXT.planFileMissing)
    }
    // Text, as a picked text file must be (M54): the brief is written from
    // the parsed plan, which would turn a NUL into U+FFFD and pass it on.
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(read.bytes)
    } catch {
      throw new Error(UI_TEXT.textFileInvalid)
    }
    if (hasBinaryControlCharacters(text)) {
      throw new Error(UI_TEXT.textFileInvalid)
    }
    return {
      fileName,
      relativePath: place.relativePath,
      bytes: read.bytes,
      document: parsePlanFile(markdown, text, fileName),
    }
  }

  /**
   * The saved plans, newest date first (a plan's name starts with the day it
   * was saved; one day's plans follow in reverse name order). One that
   * cannot be read is listed by its name.
   */
  public async list(): Promise<readonly PlanSummary[]> {
    // The parser first: a listing it cannot title is refused, not half made.
    this.deps.markdown()
    const folder = await this.place(PLANS_DIR)
    await this.deps.io.removeStaleStages(folder.checkedAbsolute)
    const entries = await this.deps.io.listEntries(folder.checkedAbsolute)
    const names = entries
      .filter((entry) => entry.kind === 'file' && isPlanFileName(entry.name))
      .map((entry) => entry.name)
      .toSorted((left, right) => right.localeCompare(left))
      .slice(0, PLAN_LIST_MAX)
    const summaries: PlanSummary[] = []
    for (const fileName of names) {
      const relativePath = `${PLANS_DIR}/${fileName}`
      let title = fileName
      try {
        const plan = await this.read(fileName)
        title = plan.document.title
      } catch {
        // Listed by its name: opening or implementing it says why it cannot be read.
      }
      summaries.push({ fileName, relativePath, title })
    }
    return summaries
  }
}
