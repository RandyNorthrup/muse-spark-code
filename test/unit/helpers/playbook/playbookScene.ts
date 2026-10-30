// The playbook suites' shared real composition (RLF-PLAYBOOK): a window over
// the real worker code behind an in-process thread that copies every
// message, over a real journal and a real git repository (and, on Windows,
// the real contained job), with the counted-review driver the suites set
// their scenes up with. Each suite file runs in its own worker, so this
// module's template and tracking belong to the file that imported it.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, vi } from 'vitest'
import { PLAYBOOK_RECORD_FOLDER } from '../../../../src/shared/constants'
import type { ReviewFinding } from '../../../../src/shared/reviewFindings'
import type { PanelChild } from '../../../../src/core/orchestration/panelLanes'
import {
  createPlaybookWindow,
  type PlaybookConversationEvents,
  type PlaybookWindow,
  type PlaybookWindowDeps,
} from '../../../../src/host/playbook/playbookWindow'
import { servePlaybook } from '../../../../src/host/playbook/playbookWorker'
import { playbookSnapshotSchema } from '../../../../src/runtime/playbook/command'
import type { PanelModuleSummary } from '../../../../src/runtime/playbook/governor'
import { compiledJobAssembly, SYSTEM_ROOT } from './jobAssembly'
import { keepCalls } from './keepCalls'
import { thread } from './workerThread'
import {
  coveredReview,
  GOVERNED_ROUND_TIMEOUT_MS,
  panelRepository,
  panelRepositoryTemplate,
  reviewReply,
  turnEnd,
  type PanelRepository,
} from './panelRepository'
import { removeFolder } from '../temporaryFolders'

const IS_WINDOWS = process.platform === 'win32'

const shared: {
  template?: ReturnType<typeof panelRepositoryTemplate>
  storage?: string
  assembly?: string
} = {}
const open: { remove(): void }[] = []
const windows: { dispose(): void }[] = []

export async function setupPlaybookScene(): Promise<void> {
  shared.template = panelRepositoryTemplate()
  if (!IS_WINDOWS) return
  shared.storage = await mkdtemp(path.join(tmpdir(), 'muse-playbook-scene-'))
  shared.assembly = await compiledJobAssembly(shared.storage)
}

export function releasePlaybookScene(): void {
  for (const window of windows.splice(0)) window.dispose()
  for (const repository of open.splice(0)) repository.remove()
}

export async function teardownPlaybookScene(): Promise<void> {
  shared.template?.remove()
  if (shared.storage !== undefined) await removeFolder(shared.storage)
}

/** A window the scene tracks for the file's own teardown. */
export function trackWindow(window: { dispose(): void }): void {
  windows.push(window)
}

export function recordedLog() {
  const lines: string[] = []
  const keep = (level: string) => (message: string) => {
    lines.push(`${level}: ${message}`)
  }
  return {
    lines,
    log: { trace: keep('trace'), info: keep('info'), warn: keep('warn'), error: keep('error') },
  }
}

/**
Waits out real decisions: each is real git processes, and on Windows a
job helper's start as well, which is seconds when PowerShell starts cold.
*/
export async function eventually(assertion: () => void | Promise<void>): Promise<void> {
  await vi.waitFor(assertion, { timeout: GOVERNED_ROUND_TIMEOUT_MS / 2 })
}

/** What a request was refused with; undefined when it was not refused. */
export async function refusalOf(request: Promise<unknown>): Promise<unknown> {
  try {
    await request
  } catch (error) {
    return error
  }
  return undefined
}

export function subscriber(): {
  [K in keyof PlaybookConversationEvents]: PlaybookConversationEvents[K] & {
    calls: Parameters<PlaybookConversationEvents[K]>[]
  }
} {
  return {
    note: keepCalls<
      Parameters<PlaybookConversationEvents['note']>,
      ReturnType<PlaybookConversationEvents['note']>
    >(() => undefined),
    offer: keepCalls<
      Parameters<PlaybookConversationEvents['offer']>,
      ReturnType<PlaybookConversationEvents['offer']>
    >(() => undefined),
    rounds: keepCalls<
      Parameters<PlaybookConversationEvents['rounds']>,
      ReturnType<PlaybookConversationEvents['rounds']>
    >(() => undefined),
    hookOutput: keepCalls<
      Parameters<PlaybookConversationEvents['hookOutput']>,
      ReturnType<PlaybookConversationEvents['hookOutput']>
    >(() => undefined),
    failure: keepCalls<
      Parameters<PlaybookConversationEvents['failure']>,
      ReturnType<PlaybookConversationEvents['failure']>
    >(() => undefined),
  }
}

