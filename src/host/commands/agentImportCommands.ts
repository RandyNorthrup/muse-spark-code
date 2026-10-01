// `Muse Spark: Import from Other Agents` (M83, PLAN.md D49): MCP servers,
// hooks, custom agents, slash commands and rules files from Claude Code,
// Codex and Cursor, converted to Muse Code's shapes.
//
// The flow: pick the tools, scan (reads only), check the entries, then a
// read-only preview document shows exactly what would be written and what
// is to be copied by hand, masked, beside a notification that asks; nothing
// is written before the user chooses Import there. Files are created, never
// replaced; rules sections are appended to AGENTS.md. MCP servers and hooks
// are never written (D17, D30): their converted entries, masked, are copied
// on request and the file they go into is opened for the user to paste them
// and fill in what is masked. The log carries paths, counts and error codes,
// never a file's content. Every VS Code and file interaction is injected.
// No model call.

import { fenced } from '../../core/export/transcriptMarkdown'
import { decodeContextText } from '../../core/context/contextFiles'
import {
  applyImportWrites,
  type ImportApplyResult,
  type ImportCandidate,
  type ImportCopy,
  type ImportIo,
  importDisplayPath,
  importErrorCode,
  type ImportPlan,
  type ImportPlanFile,
  type ImportPlanState,
  type ImportProjectRoot,
  type ImportRead,
  type ImportSkipReason,
  type ImportWriter,
  type ImportWriteNotice,
  planImportApply,
  scanAgentImports,
} from '../../core/import/agentImport'
import { maskText } from '../../core/import/importMask'
import { isSamePath } from '../../core/paths'
import { confineWorkspacePath } from '../../core/workspacePath'
import { pathModule } from '../../core/workspaceRoot'
import {
  AGENT_IMPORT_ROOT_CHANGED_CODE,
  AGENT_IMPORT_SOURCES,
  type AgentImportSource,
  HOOK_CONFIG_MAX_BYTES,
  PROJECT_HOOKS_SEGMENTS,
  RULES_FILE_MAX_BYTES,
  RULES_FILE_NAMES,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatNumber } from '../../shared/l10n/text'
import type { Logger } from '../logger'

export type AgentImportSourceChoice = AgentImportSource | 'all'

/**
 * Runs the task unless one is already running; false when it is busy. The
 * gate is held until the whole flow ends, every answer the user owes
 * included, so a second import never starts over the first one's questions.
 */
export type ImportGate = (task: () => Promise<void>) => Promise<boolean>

/** One gate for the extension host: only one import is open at a time. */
export function createImportGate(): ImportGate {
  let isOpen = false
  return async (task) => {
    if (isOpen) {
      return false
    }
    isOpen = true
    try {
      await task()
      return true
    } finally {
      isOpen = false
    }
  }
}

export interface AgentImportPickItem {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly detail: string
  /** Checked at first: every entry that can be imported. */
  readonly picked: boolean
}

