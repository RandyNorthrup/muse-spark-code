// `Muse Spark: Import from Other Agents` (M83, PLAN.md D49): MCP servers,
// hooks, custom agents, slash commands and rules files from Claude Code,
// Codex and Cursor, converted to Muse Code's shapes.
//
// Preview metadata, then publish exposure-preserving files or offer unsaved
// target edits. Logs carry counts and fixed reasons only (PLAN.md D64).
// Every VS Code and filesystem interaction is injected. No model call.

import { decodeContextText } from '../../core/context/contextFiles'
import {
  applyImportWrites,
  copyForCurrentFile,
  type ImportApplyResult,
  type ImportCandidate,
  type ImportCopy,
  type ImportScanInput,
  importDisplayPath,
  importExposure,
  exposureRefusal,
  importErrorCode,
  type ImportPlan,
  type ImportPlanFile,
  type ImportPlanState,
  type ImportProjectRoot,
  type ImportRead,
  type ImportSkip,
  type ImportSkipReason,
  type ImportWriter,
  type ImportWriteNotice,
  planImportApply,
  scanAgentImports,
} from '../../core/import/agentImport'
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

export interface AgentImportDeps extends Omit<ImportScanInput, 'sources'> {
  /** Muse Code's settings file where `muse serve` reads it; its folder holds the personal skills. */
  readonly museSettingsFile: string
  /**
   * The window's first folder as VS Code names it now. The approval wait can
   * outlast a change to it, so a write compares it with the folder the plan
   * was made for.
   */
  readonly currentRoot: () => string | undefined
  readonly writer: ImportWriter
  /** The session-owned workspace notice for a project write (M68); absent without a live session. */
  readonly beginProjectEdit?: ImportWriteNotice
  /**
   * Holds the checkpoint lease (M86) until `work` settles, so no restore
   * runs over the import's project writes; `check` throws once the window
   * or the root it was taken for is gone. Runs only for project writes.
   */
  readonly editProject: <T>(work: (check: () => void) => Promise<T>) => Promise<T>
  /** Refuses a project publication in checkpoint storage (M86); records no bytes. */
  readonly beforeProjectWrite: (absolutePath: string) => void | Promise<void>
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
  /** Offers an unsaved edit in the target, or opens it without changing it. */
  readonly offerEdit: (message: string) => Promise<'edit' | 'open' | undefined>
  /**
   * Opens the file in an editor: loads the document, then asks `isStillSafe`
   * before it is shown (the load awaits); one that does not exist opens
   * unsaved at its path, for the user to save.
   */
  readonly openTarget: (
    absolutePath: string,
    isExisting: boolean,
    isStillSafe: () => Promise<boolean>,
    canApply: () => boolean,
    text: string | undefined,
  ) => Promise<boolean>
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
    case 'personalToProject': {
      return UI_TEXT.agentImportPersonalToProject
    }
    case 'ignoredToTracked': {
      return UI_TEXT.agentImportIgnoredToTracked
    }
  }
}

function skipLabel(skip: ImportSkip): string {
  return reasonLabel(skip.reason)
}

/** Undefined for a source outside home and workspace (or unclassified): its refusal says why. */
function sourceScope(candidate: ImportCandidate): string | undefined {
  const scope = candidate.sourceExposure
  if (scope === undefined) return undefined
  return scope === 'personal' ? UI_TEXT.agentImportUserFiles : UI_TEXT.agentImportProjectFiles
}

function describeCandidate(candidate: ImportCandidate): string {
  return [kindLabel(candidate), sourceLabel(candidate.source), sourceScope(candidate)]
    .filter((part) => part !== undefined)
    .join(DETAIL_SEPARATOR)
}

function shownPath(deps: AgentImportDeps, absolutePath: string): string {
  return importDisplayPath(absolutePath, deps)
}

/** Picker details show source scope only. Names remain as the source tool names them. */
function pickItemOf(candidate: ImportCandidate): AgentImportPickItem {
  const where = sourceScope(candidate)
  const { target } = candidate
  let why: string | undefined
  if (target.kind === 'none') {
    why = reasonLabel(target.reason)
  }
  return {
    id: candidate.id,
    label: candidate.label,
    description: describeCandidate(candidate),
    detail: [where, why].filter((part) => part !== undefined).join(DETAIL_SEPARATOR),
    picked: target.kind !== 'none',
  }
}

