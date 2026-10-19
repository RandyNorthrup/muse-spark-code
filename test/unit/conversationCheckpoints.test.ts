// One conversation's checkpoints (M72, M86): a restore or Redo that threw
// reports failure honestly and tells the transcript in fixed words,
// through the real ConversationCheckpoints.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CheckpointPort } from '../../src/host/checkpoints/checkpointHost'
import {
  ConversationCheckpoints,
  type ConversationCheckpointDeps,
  type NoticeLevel,
} from '../../src/host/conversation/conversationCheckpoints'
import { UI_TEXT } from '../../src/shared/constants'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { captureLog } from './helpers/captureLog'

const MISSING = path.join('temp', 'checkpoints-never-written.json')

/** A genuine store failure: reading records that are not there. */
async function failRecords(): Promise<never> {
  await readFile(MISSING, 'utf8')
  throw new Error('unreachable')
}

interface Captured {
  readonly posted: HostToWebviewMessage[]
  readonly notices: { level: NoticeLevel; text: string }[]
  readonly logLines: string[]
}

function makeDeps(port: CheckpointPort): { deps: ConversationCheckpointDeps; captured: Captured } {
  const posted: HostToWebviewMessage[] = []
  const notices: { level: NoticeLevel; text: string }[] = []
  const { logger, lines: logLines } = captureLog()
  const deps: ConversationCheckpointDeps = {
    backend: () => 'modelApi',
    port,
    post: (message) => {
      posted.push(message)
    },
    notice: (level, text) => {
      notices.push({ level, text })
    },
    confirm: () => Promise.resolve(true),
    unsavedPaths: () => [],
    log: logger,
  }
  return { deps, captured: { posted, notices, logLines } }
}

function portWith(overrides: Partial<CheckpointPort>): CheckpointPort {
  return {
    isNativeUnsafe: () => false,
    markNativeBackend: () => Promise.resolve(undefined),
    markUnprovenProcess: () => Promise.resolve(undefined),
    availability: () => 'on',
    markTurn: () => Promise.resolve(undefined),
    startTurnUnit: () => Promise.resolve(undefined),
    endUnit: () => Promise.resolve(undefined),
    turns: () => Promise.resolve([]),
    legacyTurns: () => Promise.resolve([]),
    restore: () => failRecords(),
    redo: () => failRecords(),
    forgetSession: () => Promise.resolve(undefined),
    unforgetSession: () => Promise.resolve(undefined),
    maintain: () => Promise.resolve(undefined),
    refuseStorageWrite: () => undefined,
    ...overrides,
  }
}

describe('ConversationCheckpoints restore failure', () => {
  it('reports an unrestored, incomplete restore and tells it on post', async () => {
    const { deps, captured } = makeDeps(portWith({}))
    const checkpoints = new ConversationCheckpoints(deps)
    const report = await checkpoints.restore('session', 'turn', ['turn'])
    expect(report.isRestored).toBe(false)
    expect(report.isComplete).toBe(false)
    // The transcript waits for post; the record already has the kind.
    expect(captured.notices).toEqual([])
    expect(captured.logLines.some((line) => line.includes('Restore failed'))).toBe(true)
    report.post()
    expect(captured.notices).toEqual([{ level: 'error', text: UI_TEXT.restoreFailed }])
  })

  it('tells a refused Redo and still settles its button as unspent', async () => {
    const { deps, captured } = makeDeps(portWith({}))
    const checkpoints = new ConversationCheckpoints(deps)
    await checkpoints.redo('restore', 'session')
    expect(captured.notices).toEqual([{ level: 'error', text: UI_TEXT.restoreFailed }])
    expect(captured.logLines.some((line) => line.includes('Restore failed'))).toBe(true)
    expect(captured.posted).toEqual([
      { type: 'restoreRedone', restoreId: 'restore', isSpent: false },
    ])
  })
})
