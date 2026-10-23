// The node terminal methods (src/runtime/node/web/terminal.ts) over the real
// tool host: a child node process stands in for the container's PTY (real
// bytes, real exits), and the audit lands in a real state store. Opens bill
// a step-up digest, writes count input bytes, output counts output bytes,
// and close audits the session's end with its sizes; unknown ids refuse.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  NODE_PROTOCOL_VERSION,
  NODE_SESSION_IDLE_MS,
  NODE_SESSION_MAX_MS,
} from '../../src/shared/constants'
import type { NodeEvent } from '../../src/shared/node'
import type { NodeSession } from '../../src/shared/nodeAuth'
import type { NodePty, NodePtyFactory } from '../../src/runtime/node/toolHost'
import { NodeProcessToolHost } from '../../src/runtime/node/toolHost'
import { initializedPageStore, pageRefusal } from './helpers/node/pageMethods'
import { nodeActionDigest } from '../../src/runtime/node/listenerMethods'
import { createNodeTerminalMethods } from '../../src/runtime/node/web/terminal'

const children: ChildProcess[] = []
const folders: string[] = []

afterEach(() => {
  for (const child of children.splice(0)) {
    child.kill()
  }
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

function folder(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'node-terminal-'))
  folders.push(dir)
  return dir
}

/** A real process as the PTY: echoes stdin to stdout, exits when killed. */
function processPty(): NodePty {
  const child = spawn(
    process.execPath,
    ['-e', 'process.stdin.on("data",(d)=>process.stdout.write(d))'],
    {
      stdio: ['pipe', 'pipe', 'ignore'],
    },
  )
  children.push(child)
  const exited = new Promise<number | null>((resolve) => {
    child.on('close', (code) => {
      resolve(code)
    })
  })
  child.stdout.setEncoding('utf8')
  return {
    output: (async function* () {
      for await (const chunk of child.stdout) {
        yield chunk
      }
    })(),
    exited,
    write: (data: string): Promise<void> => {
      child.stdin.write(data)
      return Promise.resolve()
    },
    resize: (): Promise<void> => Promise.resolve(),
    close: async (): Promise<void> => {
      child.kill()
      await exited
    },
  }
}

const pty: NodePtyFactory = {
  open: () => Promise.resolve(processPty()),
}

async function setup() {
  const root = folder()
  const workspaceRoot = path.join(root, 'workspaces')
  mkdirSync(path.join(workspaceRoot, 'ws'), { recursive: true })
  const { store, initial } = await initializedPageStore(root)
  const reported: unknown[] = []
  const host = new NodeProcessToolHost({
    toolsUid: 1000,
    serviceUid: 1001,
    currentUid: () => 1000,
    workspaceRoot,
    workspaces: new Map([['ws', { path: 'ws', trusted: true }]]),
    toolsHome: root,
    shell: process.execPath,
    pty,
    report: (error: unknown) => {
      reported.push(error)
    },
  })
  const methods = createNodeTerminalMethods(
    {
      host,
      nodeId: initial.nodeId,
      now: () => Date.now(),
      audit: (details) => store.append(details),
      report: (error: unknown) => {
        reported.push(error)
      },
    },
    'session',
  )
  return { store, host, methods, reported, root }
}

async function openSubscribed(test: Awaited<ReturnType<typeof setup>>, outer: AbortController) {
  const { terminalId } = await test.methods.open(openParams(), outer.signal)
  const { events, streaming } = collectEvents(test, terminalId, outer.signal)
  return { terminalId, events, streaming }
}

function collectEvents(
  test: Awaited<ReturnType<typeof setup>>,
  terminalId: string,
  signal: AbortSignal,
) {
  const events: NodeEvent[] = []
  const streaming = test.methods.subscribe(
    session(),
    terminalId,
    (event) => {
      events.push(event)
      return Promise.resolve()
    },
    signal,
  )
  return { events, streaming }
}

function openParams() {
  const params = {
    workspaceId: 'ws',
    size: { cols: 80, rows: 24 },
    stepUpId: 'stepup',
    actionDigest: '0'.repeat(64),
  }
  return { ...params, actionDigest: nodeActionDigest('node/terminal/open', params) }
}

function session(): NodeSession {
  return {
    v: NODE_PROTOCOL_VERSION,
    id: 'session',
    ownerId: 'owner',
    surface: 'web',
    createdAt: 1000,
    lastSeenAt: 1000,
    idleExpiresAt: 1000 + NODE_SESSION_IDLE_MS,
    absoluteExpiresAt: 1000 + NODE_SESSION_MAX_MS,
  }
}