/** Preview metadata only: imported content has exactly one allowed destination. */
function previewMarkdown(
  deps: AgentImportDeps,
  plan: ImportPlan,
  selected: readonly ImportCandidate[],
  hasSkippedFiles: boolean,
): string {
  const blocks = [
    `# ${UI_TEXT.agentImportPreviewTitle}`,
    UI_TEXT.agentImportPreviewIntro,
    ...(hasSkippedFiles ? [UI_TEXT.agentImportSkippedFiles] : []),
  ]
  const byId = new Map(selected.map((candidate) => [candidate.id, candidate] as const))
  for (const destination of [...plan.writes, ...plan.copies]) {
    blocks.push(`## ${shownPath(deps, destination.absolutePath)}`)
    if (plan.hasLegacyMcpKey && destination.absolutePath === deps.museSettingsFile)
      blocks.push(UI_TEXT.agentImportPreviewLegacyKey)
    for (const id of destination.candidateIds) {
      const candidate = byId.get(id)
      if (candidate === undefined) continue
      blocks.push(`- ${candidate.label} (${describeCandidate(candidate)})`)
      if (candidate.dropped.length > 0)
        blocks.push(
          fill(UI_TEXT.agentImportPreviewDropped, {
            fields: candidate.dropped.join(LIST_SEPARATOR),
          }),
        )
    }
  }
  if (plan.skipped.length > 0) blocks.push(`## ${UI_TEXT.agentImportPreviewNotImported}`)
  for (const skipped of plan.skipped) {
    const candidate = byId.get(skipped.candidateId)
    if (candidate !== undefined)
      blocks.push(
        `- ${candidate.label} (${describeCandidate(candidate)}): ${reasonLabel(skipped.reason)}`,
      )
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
    deps.log.warn(`${LOG_PREFIX}  could not be resolved (failed)`)
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
  if (!deps.isActive() || (isProject && !deps.isWorkspaceTrusted())) {
    return { status: 'outside' }
  }
  if (isProject && (await projectStanding(deps, absolutePath, project)) !== 'inside') {
    deps.log.warn(`${LOG_PREFIX}  is unsafe or outside the workspace`)
    return { status: 'outside' }
  }
  if (!deps.isActive() || (isProject && !deps.isWorkspaceTrusted())) {
    return { status: 'outside' }
  }
  let read: ImportRead
  try {
    read = await deps.io.readFile(absolutePath, maxBytes, isProject ? project?.path : undefined)
  } catch {
    deps.log.warn(`${LOG_PREFIX}  could not be read (failed)`)
    return { status: 'unreadable' }
  }
  if (read.status === 'missing') {
    return { status: 'missing' }
  }
  const decoded = read.status === 'read' ? decodeContextText(read.bytes) : undefined
  if (decoded?.ok !== true) {
    deps.log.warn(`${LOG_PREFIX}  could not be read (unreadable)`)
    return { status: 'unreadable' }
  }
  return { status: 'read', text: decoded.text }
}

function countLines(plan: ImportPlan, refusedCopyEntries = 0): readonly string[] {
  const creates = plan.writes.filter((write) => write.mode === 'create').length
  const sections = plan.writes
    .filter((write) => write.mode === 'append')
    .reduce((total, write) => total + write.candidateIds.length, 0)
  const copied = plan.copies.reduce((total, copy) => total + copy.candidateIds.length, 0)
  return [
    fill(UI_TEXT.agentImportCountFiles, { count: formatNumber(creates) }),
    fill(UI_TEXT.agentImportCountSections, { count: formatNumber(sections) }),
    fill(UI_TEXT.agentImportCountCopies, { count: formatNumber(copied) }),
    fill(UI_TEXT.agentImportCountSkipped, {
      count: formatNumber(plan.skipped.length + refusedCopyEntries),
    }),
  ]
}

/** Each config opens as an unsaved target edit; no clipboard or preview content. */
async function offerCopies(
  deps: AgentImportDeps,
  plan: ImportPlan,
): Promise<{
  readonly offered: readonly ImportCopy[]
  readonly refused: readonly ImportCopy[]
}> {
  const offered: ImportCopy[] = []
  const refused: ImportCopy[] = []
  for (const copy of plan.copies) {
    if (!deps.isActive()) break
    const choice = await deps.offerEdit(
      fill(UI_TEXT.agentImportEditPrompt, { path: shownPath(deps, copy.absolutePath) }),
    )
    if (choice === undefined) {
      refused.push(copy)
      continue
    }
    if (!(await isCopyTargetSafe(deps, copy, plan.projectRoot))) {
      refused.push(copy)
      continue
    }
    const isExisting = await deps.isPresent(copy.absolutePath)
    const currentCopy = copyForCurrentFile(copy, !isExisting)
    const target = { isStillSafe: true }
    const isStillSafe = async (): Promise<boolean> => {
      const isSafe = await isCopyTargetSafe(deps, currentCopy, plan.projectRoot)
      target.isStillSafe &&= isSafe
      return isSafe
    }
    const canApply = (): boolean => {
      const isSafe =
        deps.isActive() &&
        (!copy.isProject ||
          (deps.isWorkspaceTrusted() &&
            plan.projectRoot !== undefined &&
            isLiveRoot(deps, plan.projectRoot.path)))
      target.isStillSafe &&= isSafe
      return isSafe
    }
    if (!(await isStillSafe()) || !canApply()) {
      refused.push(copy)
      continue
    }
    const didOpen = await deps.openTarget(
      copy.absolutePath,
      isExisting,
      isStillSafe,
      canApply,
      choice === 'edit' ? currentCopy.text : undefined,
    )
    if (choice === 'edit' && didOpen && target.isStillSafe) offered.push(currentCopy)
    else refused.push(copy)
  }
  return { offered, refused }
}

async function isCopyTargetSafe(
  deps: AgentImportDeps,
  copy: ImportCopy,
  project: ImportProjectRoot | undefined,
): Promise<boolean> {
  if (!deps.isActive()) {
    return false
  }
  const isExposureSafe = async (): Promise<boolean> => {
    try {
      const targetExposure = await importExposure(copy.absolutePath, { ...deps, io: deps.io })
      const reason =
        exposureRefusal(copy.sourceExposure, targetExposure) ??
        (targetExposure !== 'personal' && !copy.isProject ? 'changed' : undefined)
      if (reason !== undefined) {
        deps.showWarning(reasonLabel(reason))
        deps.log.warn(`${LOG_PREFIX} config edit refused (${reason})`)
        return false
      }
    } catch {
      deps.showWarning(UI_TEXT.agentImportSkippedUnreadable)
      return false
    }
    return true
  }
  if (!copy.isProject) return deps.isActive() && (await isExposureSafe())
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
    return await isExposureSafe()
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
    // The identity was awaited: the window may show another folder by now,
    // and what was identified is only the folder it showed before.
    return (
      isLiveRoot(deps, live) &&
      isSamePath(now.canonical, project.identity.canonical, deps.platform) &&
      now.fileId === project.identity.fileId
    )
  } catch {
    deps.log.warn(`${LOG_PREFIX} the workspace folder could not be resolved (failed)`)
    return false
  }
}

