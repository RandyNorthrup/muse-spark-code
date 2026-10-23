// M110b W1 live drills (MUSE_NODE_DRILL=1): the sandbox engine and
// egress proxy against the real daemon, real DNS and real upstreams.
// The engine drills run a box, freeze it, and prove the snapshot
// carries state by reading a marker back from a second box; then pull
// the base image and ensure the workspace network twice (idempotent)
// before removing it. The egress drill tunnels a real TLS handshake,
// then proves each refusal (policy, metadata, SNI mismatch, unknown
// source). Nothing here is faked: no daemon or network means the flag
// stays off and the drills skip. Recorded 2026-10-22 against docker
// 29.2.1 on linuxlt.
import { readFileSync } from 'node:fs'
import { Socket } from 'node:net'
import { connect as connectTls } from 'node:tls'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cleanupSandboxes,
  commitSandbox,
  connectEngine,
  createExec,
  createSandbox,
  ensureNetwork,
  inspectNetwork,
  inspectSandbox,
  pullImage,
  removeImage,
  removeNetwork,
  removeSandbox,
  runExec,
  startSandbox,
  stopSandbox,
  type Engine,
} from '../../src/runtime/node/sandbox/engine'
import {
  startEgressServer,
  type EgressAudit,
  type EgressVerdict,
} from '../../src/runtime/node/egress/server'

const IS_DRILL = process.env['MUSE_NODE_DRILL'] === '1'
const EGRESS_FIXTURES = path.join(__dirname, '..', 'fixtures', 'egress')
const BASE_IMAGE = 'debian:trixie-slim'

function readHead(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0)
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk])
      const end = buffered.indexOf('\r\n\r\n')
      if (end === -1) {
        return
      }

      cleanup()
      resolve(buffered.subarray(0, end).toString('utf8'))
    }
    const onEnd = (): void => {
      cleanup()
      reject(new Error(`tunnel closed before the head completed: ${buffered.toString('utf8')}`))
    }
    const cleanup = (): void => {
      socket.removeListener('data', onData)
      socket.removeListener('close', onEnd)
      socket.removeListener('error', onEnd)
    }
    socket.on('data', onData)
    socket.on('close', onEnd)
    socket.on('error', onEnd)
  })
}

function closed(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.destroyed) {
      resolve()
      return
    }
    socket.once('close', () => {
      resolve()
    })
  })
}

describe.skipIf(!IS_DRILL)('the sandbox engine, live', () => {
  it(
    'runs a box, freezes it, and reads the marker back from the snapshot',
    // A cold daemon pulls the base image and starts two boxes; the
    // clock covers the pull, not the assertions.
    { timeout: 180_000 },
    async () => {
      const engine: Engine = await connectEngine()
      expect(engine.name).toBe('docker')
      expect(engine.serverVersion).toMatch(/^[0-9]+\.[0-9]+/)
      const run = `run-${String(process.pid)}-${String(Date.now())}`
      const boxes: string[] = []
      const images: string[] = []
      try {
        const first = await createSandbox(engine, {
          image: BASE_IMAGE,
          name: `drill-${run}-a`,
          command: ['sleep', '300'],
          labels: { 'muse.node.drill': run },
        })
        boxes.push(first)
        await startSandbox(engine, first)
        const inspected = await inspectSandbox(engine, first)
        expect(inspected.parsed.State.Running).toBe(true)
        const marker = await createExec(engine, first, ['sh', '-c', 'echo snap >/marker'])
        const marked = await runExec(engine, first, marker)
        expect(marked.exitCode).toBe(0)
        const snapshot = `muse-drill/snap:${run}`
        images.push(snapshot)
        expect(await commitSandbox(engine, first, 'muse-drill/snap', run)).toMatch(
          /^sha256:[0-9a-f]{64}$/,
        )
        const second = await createSandbox(engine, {
          image: snapshot,
          name: `drill-${run}-b`,
          command: ['sleep', '300'],
          labels: { 'muse.node.drill': run },
        })
        boxes.push(second)
        await startSandbox(engine, second)
        const read = await createExec(engine, second, ['cat', '/marker'])
        const back = await runExec(engine, second, read)
        expect(back.exitCode).toBe(0)
        expect(back.stdout.toString('utf8')).toBe('snap\n')
        const failing = await createExec(engine, second, ['sh', '-c', 'echo oops >&2; exit 7'])
        const failed = await runExec(engine, second, failing)
        expect(failed.exitCode).toBe(7)
        expect(failed.stderr.toString('utf8')).toBe('oops\n')
        await stopSandbox(engine, second, 5)
        const reaped = await cleanupSandboxes(engine, 0, Date.now(), { 'muse.node.drill': run })
        expect(reaped.removed).toContain(second)
        expect(reaped.kept.map((kept) => kept.id)).toContain(first)
        boxes.splice(boxes.indexOf(second), 1)
      } finally {
        // Best effort: the drill must not leave boxes or images behind.
        for (const box of boxes) {
          try {
            await removeSandbox(engine, box, true)
          } catch {
            // The box is already gone; the drill asserted it earlier.
          }
        }
        for (const image of images) {
          try {
            await removeImage(engine, image, true)
          } catch {
            // The image is already gone; the commit asserted it earlier.
          }
        }
      }
    },
  )
  it(
    'pulls the base image and ensures the workspace network twice',
    // A cold daemon pulls the base image over the network; the clock
    // covers the pull, not the assertions.
    { timeout: 180_000 },
    async () => {
      const engine: Engine = await connectEngine()
      await pullImage(engine, BASE_IMAGE)
      const name = `muse-drill-net-${String(process.pid)}-${String(Date.now())}`
      const first = await ensureNetwork(engine, name)
      try {
        expect(await ensureNetwork(engine, name)).toBe(first)
        const inspected = await inspectNetwork(engine, first)
        expect(inspected.Id).toBe(first)
        expect(inspected.Name).toBe(name)
      } finally {
        await removeNetwork(engine, first)
      }
    },
  )
})

