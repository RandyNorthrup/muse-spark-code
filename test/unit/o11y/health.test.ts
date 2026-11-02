// M111 lane OB: `/readyz` gains the desktop's components once the
// desktop profile is present: ready only when the node and every desktop
// component are ready. Real state store under a temp root.
import { rm } from 'node:fs/promises'
import { afterEach, describe, expect } from 'vitest'
import { nodeHealth } from '../../../src/runtime/node/health'
import { nodeNativeTest } from '../helpers/nodeNative'
import { o11yReadyProbes, o11yStateRoot } from '../helpers/o11y'

const directories: string[] = []

afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('node health with desktop readiness', () => {
  nodeNativeTest('readyz names the desktop parts and waits for them', async () => {
    const { dir, state, reported } = await o11yStateRoot('m111-ob-health-')
    directories.push(dir)
    const ports = {
      state,
      journalsReadable: () => Promise.resolve(true),
      isKeyStoreSealed: () => false,
      keysNeeded: () => false,
    }
    // Outside the desktop profile the shape is unchanged.
    expect(await nodeHealth('/readyz', ports)).toEqual({ status: 200, word: 'ready' })
    const desktop = {
      probe: () => Promise.resolve(o11yReadyProbes()),
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