/** Whether the window's first folder is still the one named `root`; synchronous, so no await can come between. */
function isLiveRoot(deps: AgentImportDeps, root: string): boolean {
  const live = deps.currentRoot()
  return live !== undefined && isSamePath(live, root, deps.platform)
}

async function hooksFileState(
  deps: AgentImportDeps,
  hooksFile: string | undefined,
  project: ImportProjectRoot | undefined,
): Promise<ImportPlanState['hooksFile']> {
  if (
    hooksFile === undefined ||
    !deps.isActive() ||
    !deps.isWorkspaceTrusted() ||
    (await projectStanding(deps, hooksFile, project)) !== 'inside' ||
    !deps.isActive() ||
    !deps.isWorkspaceTrusted()
  ) {
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
      homeDir: deps.homeDir,
      workspaceRoot: root,
      ...(deps.workspaceRoots !== undefined && { workspaceRoots: deps.workspaceRoots }),
      workspaceIdentity: project?.identity,
      personalRoot: p.dirname(deps.museSettingsFile),
      museSettingsFile: deps.museSettingsFile,
    },
    {
      io: deps.io,
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
        if (!isProject) return
        if (plan.projectRoot === undefined || !isLiveRoot(deps, plan.projectRoot.path))
          throw Object.assign(new Error('Import folder changed'), {
            code: AGENT_IMPORT_ROOT_CHANGED_CODE,
          })
        check?.()
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
  } catch {
    deps.log.warn(`${LOG_PREFIX} the checkpoint lease failed (failed)`)
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
  if (applied.failures.length > 0)
    deps.log.warn(`${LOG_PREFIX} ${String(applied.failures.length)} writes failed`)

  const copies = await offerCopies(deps, plan)
  if (!deps.isActive()) {
    return
  }
  const result: ImportPlan = {
    ...plan,
    writes: applied.written,
    copies: copies.offered,
    skipped: [...plan.skipped, ...applied.skipped],
  }
  const refusedCopyEntries = copies.refused.reduce(
    (total, copy) => total + copy.candidateIds.length,
    0,
  )
  const notImported = result.skipped.length + refusedCopyEntries
  deps.log.info(
    `${LOG_PREFIX} finished with ${String(applied.written.length)} write(s), ${String(result.copies.length)} file(s) offered in editor, ${String(notImported)} entr(ies) not imported`,
  )
  const refused = applied.skipped.flatMap((skip) => {
    const candidate = selected.find((entry) => entry.id === skip.candidateId)
    return candidate === undefined ? [] : [`${candidate.label}: ${skipLabel(skip)}`]
  })
  // An import that wrote nothing and has no editor edit says why, not that it finished.
  const counts = countLines(result, refusedCopyEntries).join(DETAIL_SEPARATOR)
  if (
    applied.written.length === 0 &&
    result.copies.length === 0 &&
    (refused.length > 0 || refusedCopyEntries > 0)
  ) {
    deps.showWarning(
      refusedCopyEntries > 0
        ? [...refused, counts].join(LIST_SEPARATOR)
        : refused.join(LIST_SEPARATOR),
    )
    return
  }
  deps.showInformation([UI_TEXT.agentImportDone, counts].join(SENTENCE_SEPARATOR))
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
  } catch {
    // Every file and folder failure is handled where it happens; this is what was not foreseen.
    deps.log.warn(`${LOG_PREFIX} stopped on an unexpected error (failed)`)
    if (deps.isActive()) {
      deps.showWarning(UI_TEXT.agentImportFailed)
    }
    return
  }
  if (isBusy && deps.isActive()) {
    deps.showInformation(UI_TEXT.agentImportBusy)
  }
}