export interface AgentImportDeps {
  readonly platform: NodeJS.Platform
  readonly homeDir: string
  /** `CLAUDE_CONFIG_DIR` and `CODEX_HOME` as the extension host's environment gives them. */
  readonly claudeConfigDir: string | undefined
  readonly codexHome: string | undefined
  readonly workspaceRoot: string | undefined
  readonly isWorkspaceTrusted: () => boolean
  /** False as soon as this activation begins shutting down. */
  readonly isActive: () => boolean
  /** Muse Code's settings file where `muse serve` reads it; its folder holds the personal skills. */
  readonly museSettingsFile: string
  /**
   * The window's first folder as VS Code names it now. The approval wait can
   * outlast a change to it, so a write compares it with the folder the plan
   * was made for.
   */
  readonly currentRoot: () => string | undefined
  readonly io: ImportIo
  readonly writer: ImportWriter
  /** The session-owned workspace notice for a project write (M68); absent without a live session. */
  readonly beginProjectEdit?: ImportWriteNotice
  /**
   * Holds the checkpoint lease (M72) until `work` settles, so no restore
   * runs over the import's project writes; `check` throws once the window
   * or the root it was taken for is gone. Runs only for project writes.
   */
  readonly editProject: <T>(work: (check: () => void) => Promise<T>) => Promise<T>
  /** Keeps a project file's bytes for a checkpoint restore before it is written (M72). */
  readonly beforeProjectWrite: (absolutePath: string) => Promise<void>
  readonly isPresent: (absolutePath: string) => Promise<boolean>
  /** Lets one complete import flow run at a time in this host (`createImportGate`). */
  readonly gate: ImportGate
  /** All three tools, one of them, or undefined when dismissed. */
  readonly pickSource: () => Promise<AgentImportSourceChoice | undefined>
  /** The ids left checked, or undefined when dismissed. */
  readonly pickCandidates: (
    items: readonly AgentImportPickItem[],
  ) => Promise<readonly string[] | undefined>
  /** Opens the preview as a read-only Markdown document. */
  readonly openPreview: (title: string, markdown: string) => Promise<void>
  /** Asks beside the open preview; true only when the user chose Import. */
  readonly confirmImport: (message: string) => Promise<boolean>
  /** Asks about one copy text: 'copy' to copy it and open its file, 'open' to only open it. */
  readonly offerCopy: (message: string) => Promise<'copy' | 'open' | undefined>
  readonly copyText: (text: string) => Promise<void>
  /**
   * Opens the file in an editor: loads the document, then asks `isStillSafe`
   * before it is shown (the load awaits); one that does not exist opens
   * unsaved at its path, for the user to save.
   */
  readonly openTarget: (
    absolutePath: string,
    isExisting: boolean,
    isStillSafe: () => Promise<boolean>,
  ) => Promise<void>
  readonly showInformation: (message: string) => void
  readonly showWarning: (message: string) => void
  readonly log: Logger
}

/** What the VS Code side supplies; the import's own file access and gate come with its bundle. */
export type AgentImportHost = Omit<
  AgentImportDeps,
  'io' | 'writer' | 'isPresent' | 'gate' | 'claudeConfigDir' | 'codexHome'
> & {
  /** The extension host's environment: the tools' own folder variables are read from it inside the bundle. */
  readonly environment: Readonly<Record<string, string | undefined>>
}

const DETAIL_SEPARATOR = ' · '
const LIST_SEPARATOR = ', '
const SENTENCE_SEPARATOR = ' '
const MARKDOWN_FENCE_LANGUAGE = 'markdown'
const JSON_FENCE_LANGUAGE = 'json'
const PREVIEW_EXTENSION = '.md'
const LOG_PREFIX = 'Import from other agents:'

function sourceLabel(source: AgentImportSource): string {
  switch (source) {
    case 'claudeCode': {
      return UI_TEXT.importSourceClaude
    }
    case 'codex': {
      return UI_TEXT.importSourceCodex
    }
    case 'cursor': {
      return UI_TEXT.agentImportSourceCursor
    }
  }
}

function kindLabel(candidate: ImportCandidate): string {
  switch (candidate.kind) {
    case 'mcpServer': {
      return UI_TEXT.agentImportKindMcp
    }
    case 'hook': {
      return UI_TEXT.agentImportKindHook
    }
    case 'agent': {
      return UI_TEXT.agentImportKindAgent
    }
    case 'command': {
      return UI_TEXT.agentImportKindCommand
    }
    case 'rules': {
      return UI_TEXT.agentImportKindRules
    }
  }
}

function reasonLabel(reason: ImportSkipReason): string {
  switch (reason) {
    case 'disabled': {
      return UI_TEXT.agentImportSkippedDisabled
    }
    case 'unsupported': {
      return UI_TEXT.agentImportSkippedUnsupported
    }
    case 'unmapped': {
      return UI_TEXT.agentImportSkippedUnmapped
    }
    case 'projectServer': {
      return UI_TEXT.agentImportSkippedProjectServer
    }
    case 'userRules': {
      return UI_TEXT.agentImportSkippedUserRules
    }
    case 'exists': {
      return UI_TEXT.agentImportSkippedExists
    }
    case 'duplicate': {
      return UI_TEXT.agentImportSkippedDuplicate
    }
    case 'outside': {
      return UI_TEXT.agentImportSkippedOutside
    }
    case 'unreadable': {
      return UI_TEXT.agentImportSkippedUnreadable
    }
    case 'tooLarge': {
      return UI_TEXT.agentImportSkippedTooLarge
    }
    case 'changed': {
      return UI_TEXT.agentImportSkippedChanged
    }
    case 'failed': {
      return UI_TEXT.agentImportSkippedFailed
    }
  }
}

