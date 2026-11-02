import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compileVaultPeerHelper } from '../helpers/vault/peerBuild'

// RLF-M109H items 1 and 2 on the real helper, reviewed by RVM109H. The
// delegated command starts through the peer helper's `run` mode
// (vaultExecEntry), which zeroes the command's core limit before exec.
// On Linux the helper also clears dumpable, but the kernel sets it
// back for a normal command, so the same user can still read the
// command's environment after exec. Extra descriptors are closed
// before exec. The helper is compiled here from the shipped source
// exactly as the broker fixtures compile it (sessionBrokerBuild).

/** Compiling the shipped C helper takes seconds on a loaded rig. */
const BUILD_TIMEOUT_MS = 60_000
const isPosix = process.platform === 'linux' || process.platform === 'darwin'
const state: { helper: string; dispose?: () => Promise<void> } = { helper: '' }

beforeAll(async () => {
  if (!isPosix) return
  const built = await compileVaultPeerHelper('vault-peer-run-')
  state.helper = built.helper
  state.dispose = built.dispose
}, BUILD_TIMEOUT_MS)

afterAll(async () => {
  await state.dispose?.()
})

describe.skipIf(!isPosix)('vault peer run mode (RLF-M109H)', () => {
  it('zeroes the core limit the command inherits even when the caller raised it', () => {
    const out = execFileSync(
      '/bin/sh',
      [
        '-c',
        'ulimit -c unlimited; exec "$@"',
        'sh',
        state.helper,
        'run',
        '/bin/sh',
        '-c',
        'ulimit -c',
      ],
      { encoding: 'utf8' },
    )
    expect(out.trim()).toBe('0')
  })

  it('still runs the exact command with its environment and arguments', () => {
    const marker = 'peer-run-probe'
    const out = execFileSync(
      state.helper,
      ['run', '/bin/sh', '-c', 'printf %s "$VAULT_PROBE" | wc -c'],
      {
        encoding: 'utf8',
        env: { ...process.env, VAULT_PROBE: marker },
      },
    )
    expect(Number(out.trim())).toBe(marker.length)
  })

  it('refuses a relative command path instead of resolving one itself', () => {
    expect(() =>
      execFileSync(state.helper, ['run', 'relative/command'], { stdio: 'pipe' }),
    ).toThrow()
  })

  it('closes descriptors above 2 before the command runs', async () => {
    const child = spawn(
      state.helper,
      ['run', '/bin/sh', '-c', 'if : >&3; then echo open; else echo closed; fi'],
      { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] },
    )
    let out = ''
    child.stdout.on('data', (bytes: Buffer) => {
      out += bytes.toString('utf8')
    })
    const code = await new Promise<number | null>((resolve) => {
      child.once('exit', (status) => {
        resolve(status)
      })
    })
    expect(code).toBe(0)
    expect(out.trim()).toBe('closed')
  })

  it.skipIf(process.platform !== 'linux')(
    'leaves the command environment readable by the same user after exec',
    async () => {
      const child = spawn(state.helper, ['run', '/bin/sh', '-c', 'sleep 30'], {
        env: { ...process.env, VAULT_PROBE: 'peer-run-probe' },
        stdio: 'ignore',
      })
      try {
        if (child.pid === undefined) throw new Error('command did not start')
        const pid = String(child.pid)
        const deadline = Date.now() + 1000
        let comm = ''
        while (Date.now() < deadline) {
          try {
            comm = readFileSync(path.join('/proc', pid, 'comm'), 'utf8')
          } catch {
            comm = ''
          }
          if (comm.startsWith('sh') || comm.startsWith('sleep')) break
          await new Promise((resolve) => {
            setTimeout(resolve, 20)
          })
        }
        // The image is the command, not the helper still waiting to exec.
        expect(comm.startsWith('sh') || comm.startsWith('sleep')).toBe(true)
        // A normal exec sets dumpable back to 1, so this read succeeds.
        const environ = readFileSync(path.join('/proc', pid, 'environ'))
        expect(environ.includes(Buffer.from('VAULT_PROBE=peer-run-probe'))).toBe(true)
      } finally {
        child.kill('SIGKILL')
        await new Promise<void>((resolve) => {
          child.once('exit', () => {
            resolve()
          })
        })
      }
    },
  )
})
