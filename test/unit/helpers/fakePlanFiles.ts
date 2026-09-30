// Saved plans in memory (M79): the host's plan files over a map of files,
// with the Plans… pick and the save's yes scripted, for the conversation tests.

import path from 'node:path'
import { vi } from 'vitest'
import type { PlanMarkdown } from '../../../src/core/plans/planDocument'
import { PLAN_MARKDOWN } from '../../../src/core/plans/planMarkdown'
import type { PlanDirectoryEntry, PlanIo, PlanSummary } from '../../../src/core/plans/planStore'
import type { PlanChoice, PlanFiles } from '../../../src/host/conversation/conversationController'
import { createPlanFiles } from '../../../src/host/planFeatures'

export interface FakePlanFiles {
  readonly plans: PlanFiles
  /** The files by absolute POSIX path, as written. */
  readonly files: Map<string, string>
  readonly confirmSave: ReturnType<typeof vi.fn<() => Promise<boolean>>>
  readonly choose: ReturnType<
    typeof vi.fn<(plans: readonly PlanSummary[]) => Promise<PlanChoice | undefined>>
  >
  /** The plan reader: the source module, unless a test makes it fail to load. */
  readonly markdown: ReturnType<typeof vi.fn<() => PlanMarkdown>>
}

function memoryPlanIo(files: Map<string, string>): PlanIo {
  return {
    realPath: (absolutePath) => Promise.resolve(absolutePath),
    createFile: (absolutePath, content) => {
      if (files.has(absolutePath)) {
        return Promise.resolve(false)
      }
      files.set(absolutePath, content)
      return Promise.resolve(true)
    },
    readFile: (absolutePath, maxBytes) => {
      const text = files.get(absolutePath)
      const bytes = text === undefined ? undefined : new TextEncoder().encode(text)
      return Promise.resolve({
        bytes: bytes !== undefined && bytes.byteLength <= maxBytes ? bytes : undefined,
        isPdf: false,
      })
    },
    // A map leaves no stages behind.
    removeStaleStages: () => Promise.resolve(),
    listEntries: (absolutePath) => {
      const entries: PlanDirectoryEntry[] = []
      for (const file of files.keys()) {
        if (path.posix.dirname(file) === absolutePath) {
          entries.push({ name: path.posix.basename(file), kind: 'file' })
        }
      }
      return Promise.resolve(entries)
    },
  }
}

/**
 * The host's plan files over `workspaceRoot` (POSIX) in memory, each save
 * said yes to and every pick dismissed unless a test says otherwise.
 */
export function fakePlanFiles(workspaceRoot = '/ws'): FakePlanFiles {
  const files = new Map<string, string>()
  const confirmSave = vi.fn<() => Promise<boolean>>(() => Promise.resolve(true))
  const choose = vi.fn<(plans: readonly PlanSummary[]) => Promise<PlanChoice | undefined>>(() =>
    Promise.resolve(undefined),
  )
  const markdown = vi.fn<() => PlanMarkdown>(() => PLAN_MARKDOWN)
  const host = createPlanFiles({
    workspaceRoot,
    platform: 'linux',
    io: memoryPlanIo(files),
    // The tests answer the save's modal and the picks through the spies below.
    pick: () => Promise.reject(new Error('the test answers through choose')),
    confirm: () => Promise.reject(new Error('the test answers through confirmSave')),
    markdown,
  })
  return { files, confirmSave, choose, markdown, plans: { ...host, confirmSave, choose } }
}