function describeCandidate(candidate: ImportCandidate): string {
  const scope =
    candidate.origin === 'project' ? UI_TEXT.agentImportProjectFiles : UI_TEXT.agentImportUserFiles
  return [kindLabel(candidate), sourceLabel(candidate.source), scope].join(DETAIL_SEPARATOR)
}

function shownPath(deps: AgentImportDeps, absolutePath: string): string {
  return importDisplayPath(absolutePath, deps)
}

function pickItemOf(deps: AgentImportDeps, candidate: ImportCandidate): AgentImportPickItem {
  const where = shownPath(deps, candidate.originPath)
  const { target } = candidate
  return {
    id: candidate.id,
    label: candidate.label,
    description: describeCandidate(candidate),
    detail:
      target.kind === 'none' ? `${where}${DETAIL_SEPARATOR}${reasonLabel(target.reason)}` : where,
    picked: target.kind !== 'none',
  }
}

function fromLine(deps: AgentImportDeps, candidate: ImportCandidate): string {
  return fill(UI_TEXT.agentImportPreviewFrom, { path: shownPath(deps, candidate.originPath) })
}

function copyHeading(deps: AgentImportDeps, copy: ImportCopy): string {
  return fill(
    copy.file === 'settings' ? UI_TEXT.agentImportPreviewSettings : UI_TEXT.agentImportPreviewHooks,
    { path: shownPath(deps, copy.absolutePath) },
  )
}

function droppedLines(candidates: readonly ImportCandidate[]): readonly string[] {
  return candidates.flatMap((candidate) =>
    candidate.dropped.length === 0
      ? []
      : [
          `- ${candidate.label}: ${fill(UI_TEXT.agentImportPreviewDropped, {
            fields: candidate.dropped.join(LIST_SEPARATOR),
          })}`,
        ],
  )
}

/** The preview document: every write whole, every copy text, every entry left out and why. */
function previewMarkdown(
  deps: AgentImportDeps,
  plan: ImportPlan,
  selected: readonly ImportCandidate[],
  mask: string,
): string {
  const byId = new Map(selected.map((candidate) => [candidate.id, candidate] as const))
  const candidatesOf = (ids: readonly string[]): readonly ImportCandidate[] =>
    ids.flatMap((id) => byId.get(id) ?? [])
  const writeBlock = (content: string, ids: readonly string[]): readonly string[] => [
    ...candidatesOf(ids).map((candidate) => fromLine(deps, candidate)),
    fenced(maskText(content, mask).trimEnd(), MARKDOWN_FENCE_LANGUAGE),
  ]
  const creates = plan.writes.filter((write) => write.mode === 'create')
  const appends = plan.writes.filter((write) => write.mode === 'append')
  const blocks: string[] = [`# ${UI_TEXT.agentImportPreviewTitle}`, UI_TEXT.agentImportPreviewIntro]
  if (creates.length > 0) {
    blocks.push(`## ${UI_TEXT.agentImportPreviewFiles}`)
  }
  for (const write of creates) {
    blocks.push(
      `### ${shownPath(deps, write.absolutePath)}`,
      ...writeBlock(write.content, write.candidateIds),
    )
  }
  for (const write of appends) {
    blocks.push(
      `## ${fill(UI_TEXT.agentImportPreviewRules, { path: shownPath(deps, write.absolutePath) })}`,
      ...writeBlock(write.content, write.candidateIds),
    )
  }
  for (const copy of plan.copies) {
    const candidates = candidatesOf(copy.candidateIds)
    blocks.push(
      `## ${copyHeading(deps, copy)}`,
      copy.isNewFile ? UI_TEXT.agentImportPreviewNewFile : UI_TEXT.agentImportPreviewMerge,
      ...(copy.file === 'settings' && plan.hasLegacyMcpKey
        ? [UI_TEXT.agentImportPreviewLegacyKey]
        : []),
      ...(candidates.some((candidate) => candidate.kind === 'hook')
        ? [UI_TEXT.agentImportPreviewMatchers]
        : []),
      fenced(copy.text, JSON_FENCE_LANGUAGE),
      ...droppedLines(candidates),
    )
  }
  const notImported = plan.skipped.flatMap((skip) => {
    const candidate = byId.get(skip.candidateId)
    return candidate === undefined
      ? []
      : [`- ${candidate.label} (${describeCandidate(candidate)}): ${reasonLabel(skip.reason)}`]
  })
  if (notImported.length > 0) {
    blocks.push(`## ${UI_TEXT.agentImportPreviewNotImported}`, notImported.join('\n'))
  }
  return `${blocks.join('\n\n')}\n`
}

