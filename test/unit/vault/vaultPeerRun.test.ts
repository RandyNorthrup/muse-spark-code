import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compileVaultPeerHelper } from '../helpers/vault/peerBuild'

// RLF-M109H items 1 and 2 on the real helper: the delegated command is
// started through the peer helper's `run` mode (vaultExecEntry), which
// zeroes the command's core limit in its own process and, on Linux,
// turns dumpable off so another process of the same user cannot read
// the command's environment through /proc. The helper is compiled here
// from the shipped source exactly as the broker fixtures compile it
// (sessionBrokerBuild), and every assertion reads a real child process.

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

  it.skipIf(process.platform !== 'linux')(
    'keeps the command environment unreadable to another process of the same user',
    async () => {
      const child = spawn(state.helper, ['run', '/bin/sh', '-c', 'sleep 30'], {
        env: { ...process.env, VAULT_PROBE: 'peer-run-probe' },
        stdio: 'ignore',
      })
      try {
        if (child.pid === undefined) throw new Error('command did not start')
        // Dumpable off makes /proc/<pid> root-owned: the same user's
        // environ read is refused by the kernel while the command runs.
        expect(() => readFileSync(path.join('/proc', String(child.pid), 'environ'))).toThrow()
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
