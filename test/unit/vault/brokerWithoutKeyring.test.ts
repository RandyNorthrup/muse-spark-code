import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildBrokerChildren } from '../helpers/vault/sessionBrokerBuild'

// A staged package carries no node_modules, so the OS keyring binding is
// genuinely absent in this fixture: the broker must still start its
// channel (the OS-store tier degrades per operation), never refuse startup.
const fixture = { root: '', xdg: '' }
const children = new Set<ChildProcess>()
beforeAll(async () => {
  if (process.platform === 'win32') return
  fixture.root = await mkdtemp(path.join(tmpdir(), 'vs-nokeyring-'))
  // The test proves nothing if the binding resolves from an ancestor
  // install: fail fast instead of passing against the real keyring.
  expect(() =>
    createRequire(path.join(fixture.root, 'dist', 'vaultBrokerNoKeyring.js')).resolve(
      '@napi-rs/keyring',
    ),
  ).toThrow()
  // The socket base must verify owner-only and stay within the bind limit,
  // so it lives in the lane's short runtime directory (XDG_RUNTIME_DIR),
  // never under the fixture root: the fixture must stand clear of every
  // ancestor node_modules for the binding to be genuinely absent.
  const runtimeBase = process.env['XDG_RUNTIME_DIR'] ?? tmpdir()
  fixture.xdg = path.join(runtimeBase, `vs-nokeyring-xdg-${String(process.pid)}`)
  await mkdir(fixture.xdg, { recursive: true, mode: 0o700 })
  await buildBrokerChildren(fixture.root, [['sessionBrokerChild', 'vaultBrokerNoKeyring.js']])
})
afterAll(async () => {
  for (const child of children) {
    child.kill('SIGKILL')
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
  }
  if (fixture.xdg) await rm(fixture.xdg, { recursive: true, force: true })
  if (!fixture.root) return
  await rm(fixture.root, { recursive: true, force: true })
})
describe.skipIf(process.platform === 'win32')('vault broker without the OS keyring binding', () => {
  it('starts its channel where no keyring module is installed', async () => {
    const dataDir = path.join(fixture.root, 'vault')
    const child = spawn(
      process.execPath,
      [
        path.join(fixture.root, 'dist', 'vaultBrokerNoKeyring.js'),
        JSON.stringify({
          dataDir,
          runDirectory: path.join(dataDir, 'run'),
          installRoot: fixture.root,
          userSession: 'test',
        }),
      ],
      // Hermetic like the crash children: the install root carries no
      // node_modules and stands clear of every ancestor install, so the
      // keyring import genuinely fails here. The bounded socket cannot live
      // under a deep fixture root (107-byte bind limit), so the broker gets
      // the lane's short runtime directory for the socket only.
      {
        env: { HOME: fixture.root, XDG_RUNTIME_DIR: fixture.xdg },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      },
    )
    children.add(child)
    if (child.stdout === null || child.stderr === null)
      throw new Error('missing fixture diagnostic pipes')
    const errors: Buffer[] = []
    child.stderr.on('data', (bytes: Buffer) => {
      errors.push(bytes)
    })
    const ready = await once(child, 'message')
    expect(ready[0]).toEqual({ ready: true })
    // The readiness message travels over IPC while the marker travels over
    // the pipe: wait for the pipe, bounded, instead of assuming the order.
    for (let waited = 0; waited < 50; waited++) {
      if (Buffer.concat(errors).toString('utf8').includes('vault-audit-refused')) break
      await delay(100)
    }
    expect(Buffer.concat(errors).toString('utf8')).toContain('vault-audit-refused')
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    const [code] = await exited
    children.delete(child)
    expect(code).toBe(0)
  })
})