/** Where a project destination stands: inside the planned folder, outside it by a link, or the folder changed. */
type ProjectStanding = 'inside' | 'outside' | 'changed'

/** Whether a project destination stays in the planned workspace folder once links and junctions are followed. */
async function projectStanding(
  deps: AgentImportDeps,
  absolutePath: string,
  project: ImportProjectRoot | undefined,
): Promise<ProjectStanding> {
  if (project === undefined) {
    return 'outside'
  }
  try {
    const confined = await confineWorkspacePath(project.path, absolutePath, deps.platform, deps.io)
    if (!confined.ok) {
      return 'outside'
    }
    await deps.writer.assertSafePath(absolutePath, project)
    return 'inside'
  } catch (error: unknown) {
    const code = importErrorCode(error)
    deps.log.warn(`${LOG_PREFIX} ${shownPath(deps, absolutePath)} could not be resolved (${code})`)
    return code === AGENT_IMPORT_ROOT_CHANGED_CODE ? 'changed' : 'outside'
  }
}

/**
 * A destination file for the plan: its text, or why it is unknown. A
 * project's file is confined first, so a link out of the workspace is never
 * read; a file that is there but cannot be read says so rather than passing
 * for an empty one.
 */
async function readPlanFile(
  deps: AgentImportDeps,
  absolutePath: string,
  maxBytes: number,
  project: ImportProjectRoot | undefined,
  isProject: boolean,
): Promise<ImportPlanFile> {
  if (isProject && (await projectStanding(deps, absolutePath, project)) !== 'inside') {
    deps.log.warn(
      `${LOG_PREFIX} ${shownPath(deps, absolutePath)} is unsafe or outside the workspace`,
    )
    return { status: 'outside' }
  }
  let read: ImportRead
  try {
    read = await deps.io.readFile(absolutePath, maxBytes, isProject ? project?.path : undefined)
  } catch (error: unknown) {
    deps.log.warn(
      `${LOG_PREFIX} ${shownPath(deps, absolutePath)} could not be read (${importErrorCode(error)})`,
    )
    return { status: 'unreadable' }
  }
  if (read.status === 'missing') {
    return { status: 'missing' }
  }
  const decoded = read.status === 'read' ? decodeContextText(read.bytes) : undefined
  if (decoded?.ok !== true) {
    deps.log.warn(
      `${LOG_PREFIX} ${shownPath(deps, absolutePath)} could not be read (${read.status})`,
    )
    return { status: 'unreadable' }
  }
  return { status: 'read', text: decoded.text }
}

function countLines(plan: ImportPlan): readonly string[] {
  const creates = plan.writes.filter((write) => write.mode === 'create').length
  const sections = plan.writes
    .filter((write) => write.mode === 'append')
    .reduce((total, write) => total + write.candidateIds.length, 0)
  const copied = plan.copies.reduce((total, copy) => total + copy.candidateIds.length, 0)
  return [
    fill(UI_TEXT.agentImportCountFiles, { count: formatNumber(creates) }),
    fill(UI_TEXT.agentImportCountSections, { count: formatNumber(sections) }),
    fill(UI_TEXT.agentImportCountCopies, { count: formatNumber(copied) }),
    fill(UI_TEXT.agentImportCountSkipped, { count: formatNumber(plan.skipped.length) }),
  ]
}

