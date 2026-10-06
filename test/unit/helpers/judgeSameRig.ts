// Shared rig for the lane M98-S adapter suites: a settling spy over lane J's
// entry store, exact-action entry starts, a settle waiter, one judge call
// that waits for its settle, and tracked temporary roots. Test-only.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { JudgeEntryStore, type JudgeEntryHandle } from '../../../src/core/judge/entries'
import type { JudgeQuestion } from '../../../src/core/judge/judge'

export class SpyJudgeStore extends JudgeEntryStore {
  public readonly settled: { key: JudgeEntryHandle; outcome: string }[] = []
  public override settle(key: JudgeEntryHandle, outcome: 'caution' | 'none' | 'failed'): boolean {
    const wasApplied = super.settle(key, outcome)
    if (wasApplied) {
      this.settled.push({ key, outcome })
    }
    return wasApplied
  }
}

export function startJudgeEntry(
  entries: JudgeEntryStore,
  parts: {
    backend: 'model-api' | 'muse-code'
    turnId: string
    tool: string
    args: Record<string, unknown>
  },
): JudgeEntryHandle {
  return entries.start({
    backend: parts.backend,
    sessionId: 's1',
    turnId: parts.turnId,
    tool: parts.tool,
    args: parts.args,
  })
}

export async function untilJudgeSettled(
  entries: SpyJudgeStore,
  key: JudgeEntryHandle,
): Promise<string> {
  const deadline = Date.now() + 8000
  for (;;) {
    const found = entries.settled.find((entry) => entry.key === key)
    if (found !== undefined) {
      return found.outcome
    }
    if (Date.now() > deadline) {
      throw new Error('the judge never settled')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

export interface JudgeCall {
  readonly entryKey: JudgeEntryHandle
  readonly stateText: string
  readonly questions: readonly JudgeQuestion[]
}

/** One held action to judge: its latch entry plus the judged state. */
export function judgeJob(
  entryKey: JudgeEntryHandle,
  stateText: string,
  questions: readonly JudgeQuestion[],
): JudgeCall {
  return { entryKey, stateText, questions }
}

/** One judge call that waits for its settle and answers with the outcome. */
export async function judgeOnce(
  judge: { judge(job: JudgeCall): void },
  entries: SpyJudgeStore,
  job: JudgeCall,
): Promise<string> {
  judge.judge(job)
  return await untilJudgeSettled(entries, job.entryKey)
}

/** A repeat judge call that must settle nothing: waits out its background run. */
export async function judgeAgain(
  judge: { judge(job: JudgeCall): void },
  job: JudgeCall,
): Promise<void> {
  judge.judge(job)
  await new Promise((resolve) => setTimeout(resolve, 50))
}

export interface TrackedTempRoots {
  readonly removed: string[]
  readonly makeTempRoot: () => Promise<string>
  readonly removeTempRoot: (root: string) => Promise<void>
}

/**
 * Temporary roots the suite deletes afterwards: created folders join
 * `folders` for the file's `afterAll`, removed ones join `removed`.
 */
export function trackTempRoots(folders: string[]): TrackedTempRoots {
  const removed: string[] = []
  return {
    removed,
    makeTempRoot: () => {
      const folder = mkdtempSync(path.join(tmpdir(), 'muse-judge-'))
      folders.push(folder)
      return Promise.resolve(folder)
    },
    removeTempRoot: (root) => {
      removed.push(root)
      rmSync(root, { recursive: true, force: true })
      return Promise.resolve()
    },
  }
}