describe('node terminal methods', () => {
  it('opens, streams, resizes and closes a terminal, auditing start and end with sizes', async () => {
    const test = await setup()
    const signal = new AbortController().signal
    try {
      const { terminalId } = await test.methods.open(openParams(), signal)
      expect(typeof terminalId).toBe('string')
      const seen: string[] = []
      const done = Promise.withResolvers<undefined>()
      const wait = test.methods.subscribe(
        session(),
        terminalId,
        (event) => {
          if (event.type === 'terminalOutput') {
            seen.push(event.data)
            if (seen.join('').includes('hello')) {
              done.resolve(undefined)
            }
          }
          return Promise.resolve()
        },
        signal,
      )
      await test.methods.write({ terminalId, data: 'hello\n' }, signal)
      await done.promise
      await test.methods.resize({ terminalId, size: { cols: 100, rows: 30 } }, signal)
      await test.methods.close({ terminalId }, signal)
      await wait
      const trail = test.store
        .audit()
        .filter((entry) => entry.kind === 'terminal' && entry.terminalId === terminalId)
      expect(trail.map((entry) => (entry.kind === 'terminal' ? entry.phase : ''))).toEqual([
        'start',
        'end',
      ])
      const end = trail[1]
      expect(end?.kind === 'terminal' ? end.inputBytes : -1).toBe(6)
      expect(end?.kind === 'terminal' ? end.outputBytes : -1).toBe(6)
      expect(end?.kind === 'terminal' ? end.source : '').toBe('person')
      expect(test.reported).toEqual([])
    } finally {
      await test.host.stopAll('stopped')
    }
  })

  it('refuses unknown terminals, except a close, which is done', async () => {
    const test = await setup()
    const signal = new AbortController().signal
    try {
      const attached = await pageRefusal(test.methods.attach({ terminalId: 'nope' }, signal))
      expect(attached.code).toBe('notFound')
      const written = await pageRefusal(
        test.methods.write({ terminalId: 'nope', data: 'x' }, signal),
      )
      expect(written.code).toBe('notFound')
      const resized = await pageRefusal(
        test.methods.resize({ terminalId: 'nope', size: { cols: 80, rows: 24 } }, signal),
      )
      expect(resized.code).toBe('notFound')
      await expect(test.methods.close({ terminalId: 'nope' }, signal)).resolves.toEqual({
        done: true,
      })
    } finally {
      await test.host.stopAll('stopped')
    }
  })

  it('refuses an open whose step-up digest does not bind its action', async () => {
    const test = await setup()
    const signal = new AbortController().signal
    try {
      const params = openParams()
      const opened = await pageRefusal(
        test.methods.open({ ...params, actionDigest: '1'.repeat(64) }, signal),
      )
      expect(opened.code).toBe('forbidden')
      expect(test.store.audit()).toEqual([])
    } finally {
      await test.host.stopAll('stopped')
    }
  })

  it('disposes the PTY when its last subscriber disconnects', async () => {
    const test = await setup()
    const outer = new AbortController()
    try {
      const { terminalId, events, streaming } = await openSubscribed(test, outer)
      outer.abort()
      await streaming
      const fresh = new AbortController().signal
      const attached = await pageRefusal(test.methods.attach({ terminalId }, fresh))
      expect(attached.code).toBe('notFound')
      const trail = test.store
        .audit()
        .filter((entry) => entry.kind === 'terminal' && entry.terminalId === terminalId)
      expect(trail).toHaveLength(2)
      expect(events).toEqual([])
    } finally {
      await test.host.stopAll('stopped')
    }
  })

  it('reports a host failure as unavailable and files it', async () => {
    const test = await setup()
    const failing = new NodeProcessToolHost({
      toolsUid: 1000,
      serviceUid: 1001,
      currentUid: () => 1000,
      workspaceRoot: test.root,
      workspaces: new Map(),
      toolsHome: test.root,
      shell: process.execPath,
      pty: {
        open: () => Promise.reject(new Error('pty exploded')),
      },
      report: () => undefined,
    })
    const methods = createNodeTerminalMethods(
      {
        host: failing,
        nodeId: 'node',
        now: () => Date.now(),
        audit: () => {
          throw new Error('must not audit a failed open')
        },
        report: (error: unknown) => {
          test.reported.push(error)
        },
      },
      'session',
    )
    const signal = new AbortController().signal
    try {
      const failure = await pageRefusal(methods.open(openParams(), signal))
      expect(failure.code).toBe('unavailable')
      expect(test.reported).toHaveLength(1)
    } finally {
      await test.host.stopAll('stopped')
    }
  })

  it('envelopes every event with the protocol version, order and node', async () => {
    const test = await setup()
    const outer = new AbortController()
    try {
      const { terminalId, events, streaming } = await openSubscribed(test, outer)
      await test.methods.write({ terminalId, data: 'q\n' }, outer.signal)
      await test.methods.close({ terminalId }, outer.signal)
      await streaming
      expect(events.length).toBeGreaterThan(0)
      expect(events.map((event) => event.v)).toEqual(events.map(() => NODE_PROTOCOL_VERSION))
      expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1))
      expect(new Set(events.map((event) => event.nodeId)).size).toBe(1)
      expect(events.at(-1)?.type).toBe('terminalEnded')
    } finally {
      await test.host.stopAll('stopped')
    }
  })
})