/** Each copy text in turn: copied and its file opened, or only the file opened, or passed over. */
async function offerCopies(deps: AgentImportDeps, plan: ImportPlan): Promise<void> {
  for (const copy of plan.copies) {
    if (!deps.isActive()) {
      return
    }
    const choice = await deps.offerCopy(
      fill(UI_TEXT.agentImportCopyPrompt, { path: shownPath(deps, copy.absolutePath) }),
    )
    if (choice === undefined) {
      continue
    }
    // Checked again now: a `.muse` linked out since the preview is neither copied for nor opened.
    if (!(await isCopyTargetSafe(deps, copy, plan.projectRoot))) {
      continue
    }
    // The awaited path check returned to this continuation: keep the
    // clipboard entry itself behind a fresh synchronous project guard.
    if (!deps.isActive()) {
      return
    }
    if (copy.file === 'hooks' && !deps.isWorkspaceTrusted()) {
      deps.showWarning(UI_TEXT.agentImportUntrusted)
      continue
    }
    if (choice === 'copy') {
      // The clipboard holds the masked text; the masked values are filled in by hand.
      await deps.copyText(copy.text)
      if (deps.isActive()) {
        deps.showInformation(UI_TEXT.agentImportCopied)
      }
    }
    // Clipboard access awaits: the destination may have changed meanwhile.
    if (!(await isCopyTargetSafe(deps, copy, plan.projectRoot))) {
      continue
    }
    await deps.openTarget(
      copy.absolutePath,
      !copy.isNewFile,
      async () => await isCopyTargetSafe(deps, copy, plan.projectRoot),
    )
  }
}

async function isCopyTargetSafe(
  deps: AgentImportDeps,
  copy: ImportCopy,
  project: ImportProjectRoot | undefined,
): Promise<boolean> {
  if (!deps.isActive()) {
    return false
  }
  if (copy.file !== 'hooks') {
    return true
  }
  if (!deps.isWorkspaceTrusted()) {
    deps.showWarning(UI_TEXT.agentImportUntrusted)
    return false
  }
  const standing =
    project !== undefined && !(await isRootCurrent(deps, project))
      ? 'changed'
      : await projectStanding(deps, copy.absolutePath, project)
  if (standing === 'inside') {
    if (!deps.isActive()) {
      return false
    }
    if (!deps.isWorkspaceTrusted()) {
      deps.showWarning(UI_TEXT.agentImportUntrusted)
      return false
    }
    return true
  }
  deps.showWarning(
    `${shownPath(deps, copy.absolutePath)}: ${
      standing === 'changed' ? UI_TEXT.agentImportSkippedChanged : UI_TEXT.agentImportSkippedOutside
    }`,
  )
  return false
}

/**
 * Whether the window's first folder still leads to the folder the plan was
 * made for: the approval wait can outlast a change to the folder list or to
 * a link on the way to it.
 */
async function isRootCurrent(deps: AgentImportDeps, project: ImportProjectRoot): Promise<boolean> {
  const live = deps.currentRoot()
  if (live === undefined) {
    return false
  }
  try {
    const now = await deps.writer.identifyRoot(live)
    return (
      isSamePath(now.canonical, project.identity.canonical, deps.platform) &&
      now.fileId === project.identity.fileId
    )
  } catch (error: unknown) {
    deps.log.warn(
      `${LOG_PREFIX} the workspace folder could not be resolved (${importErrorCode(error)})`,
    )
    return false
  }
}

async function hooksFileState(
  deps: AgentImportDeps,
  hooksFile: string | undefined,
  project: ImportProjectRoot | undefined,
): Promise<ImportPlanState['hooksFile']> {
  if (hooksFile === undefined || (await projectStanding(deps, hooksFile, project)) !== 'inside') {
    return 'outside'
  }
  return (await deps.isPresent(hooksFile)) ? 'present' : 'missing'
}