describe.skipIf(!IS_DRILL)('the egress proxy, live', () => {
  it(
    'tunnels a real handshake and refuses the rest',
    // Real DNS and a real upstream handshake; the clock covers the
    // network, not the assertions.
    { timeout: 60_000 },
    async () => {
      const audits: EgressAudit[] = []
      const server = await startEgressServer({
        addrs: ['127.0.0.1'],
        policies: (source) =>
          source === '127.0.0.1'
            ? { allow: ['example.com', 'www.example.com', '169.254.169.254'] }
            : undefined,
        audit: (event) => {
          audits.push(event)
        },
      })
      const port = server.bound[0]?.port ?? 0
      expect(port).toBeGreaterThan(0)
      try {
        const tunnel = new Socket()
        await new Promise<void>((resolve) =>
          tunnel.connect(port, '127.0.0.1', () => {
            resolve()
          }),
        )
        tunnel.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com\r\n\r\n')
        expect(await readHead(tunnel)).toContain('200')
        await new Promise<void>((resolve, reject) => {
          const secure = connectTls({ socket: tunnel, servername: 'example.com' }, () => {
            try {
              expect(secure.getCipher()).not.toBeNull()
              secure.end(() => {
                resolve()
              })
            } catch (error: unknown) {
              reject(error instanceof Error ? error : new Error('cipher check failed'))
            }
          })
          secure.once('error', reject)
        })
        const smuggled = new Socket()
        await new Promise<void>((resolve) =>
          smuggled.connect(port, '127.0.0.1', () => {
            resolve()
          }),
        )
        smuggled.write(
          Buffer.concat([
            Buffer.from('CONNECT www.example.com:443 HTTP/1.1\r\nHost: www.example.com\r\n\r\n'),
            readFileSync(path.join(EGRESS_FIXTURES, 'clienthello-example.bin')),
          ]),
        )
        expect(await readHead(smuggled)).toContain('200')
        await closed(smuggled)
        const denied = new Socket()
        await new Promise<void>((resolve) =>
          denied.connect(port, '127.0.0.1', () => {
            resolve()
          }),
        )
        denied.write('CONNECT denied.example:443 HTTP/1.1\r\nHost: denied.example\r\n\r\n')
        expect(await readHead(denied)).toContain('403')
        const metadata = new Socket()
        await new Promise<void>((resolve) =>
          metadata.connect(port, '127.0.0.1', () => {
            resolve()
          }),
        )
        metadata.write('CONNECT 169.254.169.254:80 HTTP/1.1\r\nHost: 169.254.169.254\r\n\r\n')
        expect(await readHead(metadata)).toContain('403')
      } finally {
        await server.close()
      }
      const byHost = new Map<string, EgressVerdict>()
      const verdicts: EgressVerdict[] = []
      for (const audit of audits) {
        if (audit.kind !== 'connect') continue
        byHost.set(audit.host, audit.verdict)
        verdicts.push(audit.verdict)
      }
      expect(verdicts).toContain('allow')
      expect(byHost.get('www.example.com')).toBe('sni-mismatch')
      expect(byHost.get('denied.example')).toBe('deny-policy')
      expect(byHost.get('169.254.169.254')).toBe('deny-metadata')
      expect(audits.some((audit) => audit.kind === 'nat64')).toBe(true)

      const closedAudits: EgressAudit[] = []
      const closedServer = await startEgressServer({
        addrs: ['127.0.0.1'],
        policies: () => undefined,
        audit: (event) => {
          closedAudits.push(event)
        },
      })
      try {
        const stranger = new Socket()
        const strangerPort = closedServer.bound[0]?.port ?? 0
        await new Promise<void>((resolve) => {
          stranger.connect(strangerPort, '127.0.0.1', () => {
            resolve()
          })
        })
        stranger.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com\r\n\r\n')
        expect(await readHead(stranger)).toContain('403')
      } finally {
        await closedServer.close()
      }
      expect(
        closedAudits.some(
          (audit) => audit.kind === 'connect' && audit.verdict === 'unknown-source',
        ),
      ).toBe(true)
    },
  )
})
