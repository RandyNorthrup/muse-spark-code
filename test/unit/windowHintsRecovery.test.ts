import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createWindowHints } from '../../src/host/team/windowHints'

const UID = '123e4567-e89b-12d3-a456-426614174000'
const state = () => ({
  workspaceName: 'lane',
  trees: [],
  exclusiveServers: [],
  workers: 1,
  processWorkers: 0,
  heavyCommands: 0,
})

const base = (extra: Record<string, unknown> = {}) => ({
  platform: process.platform,
  freshMs: 60_000,
  writeMs: 60_000,
  maxHintBytes: 1_000_000,
  now: () => Date.now(),
  disabled: () => undefined,
  question: () => Promise.resolve('continue' as const),
  overlap: () => [] as readonly string[],
  ...extra,
})
const roots: string[] = []
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})
const freshRoot = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'muse-window-hints-'))
  roots.push(root)
  return root
}

describe('createWindowHints journal recovery', () => {
  it('round-trips a published hint through a real journal file', async () => {
    const root = freshRoot()
    const hints = createWindowHints({ ...base(), directory: root, instanceId: UID })
    await hints.publish(state())
    const fresh = await hints.readFresh()
    expect(fresh).toHaveLength(1)
    expect(fresh[0].instanceId).toBe(UID)
    expect(fresh[0].workers).toBe(1)
    await hints.dispose()
  })

  it('keeps an unreadable journal but still reads a valid hint', async () => {
    const root = freshRoot()
    const hints = createWindowHints({ ...base(), directory: root, instanceId: UID })
    await hints.publish(state())
    await hints.readFresh()
    const hintFile = path.join(root, `${UID}.json`)
    writeFileSync(hintFile, '{not valid json', 'utf8')
    const fresh = await hints.readFresh()
    expect(fresh).toHaveLength(0)
    await hints.dispose()
  })

  it('disables the journal when its directory cannot be created', async () => {
    const root = freshRoot()
    const blocker = path.join(root, 'blocker')
    writeFileSync(blocker, 'in the way', 'utf8')
    let disabledCalls = 0
    const hints = createWindowHints({
      ...base({
        disabled: () => {
          disabledCalls += 1
        },
      }),
      directory: blocker,
      instanceId: UID,
    })
    await hints.publish(state())
    expect(disabledCalls).toBeGreaterThan(0)
    await hints.dispose()
  })

  it('reads no hints when the journal cannot be listed', async () => {
    const root = freshRoot()
    const blocker = path.join(root, 'blocker')
    writeFileSync(blocker, 'in the way', 'utf8')
    let disabledCalls = 0
    const hints = createWindowHints({
      ...base({
        disabled: () => {
          disabledCalls += 1
        },
      }),
      directory: blocker,
      instanceId: UID,
    })
    await expect(hints.readFresh()).resolves.toEqual([])
    expect(disabledCalls).toBeGreaterThan(0)
    await hints.dispose()
  })
})