async function planFor(
  deps: AgentImportDeps,
  selected: readonly ImportCandidate[],
  project: ImportProjectRoot | undefined,
): Promise<ImportPlan> {
  const p = pathModule(deps.platform)
  const [agentsFile] = RULES_FILE_NAMES
  const root = deps.workspaceRoot
  const hooksFile = root === undefined ? undefined : p.join(root, ...PROJECT_HOOKS_SEGMENTS)
  return await planImportApply(
    selected,
    {
      platform: deps.platform,
      workspaceRoot: root,
      workspaceIdentity: project?.identity,
      personalRoot: p.dirname(deps.museSettingsFile),
      museSettingsFile: deps.museSettingsFile,
    },
    {
      isPresent: deps.isPresent,
      rulesFile:
        root === undefined
          ? { status: 'missing' }
          : await readPlanFile(deps, p.join(root, agentsFile), RULES_FILE_MAX_BYTES, project, true),
      // The size Muse Code's own hooks loader reads the settings file up to.
      museSettings: await readPlanFile(
        deps,
        deps.museSettingsFile,
        HOOK_CONFIG_MAX_BYTES,
        undefined,
        false,
      ),
      hooksFile: await hooksFileState(deps, hooksFile, project),
    },
  )
}

/** The import's guard: the window is live, and a project write also needs a trusted workspace. */
function requireLive(deps: AgentImportDeps, isProject: boolean): void {
  if (!deps.isActive() || (isProject && !deps.isWorkspaceTrusted())) {
    throw Object.assign(new Error(UI_TEXT.agentImportUntrusted), { code: 'EPERM' })
  }
}

/** The accepted plan's writes, then its copies, then what happened. */
async function applyPlan(
  deps: AgentImportDeps,
  plan: ImportPlan,
  selected: readonly ImportCandidate[],
): Promise<void> {
  const apply = async (check?: () => void) =>
    await applyImportWrites(plan.writes, deps.writer, deps.platform, {
      beforeWrite: (isProject) => {
        requireLive(deps, isProject)
        if (isProject) {
          check?.()
        }
      },
      ...(deps.beginProjectEdit !== undefined && { beginProjectEdit: deps.beginProjectEdit }),
      beforeProjectWrite: deps.beforeProjectWrite,
      isRootCurrent: async (root) => await isRootCurrent(deps, root),
    })
  // The lease's release can fail after the writes are done: keep what they did.
  const outcomes: ImportApplyResult[] = []
  try {
    if (plan.writes.some((write) => write.isProject)) {
      await deps.editProject(async (check) => {
        outcomes.push(await apply(check))
      })
    } else {
      outcomes.push(await apply())
    }
  } catch (error: unknown) {
    deps.log.warn(`${LOG_PREFIX} the checkpoint lease failed (${importErrorCode(error)})`)
  }
  const [applied] = outcomes
  if (applied === undefined) {
    // The lease or the window's guard refused before any write.
    if (deps.isActive()) {
      deps.showWarning(UI_TEXT.agentImportNotApplied)
    }
    return
  }
  if (!deps.isActive()) {
    return
  }
  for (const failure of applied.failures) {
    deps.log.warn(
      `${LOG_PREFIX} ${shownPath(deps, failure.absolutePath)} could not be written (${failure.code})`,
    )
  }
  for (const write of applied.written) {
    deps.log.info(
      `${LOG_PREFIX} ${write.mode === 'create' ? 'created' : 'appended to'} ${shownPath(deps, write.absolutePath)}`,
    )
  }
  await offerCopies(deps, plan)
  if (!deps.isActive()) {
    return
  }
  const result: ImportPlan = {
    ...plan,
    writes: applied.written,
    skipped: [...plan.skipped, ...applied.skipped],
  }
  deps.log.info(
    `${LOG_PREFIX} finished with ${String(applied.written.length)} write(s), ${String(plan.copies.length)} file(s) to paste into, ${String(result.skipped.length)} entr(ies) not imported`,
  )
  const refused = applied.skipped.flatMap((skip) => {
    const candidate = selected.find((entry) => entry.id === skip.candidateId)
    return candidate === undefined ? [] : [`${candidate.label}: ${reasonLabel(skip.reason)}`]
  })
  // An import that wrote nothing and has nothing to paste says why, not that it finished.
  if (applied.written.length === 0 && plan.copies.length === 0 && refused.length > 0) {
    deps.showWarning(refused.join(LIST_SEPARATOR))
    return
  }
  deps.showInformation(
    [UI_TEXT.agentImportDone, countLines(result).join(DETAIL_SEPARATOR)].join(SENTENCE_SEPARATOR),
  )
  if (refused.length > 0) {
    deps.showWarning(refused.join(LIST_SEPARATOR))
  }
}

