// M111 lane OB: `/readyz` gains the desktop's components once the
// desktop profile is present: ready only when the node and every desktop
// component are ready. Real state store under a temp root.
import { rm } from 'node:fs/promises'
import { afterEach, describe, expect } from 'vitest'
import { NODE_ZERO_DIGEST } from '../../../src/shared/constants'
import { nodeHealth } from '../../../src/runtime/node/health'
import { NodeStateStore } from '../../../src/runtime/node/state'
import { nodeNativeTest, nodeTempRoot } from '../helpers/nodeNative'
import { nodeState } from '../helpers/node/records'
import { recordCalls } from '../helpers/recordCalls'

const directories: string[] = []

afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('node health with desktop readiness', () => {
  nodeNativeTest('readyz names the desktop parts and waits for them', async () => {
    const dir = await nodeTempRoot('m111-ob-health-')
    directories.push(dir)
    const reported = recordCalls<[unknown]>()
    const state = new NodeStateStore(dir, reported.fn)
    const value = nodeState()
    value.auditHead = { seq: 0, hash: NODE_ZERO_DIGEST }
    await state.initialize(value)
    const ports = {
      state,
      journalsReadable: () => Promise.resolve(true),
      isKeyStoreSealed: () => false,
      keysNeeded: () => false,
    }
    // Outside the desktop profile the shape is unchanged.
    expect(await nodeHealth('/readyz', ports)).toEqual({ status: 200, word: 'ready' })
    const desktop = {
      probe: () =>
        Promise.resolve([
          { component: 'compositor', ready: true, detail: 'ping-ok', pingMs: 12 },
          { component: 'shell', ready: true, detail: 'surfaces-mapped' },
          { component: 'app', ready: true, detail: 'windows-responsive' },
          { component: 'sysd', ready: true, detail: 'services-connected' },
        ] as const),
    }
    const ready = await nodeHealth('/readyz', { ...ports, desktop })
    expect(ready.word).toBe('ready')
    expect(ready.desktop?.components.map((item) => item.component)).toEqual([
      'compositor',
      'shell',
      'app',
      'sysd',
    ])
    const failing = await nodeHealth('/readyz', {
      ...ports,
      desktop: {
        probe: () =>
          Promise.resolve([
            { component: 'compositor', ready: false, detail: 'ipc-down' },
            { component: 'shell', ready: true, detail: 'surfaces-mapped' },
            { component: 'app', ready: true, detail: 'windows-responsive' },
            { component: 'sysd', ready: true, detail: 'services-connected' },
          ] as const),
      },
    })
    expect(failing).toMatchObject({ status: 503, word: 'not-ready' })
    expect(failing.desktop?.ready).toBe(false)
    const throwing = await nodeHealth('/readyz', {
      ...ports,
      desktop: {
        probe: () => Promise.reject(new Error('test probe failure')),
      },
    })
    expect(throwing.word).toBe('not-ready')
    expect(throwing.desktop?.components[0]).toMatchObject({ detail: 'no-probe' })
    expect(reported.calls).toHaveLength(0)
  })
})
