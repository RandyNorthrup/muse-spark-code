// Shared fixtures for the resource journal's review regressions (RVM107W2,
// RVM107W2G): temporary data folders, the window host's recorder, and what
// the journal holds on disk.
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { vi } from 'vitest'
import { configureResources } from '../../../../src/core/resources/admission'
import { RESOURCE_JOURNAL_ROOT, ResourceJournal } from '../../../../src/core/usage/resourceJournal'
import { NodeUsageFs } from '../../../../src/runtime/usage/nodeUsageFs'
import { createUsageAccess } from '../../../../src/runtime/usage/usageServiceEntry'
import { EN } from '../../../../src/shared/l10n/en'
import { FakeLogOutputChannel } from '../fakes'
import { removeFolder } from '../temporaryFolders'

const DAY_NAME = /^\d{4}-\d{2}-\d{2}$/u

/** Data folders under temp/; `cleanup` (in afterEach) removes every one created. */
export function temporaryFolders(prefix: string) {
  const folders: string[] = []
  return {
    create: async (): Promise<string> => {
      await mkdir('temp', { recursive: true })
      const folder = await mkdtemp(path.resolve(`temp/${prefix}-`))
      folders.push(folder)
      return folder
    },
    cleanup: async (): Promise<void> => {
      for (const folder of folders.splice(0)) await removeFolder(folder)
    },
  }
}

export function resourcesRoot(folder: string): string {
  return path.join(folder, ...RESOURCE_JOURNAL_ROOT.split('/'))
}

async function names(folder: string): Promise<string[]> {
  try {
    return await readdir(folder)
  } catch {
    return []
  }
}

/** Every complete minute line in the journal's day files (not the live file), from disk. */
export async function journalMinuteLines(folder: string): Promise<string[]> {
  const lines: string[] = []
  const days = await names(resourcesRoot(folder))
  for (const day of days) {
    if (!DAY_NAME.test(day)) continue
    const files = await readdir(path.join(resourcesRoot(folder), day))
    for (const file of files) {
      const text = await readFile(path.join(resourcesRoot(folder), day, file), 'utf8')
      lines.push(...text.split('\n').filter((line) => line.includes('"minute":{')))
    }
  }
  return lines
}

/** The live minute files on disk. */
export function liveFiles(folder: string): Promise<string[]> {
  return names(path.join(resourcesRoot(folder), 'live'))
}

/** A stored day folder `2026-01-01` holding one journal file; returns its path. */
export async function storedDay(folder: string): Promise<string> {
  const day = path.join(resourcesRoot(folder), '2026-01-01')
  await mkdir(day, { recursive: true })
  await writeFile(path.join(day, 'w.0.jsonl'), 'secret-history\n')
  return day
}

/** A recording window journal on `folder`, optionally bound to a reset boundary. */
export function windowJournal(folder: string, resetAtMs?: () => number): ResourceJournal {
  return new ResourceJournal(new NodeUsageFs(folder), {
    writerId: 'window',
    now: Date.now,
    isEnabled: () => true,
    ...(resetAtMs !== undefined && { resetAtMs }),
  })
}

/** The VS Code window host's governor, recording history into `folder`; returns dispose. */
export function configureWindowHistory(folder: string): () => void {
  return configureResources({
    inspect: () => undefined,
    onError: vi.fn(),
    history: { dataFolder: folder, isEnabled: () => true },
    tempRoots: {
      create: (owner) =>
        Promise.resolve({
          root: path.join(folder, owner),
          profile: path.join(folder, owner, 'profile'),
          cache: path.join(folder, owner, 'cache'),
          environment: {},
          finish: () => Promise.resolve(),
        }),
    },
  })
}

function access(folder: string) {
  return createUsageAccess({
    dataFolder: folder,
    packageRoot: process.cwd(),
    host: 'VS Code',
    locale: 'en',
    uiText: EN,
    log: new FakeLogOutputChannel(),
  })
}
/** Delete history through the production usage page connection. */
export function deleteThroughPage(folder: string): { posted: unknown[]; done: Promise<void> } {
  const posted: unknown[] = []
  const connection = access(folder).connect({
    post: (message) => {
      posted.push(message)
    },
    confirmDelete: () => Promise.resolve(true),
  })
  return { posted, done: connection.receive({ type: 'usage/deleteHistory', requestId: 'delete' }) }
}
/** Polls `isDone` every 20 ms for at most `limitMs`. */
export async function waitUntil(isDone: () => Promise<boolean>, limitMs: number): Promise<void> {
  const deadline = Date.now() + limitMs
  while (Date.now() < deadline) {
    if (await isDone()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