export async function importFromAgents(deps: AgentImportDeps): Promise<void> {
  let isBusy: boolean
  try {
    isBusy = !(await deps.gate(async () => {
      await runImport(deps)
    }))
  } catch (error: unknown) {
    // Every file and folder failure is handled where it happens; this is what was not foreseen.
    deps.log.warn(`${LOG_PREFIX} stopped on an unexpected error (${importErrorCode(error)})`)
    if (deps.isActive()) {
      deps.showWarning(UI_TEXT.agentImportFailed)
    }
    return
  }
  if (isBusy && deps.isActive()) {
    deps.showInformation(UI_TEXT.agentImportBusy)
  }
}

/** The whole flow: pickers, preview, confirmation, writes and clipboard/editor actions. */
async function runImport(deps: AgentImportDeps): Promise<void> {
  // Bind the request before either picker waits; the scan and accepted plan
  // must not acquire a replacement root after the user selected its entries.
  let project: ImportProjectRoot | undefined
  const root = deps.workspaceRoot
  if (root !== undefined && deps.isWorkspaceTrusted()) {
    try {
      project = { path: root, identity: await deps.writer.identifyRoot(root) }
    } catch (error: unknown) {
      deps.log.warn(
        `${LOG_PREFIX} the workspace folder could not be identified (${importErrorCode(error)})`,
      )
    }
  }
  const choice = await deps.pickSource()
  if (choice === undefined || !deps.isActive()) {
    return
  }
  const isTrusted = deps.isWorkspaceTrusted()
  if (!isTrusted && deps.workspaceRoot !== undefined) {
    deps.showWarning(UI_TEXT.agentImportUntrusted)
  }
  const mask = UI_TEXT.agentImportMasked
  const scan = await scanAgentImports({
    io: deps.io,
    platform: deps.platform,
    homeDir: deps.homeDir,
    claudeConfigDir: deps.claudeConfigDir,
    codexHome: deps.codexHome,
    workspaceRoot: deps.workspaceRoot,
    isWorkspaceTrusted: isTrusted,
    sources: choice === 'all' ? AGENT_IMPORT_SOURCES : [choice],
    mask,
  })
  for (const warning of scan.warnings) {
    deps.log.warn(`${LOG_PREFIX} ${warning}`)
  }
  if (scan.candidates.length === 0) {
    deps.showInformation(
      fill(UI_TEXT.agentImportNothing, {
        source: choice === 'all' ? UI_TEXT.agentImportSourceAll : sourceLabel(choice),
      }),
    )
    return
  }
  const picked = await deps.pickCandidates(
    scan.candidates.map((candidate) => pickItemOf(deps, candidate)),
  )
  if (picked === undefined || picked.length === 0) {
    return
  }
  const selected = scan.candidates.filter((candidate) => picked.includes(candidate.id))
  const plan = await planFor(deps, selected, project)
  if (!deps.isActive()) {
    return
  }
  await deps.openPreview(
    `${UI_TEXT.agentImportPreviewTitle}${PREVIEW_EXTENSION}`,
    previewMarkdown(deps, plan, selected, mask),
  )
  if (plan.writes.length === 0 && plan.copies.length === 0) {
    deps.showInformation(UI_TEXT.agentImportNoneImportable)
    return
  }
  const question = [UI_TEXT.agentImportConfirm, countLines(plan).join(DETAIL_SEPARATOR)].join(
    SENTENCE_SEPARATOR,
  )
  if (!(await deps.confirmImport(question))) {
    deps.log.info(`${LOG_PREFIX} the preview was not accepted; nothing was written`)
    return
  }
  if (!deps.isActive()) {
    return
  }
  if (
    !deps.isWorkspaceTrusted() &&
    (plan.writes.some((write) => write.isProject) ||
      plan.copies.some((copy) => copy.file === 'hooks'))
  ) {
    deps.showWarning(UI_TEXT.agentImportUntrusted)
    deps.log.info(`${LOG_PREFIX} workspace trust changed; the accepted import was not applied`)
    return
  }
  await applyPlan(deps, plan, selected)
}
