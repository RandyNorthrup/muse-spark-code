// M111 lane OB: `node/diagnostics/read` serves the health table, the
// export state, the dropped count and one page of each signal from the
// real ring store and the real readiness check. The endpoint shows as
// origin only.
import { rm } from 'node:fs/promises'
import { afterEach, describe, expect } from 'vitest'
import { buildCrashRecord } from '../../../src/core/o11y/crash'
import { evaluateDesktopReadiness } from '../../../src/core/o11y/readiness'
import { createNodeDiagnosticsMethods } from '../../../src/runtime/o11y/diagnostics'
import { O11yRingStore } from '../../../src/runtime/o11y/store'
import { NodeJournalFiles } from '../../../src/runtime/node/journalFiles'
import { nodeNativeTest } from '../helpers/nodeNative'
import { o11yReadyProbes, o11yStateRoot, seedO11ySignals } from '../helpers/o11y'

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0)
const directories: string[] = []

afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('node diagnostics read', () => {
  nodeNativeTest('serves health, export, drops and one page of each signal', async () => {
    const { dir, state, reported } = await o11yStateRoot('m111-ob-diagnostics-')
    directories.push(dir)
    const store = new O11yRingStore(new NodeJournalFiles(dir), () => NOW)
    await seedO11ySignals(store, NOW - 1000)
    const built = buildCrashRecord(
      { component: 'node', kind: 'uncaught', code: 'TypeError' },
      NOW - 500,
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    await store.appendCrash(built.record)

    const methods = createNodeDiagnosticsMethods({
      store,
      health: {
        state,
        journalsReadable: () => Promise.resolve(true),
        isKeyStoreSealed: () => false,
        keysNeeded: () => false,
        desktop: {
          probe: () => Promise.resolve(evaluateDesktopReadiness(o11yReadyProbes())),
        },
      },
      exportTarget: 'https://collector:4318/v1/traces',
      refused: () => 2,
      now: () => NOW,
      report: reported.fn,
    })
    const page = await methods.read({}, new AbortController().signal)
    expect(page.health).toEqual([
      { component: 'node', ready: true, detail: 'ready' },
      { component: 'compositor', ready: true, detail: 'ping-ok' },
      { component: 'shell', ready: true, detail: 'surfaces-mapped' },
      { component: 'app', ready: true, detail: 'windows-responsive' },
      { component: 'sysd', ready: true, detail: 'services-connected' },
    ])
    expect(page.export).toEqual({ on: true, endpoint: 'https://collector:4318' })
    expect(page.dropped).toBe(2)
    expect(page.unreadable).toBe(0)
    expect(page.logs.map((record) => record.message)).toEqual(['up'])
    expect(page.metrics).toHaveLength(1)
    expect(page.traces).toHaveLength(1)
    expect(page.traces[0]?.spans[0]).toMatchObject({ name: 'op', error: true })
    expect(page.crashes).toHaveLength(1)
    expect(reported.calls).toHaveLength(0)
  })

  nodeNativeTest('reports export off and strips userinfo from the endpoint', async () => {
    const { dir, state, reported } = await o11yStateRoot('m111-ob-diagnostics-off-')
    directories.push(dir)
    const store = new O11yRingStore(new NodeJournalFiles(dir), () => NOW)
    const base = {
      store,
      health: {
        state,
        journalsReadable: () => Promise.resolve(true),
        isKeyStoreSealed: () => false,
        keysNeeded: () => false,
      },
      refused: () => 0,
      now: () => NOW,
      report: reported.fn,
    }
    const off = await createNodeDiagnosticsMethods({ ...base, exportTarget: undefined }).read(
      {},
      new AbortController().signal,
    )
    expect(off.export).toEqual({ on: false })
    expect(off.health).toEqual([{ component: 'node', ready: true, detail: 'ready' }])
    const secret = await createNodeDiagnosticsMethods({
      ...base,
      exportTarget: 'https://user:pass@collector:4318/v1/logs',
    }).read({}, new AbortController().signal)
    expect(secret.export).toEqual({ on: true, endpoint: 'https://collector:4318' })
  })
})