/** A window over the real worker code, a real journal and a real repository. */
export function liveScene(sessionId: string, overrides: Partial<PlaybookWindowDeps> = {}) {
  if (shared.template === undefined) throw new Error('The repository template was not made')
  const repository: PanelRepository = panelRepository(shared.template.directory)
  open.push(repository)
  const recorded = recordedLog()
  const threads: ReturnType<typeof thread>[] = []
  const startWorker = keepCalls<
    Parameters<PlaybookWindowDeps['startWorker']>,
    ReturnType<PlaybookWindowDeps['startWorker']>
  >((_file, data) => {
    const boundary = thread()
    threads.push(boundary)
    servePlaybook(boundary.port, structuredClone(data))
    return boundary.handle
  })
  const window = createPlaybookWindow({
    bundlePath: 'dist/playbook.js',
    startWorker,
    agentDataFolder: repository.dataFolder,
    workspaceRoot: repository.workspace,
    isWorkspaceTrusted: () => true,
    platform: process.platform,
    systemRoot: IS_WINDOWS ? SYSTEM_ROOT : undefined,
    shellJobAssembly: IS_WINDOWS ? () => Promise.resolve(shared.assembly) : undefined,
    reviewCharter: (targets) =>
      `charter for ${targets.map((target) => target.moduleKey).join(', ')}`,
    log: recorded.log,
    ...overrides,
  })
  windows.push(window)
  const events = subscriber()
  window.subscribe(sessionId, events)
  return { repository, window, startWorker, threads, events, ...recorded }
}

/** One whole counted review through the window, as the controller drives it. */
export async function reviewedChild(
  scene: { readonly window: PlaybookWindow },
  sessionId: string,
  turnId: string,
  child: PanelChild,
  files: readonly string[],
  race: ReviewFinding,
): Promise<readonly PanelModuleSummary[]> {
  const rounds: PanelModuleSummary[][] = []
  const stop = scene.window.subscribe(sessionId, {
    note: () => undefined,
    offer: () => undefined,
    rounds: (counted) => {
      rounds.push([...counted])
    },
    hookOutput: () => undefined,
    failure: () => undefined,
  })
  try {
    const ticket = await scene.window.openReview(sessionId, files, [child])
    if (ticket === undefined) throw new Error('A playbook review was expected')
    ticket.observe(reviewReply(turnId, coveredReview([race])))
    ticket.observe(turnEnd(turnId))
    ticket.bind(turnId)
    await eventually(() => {
      expect(rounds.length).toBeGreaterThan(0)
    })
    expect(ticket.isClosed).toBe(true)
    return rounds.at(-1) ?? []
  } finally {
    stop()
  }
}

export async function answeredReview(
  scene: { readonly window: PlaybookWindow },
  sessionId: string,
  rounds: readonly PanelModuleSummary[],
): Promise<void> {
  for (const round of rounds)
    await expect(
      scene.window.answer(
        sessionId,
        round.moduleId,
        round.findings.map((finding) => ({ findingId: finding.id, status: 'fixed' as const })),
      ),
    ).resolves.toBe(true)
}

/** A data folder that already holds journals, so a dispatch is asked about. */
export function journalFolder(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'muse-playbook-journals-'))
  mkdirSync(path.join(folder, PLAYBOOK_RECORD_FOLDER), { recursive: true })
  open.push({
    remove: () => {
      rmSync(folder, { recursive: true, force: true })
    },
  })
  return folder
}

/** Every lease record's status, oldest first; the journal is append-only. */
export async function sceneLeases(scene: {
  readonly window: PlaybookWindow
}): Promise<readonly string[]> {
  const snapshot = playbookSnapshotSchema.parse(await scene.window.surface.read())
  return snapshot.records
    .filter((record) => record.kind === 'lease')
    .map((record) => record.value.status)
}