/** The whole flow: pickers, preview, confirmation, writes and target editor actions. */
async function runImport(deps: AgentImportDeps): Promise<void> {
  if (!deps.isActive()) {
    return
  }
  // Bind the request before either picker waits; the scan and accepted plan
  // must not acquire a replacement root after the user selected its entries.
  let project: ImportProjectRoot | undefined
  const root = deps.workspaceRoot
  if (root !== undefined && deps.isWorkspaceTrusted()) {
    try {
      project = { path: root, identity: await deps.writer.identifyRoot(root) }
    } catch {
      deps.log.warn(`${LOG_PREFIX} the workspace folder could not be identified (failed)`)
    }
  }
  if (!deps.isActive()) {
    return
  }
  const choice = await deps.pickSource()
  if (choice === undefined || !deps.isActive()) {
    return
  }
  const isTrusted = deps.isWorkspaceTrusted()
  if (!isTrusted && deps.workspaceRoot !== undefined) {
    deps.showWarning(UI_TEXT.agentImportUntrusted)
  }
  const scan = await scanAgentImports({
    io: deps.io,
    platform: deps.platform,
    homeDir: deps.homeDir,
    claudeConfigDir: deps.claudeConfigDir,
    codexHome: deps.codexHome,
    workspaceRoot: deps.workspaceRoot,
    ...(deps.workspaceRoots !== undefined && { workspaceRoots: deps.workspaceRoots }),
    isWorkspaceTrusted: deps.isWorkspaceTrusted,
    isActive: deps.isActive,
    sources: choice === 'all' ? AGENT_IMPORT_SOURCES : [choice],
  })
  if (!deps.isActive()) {
    return
  }
  for (const warning of scan.warnings) {
    deps.log.warn(`${LOG_PREFIX} ${warning}`)
  }
  const hasSkippedFiles = scan.warnings.length > 0
  if (scan.candidates.length === 0) {
    deps.showInformation(
      [
        fill(UI_TEXT.agentImportNothing, {
          source: choice === 'all' ? UI_TEXT.agentImportSourceAll : sourceLabel(choice),
        }),
        ...(hasSkippedFiles ? [UI_TEXT.agentImportSkippedFiles] : []),
      ].join(SENTENCE_SEPARATOR),
    )
    return
  }
  const picked = await deps.pickCandidates(
    scan.candidates.map((candidate) => pickItemOf(candidate)),
  )
  if (picked === undefined || picked.length === 0 || !deps.isActive()) {
    return
  }
  const selected = scan.candidates.filter((candidate) => picked.includes(candidate.id))
  const plan = await planFor(deps, selected, project)
  if (!deps.isActive()) {
    return
  }
  await deps.openPreview(
    `${UI_TEXT.agentImportPreviewTitle}${PREVIEW_EXTENSION}`,
    previewMarkdown(deps, plan, selected, hasSkippedFiles),
  )
  if (!deps.isActive()) {
    return
  }
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
    (plan.writes.some((write) => write.isProject) || plan.copies.some((copy) => copy.isProject))
  ) {
    deps.showWarning(UI_TEXT.agentImportUntrusted)
    deps.log.info(`${LOG_PREFIX} workspace trust changed; the accepted import was not applied`)
    return
  }
  await applyPlan(deps, plan, selected)
}
