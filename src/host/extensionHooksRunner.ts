// The extension hook events that run on both backends (M91 lane E, PLAN.md
// D70): FileChanged, ConfigChange, Setup, Manual and DirectoryAdded. They
// fire from the window — its watchers, its folders, its commands — rather
// than a session, so the backend in use does not matter. Turn-bound events
// run in ModelApiHost; CwdChanged waits on lane S's kept shell directory
// and Elicitation on lane M's form flow, whose operations do not exist yet.
//
// Loaded lazily as dist/extensionHooks.js (its own D6 budget row), outside
// the Model API bundle. This module imports no `vscode`: all window I/O
// (files, processes, notices, output) arrives through deps, so unit tests
// drive it with fakes and the bundle gate keeps it out of activation.

import { randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import type { TabHookRun, TabHookState } from '../core/tab/tabHooks'
import type { ShellResult } from '../core/shellResult'
import { MILLISECONDS_PER_SECOND } from '../shared/constants'
import {
  configChangeFields,
  createFileChangedThrottle,
  directoryAddedFields,
  dispatchExtensionHooks,
  extensionHookPayload,
  fileChangedFields,
  isSetupTriggerMatch,
  loadSparkHookSnapshot,
  manualHooks,
  setupFields,
  manualFields,
  messageDisplayFields,
  isFileChangedWatched,
  isExtensionMatch,
  type ConfigChangeReason,
  type ExtensionHookContext,
  type ExtensionHookDefinition,
  type ExtensionHookDispatch,
  type ExtensionHookEvent,
  type ExtensionHookRunIo,
  type FileChangedThrottle,
  type SetupTrigger,
  type SparkHookSnapshot,
} from '../core/backends/modelapi/extensionHooks'
import type { HookLoadDeps } from '../core/backends/modelapi/hooks'
import type { ContextIo } from '../core/context/contextFiles'
import { isProtectedPath } from '../core/protectedPaths'
import { confineWorkspacePath, resolveWorkspacePath } from '../core/workspacePath'
import { pathModule } from '../core/workspaceRoot'

/** Segments a change is never reported under, whatever the matchers say. */
const SKIPPED_SEGMENTS: ReadonlySet<string> = new Set(['.git', 'node_modules'])

export interface ExtensionHookRunnerDeps {
  /** The hook files' bytes (fileContextIo in production). */
  readonly io: ContextIo
  /** The hook processes' runner (the tool IO's runHook in production). */
  readonly runHook: NonNullable<ExtensionHookRunIo['runHook']>
  readonly platform: NodeJS.Platform
  readonly workspaceRoot: string
  /** Muse Code's settings.json: the user's spark-hooks.json sits beside it. */
  readonly settingsPath: string
  /** The hook payloads' session: one per window, so a hook can tell windows apart. */
  readonly instanceId?: string | undefined
  readonly isWorkspaceTrusted: () => boolean
  /** The `museSpark.modelApiHooks` opt-in, read at each use. */
  readonly isHooksEnabled: () => boolean
  readonly now: () => number
  /**
   * Whether the path is listed (not gitignored, excluded or capped): the
   * mention index answers in production. False drops the change, so a save
   * storm in ignored output never spawns a process.
   */
  readonly isIndexed?: ((relativePath: string) => Promise<boolean>) | undefined
  /** A hook's own message, shown as a notice. */
  readonly notice: (level: 'info' | 'warning', text: string) => void
  /** A user-started run's bounded output. */
  readonly showOutput: (title: string, text: string) => void
  readonly warn: (message: string) => void
}

export interface ManualHookSummary {
  readonly command: string
  readonly description?: string | undefined
  readonly source: string
}

export interface SetupRunResult {
  readonly ran: number
  readonly output: string
  readonly failedReason?: string | undefined
}

export interface ManualRunResult {
  readonly matched: boolean
  readonly output: string
  readonly failedReason?: string | undefined
}

/** A workspace path as hooks match it: relative, forward slashes. */
export function hookRelativePath(
  workspaceRoot: string,
  absolutePath: string,
  platform: NodeJS.Platform,
): string | undefined {
  const resolution = resolveWorkspacePath(workspaceRoot, absolutePath, platform)
  return resolution.ok ? resolution.relative.split(pathModule(platform).sep).join('/') : undefined
}

function isSkippedPath(relativePath: string): boolean {
  return (
    isProtectedPath(relativePath) ||
    relativePath.split('/').some((segment) => SKIPPED_SEGMENTS.has(segment))
  )
}

const EMPTY_SNAPSHOT: SparkHookSnapshot = { hooks: [], invalidSources: [] }

export class ExtensionHookRunner {
  private readonly fileChangedThrottle: FileChangedThrottle = createFileChangedThrottle()
  private readonly hostSessionId: string
  private hooks: readonly ExtensionHookDefinition[] = []
  /** A scope's file is present but did not load whole: Tab reads refuse (RVM94KR 1). */
  private isTabConfigurationInvalid = false
  private version = 0
  /** Detected changes whose observer and reload have not finished (RVM94KR2 3). */
  private detections = 0
  private pendingReload: Promise<SparkHookSnapshot> | undefined

  public constructor(private readonly deps: ExtensionHookRunnerDeps) {
    this.hostSessionId = `host:${deps.instanceId ?? randomUUID()}`
  }

  private get loadDeps(): HookLoadDeps {
    return {
      io: this.deps.io,
      platform: this.deps.platform,
      settingsPath: this.deps.settingsPath,
      workspaceRoot: this.deps.workspaceRoot,
      isWorkspaceTrusted: this.deps.isWorkspaceTrusted,
      warn: this.deps.warn,
    }
  }

  private get context(): ExtensionHookContext {
    return { sessionId: this.hostSessionId, workspaceRoot: this.deps.workspaceRoot }
  }

  /** The gates every firing checks: a trusted workspace and the opt-in. */
  private isArmed(): boolean {
    return this.deps.isWorkspaceTrusted() && this.deps.isHooksEnabled()
  }

  private async waitForReload(): Promise<void> {
    while (this.pendingReload !== undefined) await this.pendingReload
  }

  /**
   * (Re)read spark-hooks.json beside Muse Code's sources, under the same
   * trust gate and opt-in as the Model API snapshot. Commands reload before
   * running, so an edit followed by Run Hook runs the new file; watchers run
   * the snapshot a config change left behind.
   */
  private async fire(
    event: ExtensionHookEvent,
    fields: Readonly<Record<string, unknown>>,
    matcherValue: string | undefined,
    hooks: readonly ExtensionHookDefinition[] = this.hooks,
  ): Promise<ExtensionHookDispatch> {
    const dispatch = await dispatchExtensionHooks({
      hooks,
      event,
      payload: extensionHookPayload(event, this.context, fields),
      matcherValue,
      io: { runHook: this.deps.runHook },
      cwd: this.deps.workspaceRoot,
      signal: undefined,
      warn: this.deps.warn,
      isAllowed: () => this.isArmed(),
    })
    for (const message of dispatch.messages) {
      this.deps.notice('info', message)
    }
    return dispatch
  }

  /**
   * A hook file or setting changed: the policy epoch moves now, before any
   * observer is awaited, and Tab refuses until the returned release runs
   * after the reload (RVM94KR2 3).
   */
  private detect(): () => void {
    this.version += 1
    this.detections += 1
    let isReleased = false
    return () => {
      if (isReleased) {
        return
      }
      isReleased = true
      this.detections -= 1
    }
  }

  /** Observes the change under the old snapshot, then reloads; the epoch already moved. */
  private async observeThenReload(
    fields: Readonly<Record<string, unknown>>,
    matcherValue: string | undefined,
  ): Promise<void> {
    const release = this.detect()
    try {
      await this.fire('ConfigChange', fields, matcherValue)
    } finally {
      try {
        await this.reload()
      } finally {
        release()
      }
    }
  }

  /** True from a change's detection until its reload has published. */
  public isReloading(): boolean {
    return this.detections > 0 || this.pendingReload !== undefined
  }

  public async reload(): Promise<void> {
    this.version += 1
    const version = this.version
    const pending =
      this.deps.isWorkspaceTrusted() && this.deps.isHooksEnabled()
        ? loadSparkHookSnapshot(this.loadDeps)
        : Promise.resolve(EMPTY_SNAPSHOT)
    this.pendingReload = pending
    try {
      const snapshot = await pending
      const kept = version === this.version && this.isArmed() ? snapshot : undefined
      if (kept !== undefined || !this.isArmed()) {
        this.hooks = kept?.hooks ?? []
        this.isTabConfigurationInvalid = (kept?.invalidSources.length ?? 0) > 0
      }
    } finally {
      if (this.pendingReload === pending) this.pendingReload = undefined
    }
  }

  public snapshot(): readonly ExtensionHookDefinition[] {
    return this.hooks
  }

  public configurationVersion(): string {
    return String(this.version)
  }

  /**
   * What the snapshot in force says about a Tab event (RVM94KR 1): a hook
   * file present but not loaded whole is `invalid`, and Tab reads nothing
   * until it is fixed; only no Tab hook at all is `absent`.
   */
  public async tabHookState(event: TabHookRun['event']): Promise<TabHookState> {
    if (this.detections > 0) return 'reloading'
    await this.waitForReload()
    if (this.detections > 0) return 'reloading'
    if (this.isTabConfigurationInvalid) return 'invalid'
    const matcher = event === 'beforeTabFileRead' ? 'TabRead' : 'TabWrite'
    return this.hooks.some(
      (hook) => hook.event === event && isExtensionMatch(hook.matcher, matcher, this.deps.warn),
    )
      ? 'present'
      : 'absent'
  }

  /** Raw endings: Tab decides before fail-open or onFailure handling can run. */
  public async runTab(request: TabHookRun): Promise<readonly ShellResult[] | undefined> {
    await this.waitForReload()
    // A configuration that did not load whole, or one still reloading, never
    // answers: undefined refuses.
    if (!this.isArmed() || this.isTabConfigurationInvalid || this.isReloading()) return undefined
    const selected = this.hooks.filter(
      (hook) =>
        hook.event === request.event &&
        isExtensionMatch(hook.matcher, request.matcherValue, this.deps.warn),
    )
    const payload = z.record(z.string(), z.unknown()).parse(JSON.parse(request.stdin))
    const version = this.version
    const results: ShellResult[] = []
    for (const hook of selected) {
      let stdin = request.stdin
      if (hook.foreign !== undefined) {
        if (hook.foreign.format !== 'cursor') return undefined
        const entry = await import('../core/backends/modelapi/foreignHooksEntry.js')
        const built = entry.buildForeignStdin('cursor', request.event, payload, {
          sourceEvent: hook.foreign.sourceEvent,
          workspaceRoot: this.deps.workspaceRoot,
          platform: this.deps.platform,
        })
        if (built.outcome !== 'run') return undefined
        stdin = built.stdin
      }
      if (!this.isArmed() || version !== this.version) return undefined
      // D121: no default deadline of ours — without an explicit per-hook
      // timeout the Tab request's own bound is the only deadline.
      const timeoutMs =
        hook.timeoutSeconds === undefined
          ? request.maxTimeoutMs
          : Math.min(request.maxTimeoutMs, hook.timeoutSeconds * MILLISECONDS_PER_SECOND)
      results.push(
        await this.deps.runHook(
          hook.command,
          stdin,
          this.deps.workspaceRoot,
          timeoutMs,
          AbortSignal.timeout(timeoutMs),
        ),
      )
    }
    return this.isArmed() && version === this.version ? results : undefined
  }

  /**
   * A workspace file changed (M91 lane E): observation only, debounced per
   * path and capped per minute, matcher-required, and it never starts a
   * model request. Drops what the hooks cannot want before any process
   * starts: paths outside the workspace, under .git or node_modules, on a
   * protected path, or unlisted (gitignored, excluded, capped).
   */
  public async noteWorkspaceFile(absolutePath: string): Promise<void> {
    if (!this.isArmed() || this.hooks.length === 0) {
      return
    }
    const relativePath = hookRelativePath(this.deps.workspaceRoot, absolutePath, this.deps.platform)
    if (
      relativePath === undefined ||
      isSkippedPath(relativePath) ||
      !isFileChangedWatched(this.hooks, relativePath)
    )
      return
    const confined = await confineWorkspacePath(
      this.deps.workspaceRoot,
      absolutePath,
      this.deps.platform,
      this.deps.io,
    )
    if (!confined.ok || isSkippedPath(confined.canonical)) return
    if (this.deps.isIndexed !== undefined && !(await this.deps.isIndexed(relativePath))) {
      return
    }
    const verdict = this.fileChangedThrottle.check(relativePath, this.deps.now())
    if (verdict !== 'fire') {
      return
    }
    await this.fire('FileChanged', fileChangedFields(relativePath, 'watcher'), relativePath)
  }

  /**
   * A settings or hook file changed (M91 lane E): observation only. The
   * change is observed under the config in effect when it happened; the new
   * config governs the next event.
   */
  public async noteConfigFile(absolutePath: string, reason: ConfigChangeReason): Promise<void> {
    if (!this.isArmed()) {
      return
    }
    const relativePath = hookRelativePath(this.deps.workspaceRoot, absolutePath, this.deps.platform)
    if (relativePath === undefined) {
      return
    }
    await this.observeThenReload(configChangeFields(relativePath, reason), relativePath)
  }

  /** Both backends' controller displays keep the original in history. */
  public async rewriteMessage(text: string): Promise<string | undefined> {
    if (!this.isArmed()) return undefined
    const dispatch = await this.fire('MessageDisplay', messageDisplayFields(text), undefined)
    return dispatch.displayText
  }

  /** Setting events have no file path; an empty path names the workspace root. */
  public async noteSettingsChange(): Promise<void> {
    if (!this.isArmed()) return
    await this.observeThenReload(configChangeFields('', 'settings'), undefined)
  }

  /**
   * A folder added to the window, or a trusted workspace activating (M91
   * lane E): observation only. A folder outside the first root is reported
   * as it is spelled, so an exact matcher still matches.
   */
  public async noteDirectoryAdded(absolutePath: string): Promise<void> {
    if (!this.isArmed() || this.hooks.length === 0) {
      return
    }
    const relativePath =
      hookRelativePath(this.deps.workspaceRoot, absolutePath, this.deps.platform) ?? absolutePath
    await this.fire('DirectoryAdded', directoryAddedFields(relativePath), relativePath)
  }

  /**
   * Run the Setup hooks for one trigger (M91 lane E): **Run Setup Hooks**
   * runs `init`, the ACP agent's `setup` runs `init` or `--maintenance`.
   * Observation; the bounded output is shown. Reloads first, so it runs
   * what the files say now.
   */
  public async runSetup(trigger: SetupTrigger): Promise<SetupRunResult> {
    await this.reload()
    if (!this.isArmed() || this.hooks.length === 0) {
      return { ran: 0, output: '' }
    }
    const matching = this.hooks.filter((hook) => isSetupTriggerMatch(hook, trigger))
    if (matching.length === 0) {
      return { ran: 0, output: '' }
    }
    const dispatch = await this.fire('Setup', setupFields(trigger), trigger)
    if (dispatch.output !== '') {
      this.deps.showOutput(`Setup ${trigger}`, dispatch.output)
    }
    return {
      ran: matching.length,
      output: dispatch.output,
      ...(dispatch.failedReason !== undefined && { failedReason: dispatch.failedReason }),
    }
  }

  /** The Manual hooks a Run Hook pick lists, by command. */
  public listManual(): readonly ManualHookSummary[] {
    return manualHooks(this.hooks).map((hook) => ({
      command: hook.command,
      ...(hook.description !== undefined && { description: hook.description }),
      source: hook.source,
    }))
  }

  /**
   * Run one Manual hook by its command, or by its description for
   * `/hook run <name>` (M91 lane E). The user starts it; observation; the
   * bounded output is shown. Reloads first, like Setup.
   */
  public async runManual(name: string): Promise<ManualRunResult> {
    await this.reload()
    const hook = manualHooks(this.isArmed() ? this.hooks : []).find(
      (candidate) => candidate.command === name || candidate.description === name,
    )
    if (hook === undefined) {
      return { matched: false, output: '' }
    }
    const dispatch = await this.fire('Manual', manualFields(hook.command), undefined, [hook])
    if (dispatch.output !== '') {
      this.deps.showOutput(hook.command, dispatch.output)
    }
    return {
      matched: true,
      output: dispatch.output,
      ...(dispatch.failedReason !== undefined && { failedReason: dispatch.failedReason }),
    }
  }
}
