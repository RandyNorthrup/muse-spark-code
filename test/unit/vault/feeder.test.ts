import { describe, expect, it, vi } from 'vitest'
import { runVaultFeeder, type VaultExecFeederPort } from '../../../src/core/vault/exec/feeder'
import { vaultUseDigest } from '../../../src/core/vault/useDigest'
import { UI_TEXT } from '../../../src/shared/constants'
import { envelope, feederFixture } from './execFixture'

async function expectRefusal(port: VaultExecFeederPort): Promise<void> {
  await expect(runVaultFeeder(envelope(), {}, port, new AbortController().signal)).rejects.toThrow(
    UI_TEXT.vault.noAccess,
  )
}

describe('M109 X feeder', () => {
  it('injects only the approved process environment, scrubs both streams before results and wipes owners', async () => {
    const { port, canary, leases, runs } = feederFixture()
    vi.mocked(port.run).mockImplementation((invocation, signal, stdout, stderr) => {
      runs.push({ invocation: structuredClone(invocation), signal })
      const text = `${canary}|${encodeURIComponent(canary)}|${Buffer.from(canary).toString('base64')}|${Buffer.from(canary).toString('hex')}`
      const split = Math.floor(text.length / 2)
      stdout(Buffer.from(text.slice(0, split)))
      stdout(Buffer.from(text.slice(split)))
      stderr(Buffer.from(canary))
      return Promise.resolve({ exitCode: 0, isTimedOut: false, isCancelled: false })
    })
    const base = { META_API_KEY: canary, SSH_AUTH_SOCK: '/ambient', PATH: '/bin' }
    const result = await runVaultFeeder(envelope(), base, port, new AbortController().signal)
    expect(runs[0]!.invocation.env['SERVICE_TOKEN']).toBe(canary)
    expect(runs[0]!.invocation.env['META_API_KEY']).toBeUndefined()
    expect(runs[0]!.invocation.env['SSH_AUTH_SOCK']).toBeUndefined()
    expect(result.stdout).toBe('[redacted]|[redacted]|[redacted]|[redacted]')
    expect(result.stderr).toBe('[redacted]')
    expect(leases[0]!.value.every((byte) => byte === 0)).toBe(true)
    expect(leases[0]!.username?.every((byte) => byte === 0)).toBe(true)
    expect(leases[0]!.close).toHaveBeenCalledWith(true)
    expect(base.META_API_KEY).toBe(canary)
  })
  it('refuses forged, duplicate, missing or changed-use tickets before redemption', async () => {
    for (const change of ['digest', 'argv', 'use', 'missing', 'duplicate'] as const) {
      const { port } = feederFixture()
      const input = envelope({
        stdin: 'secret://test-secret',
        env: { TOKEN: 'secret://other-secret' },
      })
      const mutations = {
        digest: () => {
          input.approvals[0]!.ticket.digest = 'f'.repeat(64)
        },
        argv: () => {
          input.run.command.argv.push('--changed')
        },
        use: () => {
          const approved = input.approvals[0]!.use
          if (approved.kind === 'environment') approved.names.push('SECOND_TOKEN')
        },
        missing: () => {
          input.approvals.pop()
        },
        duplicate: () => {
          input.approvals[1]!.ticket.id = input.approvals[0]!.ticket.id
        },
      }
      mutations[change]()
      await expect(runVaultFeeder(input, {}, port, new AbortController().signal)).rejects.toThrow(
        UI_TEXT.vault.useChanged,
      )
      expect(port.redeem).not.toHaveBeenCalled()
    }
  })
  it('refuses a swapped executable, working folder or sudo path before release', async () => {
    for (const swapped of ['/usr/bin/tool', '/workspace', '/usr/bin/sudo']) {
      const { port } = feederFixture()
      vi.mocked(port.realPath).mockImplementation((path) =>
        Promise.resolve(path === swapped ? '/attacker' : path),
      )
      await expect(
        runVaultFeeder(
          envelope({ sudo: { handle: 'secret://test-secret', path: '/usr/bin/sudo' } }),
          {},
          port,
          new AbortController().signal,
        ),
      ).rejects.toThrow()
      expect(port.redeem).not.toHaveBeenCalled()
      expect(port.run).not.toHaveBeenCalled()
    }
  })
  it('rechecks paths after redemption and helper acquisition before native entry', async () => {
    const { port, leases } = feederFixture()
    let reads = 0
    vi.mocked(port.realPath).mockImplementation((path) =>
      Promise.resolve(++reads > 2 ? '/swapped' : path),
    )
    await expect(
      runVaultFeeder(envelope(), {}, port, new AbortController().signal),
    ).rejects.toThrow()
    expect(port.run).not.toHaveBeenCalled()
    expect(leases[0]!.value.every((byte) => byte === 0)).toBe(true)
    expect(leases[0]!.close).toHaveBeenCalledWith(false)
  })
  it('revocation synchronously wipes leases and aborts the command tree', async () => {
    const { port, leases, revocations } = feederFixture()
    let hasAborted = false
    let hasErased = false
    vi.mocked(port.run).mockImplementation((_invocation, signal) => {
      revocations[0]!.abort()
      hasAborted = signal.aborted
      hasErased = leases[0]!.value.every((byte) => byte === 0)
      return Promise.resolve({ exitCode: 0, isTimedOut: false, isCancelled: false })
    })
    await expectRefusal(port)
    expect(hasAborted).toBe(true)
    expect(hasErased).toBe(true)
    expect(leases[0]!.close).toHaveBeenCalledWith(false)
  })
  it('owns a late redemption result when cancellation wins the await', async () => {
    const { port, leases } = feederFixture()
    const controller = new AbortController()
    const redeem = port.redeem
    port.redeem = async (approval, signal) => {
      const lease = await redeem(approval, signal)
      controller.abort()
      return lease
    }
    await expect(runVaultFeeder(envelope(), {}, port, controller.signal)).rejects.toThrow()
    expect(leases[0]!.value.every((byte) => byte === 0)).toBe(true)
    expect(leases[0]!.close).toHaveBeenCalledWith(false)
    expect(port.run).not.toHaveBeenCalled()
  })
  it('never releases raw text when stream scrubbing throws', async () => {
    const { port, canary, leases } = feederFixture()
    vi.mocked(port.scrub).mockImplementation(() => ({
      push() {
        throw new Error(canary)
      },
      end() {
        return canary
      },
      dispose: vi.fn(),
    }))
    vi.mocked(port.run).mockImplementation((_invocation, _signal, stdout) => {
      stdout(Buffer.from(canary))
      return Promise.resolve({ exitCode: 0, isTimedOut: false, isCancelled: false })
    })
    await expectRefusal(port)
    expect(leases[0]!.value.every((byte) => byte === 0)).toBe(true)
  })
  it('feeds stdin once, pins the SSH socket and closes its lifetime', async () => {
    const { port, runs, canary, socketClose } = feederFixture()
    await runVaultFeeder(
      envelope({ stdin: 'secret://test-secret', ssh: true }),
      { SSH_AUTH_SOCK: '/ambient' },
      port,
      new AbortController().signal,
    )
    expect(Buffer.from(runs[0]!.invocation.stdin!).toString()).toBe(canary)
    expect(runs[0]!.invocation.env['SSH_AUTH_SOCK']).toBe('/private/requester.sock')
    expect(socketClose).toHaveBeenCalledOnce()
  })
  it('runs sudo with -k and exact argv, then clears timestamps even on failure', async () => {
    const { port, runs, canary } = feederFixture()
    await runVaultFeeder(
      envelope({ sudo: { handle: 'secret://test-secret', path: '/usr/bin/sudo' } }),
      {},
      port,
      new AbortController().signal,
    )
    expect(runs[0]!.invocation).toMatchObject({
      file: '/usr/bin/sudo',
      args: ['-S', '-k', '-p', '', '--', '/usr/bin/tool', '--check'],
      cwd: '/workspace',
    })
    expect(Buffer.from(runs[0]!.invocation.stdin!).toString()).toBe(`${canary}\n`)
    expect(runs[1]!.invocation.args).toEqual(['-K'])
    expect(runs[1]!.signal.aborted).toBe(false)
  })
  it('clears timestamps after a rejected sudo command and independently closes resources when cleanup throws', async () => {
    const fixture = feederFixture()
    const native = vi.mocked(fixture.port.run).getMockImplementation()!
    vi.mocked(fixture.port.run).mockImplementation((invocation, ...args) =>
      invocation.cleanup ? native(invocation, ...args) : Promise.reject(new Error(fixture.canary)),
    )
    await expect(
      runVaultFeeder(
        envelope({ sudo: { handle: 'secret://test-secret', path: '/usr/bin/sudo' } }),
        {},
        fixture.port,
        new AbortController().signal,
      ),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(fixture.runs[0]!.invocation.args).toEqual(['-K'])
    expect(fixture.leases[0]!.close).toHaveBeenCalledWith(false)
    const second = feederFixture()
    vi.mocked(second.port.scrub).mockImplementation(() => ({
      push: () => '',
      end: () => '',
      dispose: () => {
        throw new Error('generated cleanup failure')
      },
    }))
    await expect(
      runVaultFeeder(
        envelope({ env: { TOKEN: 'secret://test-secret' }, ssh: true }),
        {},
        second.port,
        new AbortController().signal,
      ),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(second.socketClose).toHaveBeenCalledOnce()
    expect(second.leases[0]!.value.every((byte) => byte === 0)).toBe(true)
  })
  it('refuses NUL environment and newline sudo material before native entry', async () => {
    for (const secrets of [
      { env: { TOKEN: 'secret://test-secret' } },
      { sudo: { handle: 'secret://test-secret', path: '/usr/bin/sudo' } },
    ]) {
      const { port } = feederFixture()
      const redeem = port.redeem
      port.redeem = async (approval, signal) => {
        const lease = await redeem(approval, signal)
        lease.value[0] = secrets.env ? 0 : 10
        return lease
      }
      await expect(
        runVaultFeeder(envelope(secrets), {}, port, new AbortController().signal),
      ).rejects.toThrow(UI_TEXT.vault.noAccess)
      expect(port.run).not.toHaveBeenCalled()
    }
  })
  it('bounds askpass access, resets git helpers, and clears sudo after helper failure', async () => {
    const { port, helperClose, leases, runs } = feederFixture()
    vi.mocked(port.helpers).mockImplementation((callbacks) => {
      expect(callbacks.askpass).toBeDefined()
      for (let use = 0; use < 3; use++) {
        const bytes = callbacks.askpass!()
        expect(bytes.length).toBeGreaterThan(1)
        bytes.fill(0)
      }
      expect(() => callbacks.askpass!()).toThrow(UI_TEXT.vault.noAccess)
      const bytes = callbacks.git!('get', 'protocol=https\nhost=example.test\npath=repo\n\n')
      expect(bytes.toString()).toContain('ephemeral=true')
      bytes.fill(0)
      return Promise.resolve({
        gitHelper: '/private/helper',
        askpassPath: '/private/askpass',
        close: helperClose,
      })
    })
    helperClose.mockRejectedValue(new Error('generated cleanup failure'))
    await expect(
      runVaultFeeder(
        envelope({
          sudo: { handle: 'secret://test-secret', path: '/usr/bin/sudo', askpass: true },
          git: {
            handle: 'secret://other-secret',
            protocol: 'https',
            host: 'example.test',
            path: 'repo',
          },
        }),
        {},
        port,
        new AbortController().signal,
      ),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(runs[0]!.invocation.env['GIT_CONFIG_VALUE_0']).toBe('')
    expect(runs[0]!.invocation.env['GIT_CONFIG_VALUE_2']).toBe('/private/helper')
    expect(runs[1]!.invocation.args).toEqual(['-K'])
    for (const lease of leases) expect(lease.value.every((byte) => byte === 0)).toBe(true)
  })
  it('rejects Windows elevation and validates live Windows separator equivalents', async () => {
    const fixture = feederFixture()
    const port = { ...fixture.port, platform: 'win32' as const }
    await expect(
      runVaultFeeder(
        envelope({ sudo: { handle: 'secret://test-secret', path: 'C:/Windows/sudo.exe' } }),
        {},
        port,
        new AbortController().signal,
      ),
    ).rejects.toThrow(UI_TEXT.vault.windowsElevation)
    const input = envelope()
    input.run.command = { executable: 'C:/bin/tool.exe', argv: [], cwd: 'C:/workspace' }
    input.approvals[0]!.use = {
      kind: 'environment',
      command: input.run.command,
      names: ['SERVICE_TOKEN'],
    }
    input.approvals[0]!.ticket.digest = vaultUseDigest(input.approvals[0]!.use)
    vi.mocked(port.realPath).mockImplementation((path) =>
      Promise.resolve(path.replaceAll('/', '\\')),
    )
    await expect(
      runVaultFeeder(input, {}, port, new AbortController().signal),
    ).resolves.toMatchObject({ exitCode: 0 })
  })
})
