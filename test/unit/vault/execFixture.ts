import { VaultExecService, type VaultExecHostPort } from '../../../src/core/vault/exec/service'
import { metadata } from '../helpers/vault/fixtures'
import { randomBytes } from 'node:crypto'
import { vi } from 'vitest'
import {
  type VaultExecEnvelope,
  type VaultRun,
  type VaultShellSecrets,
} from '../../../src/core/vault/exec/schema'
import { vaultExecUses } from '../../../src/core/vault/exec/routes'
import { vaultUseDigest } from '../../../src/core/vault/useDigest'
import {
  type VaultExecFeederPort,
  type VaultExecLease,
  type VaultExecInvocation,
  type VaultExecScrubStream,
} from '../../../src/core/vault/exec/feeder'
import { ticket } from '../helpers/vault/fixtures'

export function envelope(secrets?: VaultShellSecrets): VaultExecEnvelope {
  const run: VaultRun = {
    command: { executable: '/usr/bin/tool', argv: ['--check'], cwd: '/workspace' },
    secrets: secrets ?? { env: { SERVICE_TOKEN: 'secret://test-secret' } },
  }
  return {
    run,
    approvals: vaultExecUses(run).map(({ use }) => ({
      use,
      ticket: { ...ticket(), id: randomBytes(16).toString('hex'), digest: vaultUseDigest(use) },
    })),
  }
}

/** Deliberately test-only: production must inject T's streaming scrubber. */
export function fakeScrub(values: readonly Uint8Array[]): VaultExecScrubStream {
  const forms = values
    .flatMap((bytes) => {
      const value = Buffer.from(bytes).toString('utf8')
      return [
        value,
        encodeURIComponent(value),
        JSON.stringify(value).slice(1, -1),
        Buffer.from(bytes).toString('base64'),
        Buffer.from(bytes).toString('base64url'),
        Buffer.from(bytes).toString('hex'),
        Buffer.from(bytes).toString('hex').toUpperCase(),
      ]
    })
    .filter((value) => value.length > 0)
    .toSorted((a, b) => b.length - a.length)
  let held = ''
  return {
    push(bytes) {
      held += Buffer.from(bytes).toString('utf8')
      return ''
    },
    end() {
      let result = held
      for (const form of forms) result = result.replaceAll(form, '[redacted]')
      held = ''
      return result
    },
    dispose() {
      held = ''
      forms.fill('')
    },
  }
}

export function feederFixture() {
  const canary = randomBytes(32).toString('base64url')
  const leases: VaultExecLease[] = []
  const revocations: AbortController[] = []
  const runs: { invocation: VaultExecInvocation; signal: AbortSignal }[] = []
  const helperClose = vi.fn(() => Promise.resolve())
  const socketClose = vi.fn()
  const port: VaultExecFeederPort = {
    platform: 'linux',
    redeem: vi.fn(() => {
      const revoked = new AbortController()
      revocations.push(revoked)
      const value = Buffer.alloc(Buffer.byteLength(canary))
      value.write(canary)
      const lease = {
        value,
        username: Buffer.from('generated-user'),
        expiresAt: 120_000,
        revoked: revoked.signal,
        close: vi.fn(() => Promise.resolve()),
      }
      leases.push(lease)
      return Promise.resolve(lease)
    }),
    scrub: vi.fn(fakeScrub),
    realPath: vi.fn((path) => Promise.resolve(path)),
    now: () => 1000,
    sshSocket: vi.fn(() =>
      Promise.resolve({ path: '/private/requester.sock', close: socketClose }),
    ),
    helpers: vi.fn(() =>
      Promise.resolve({
        gitHelper: '/private/git-helper',
        askpassPath: '/private/askpass',
        close: helperClose,
      }),
    ),
    run: vi.fn((invocation, signal) => {
      runs.push({ invocation: structuredClone(invocation), signal })
      return Promise.resolve({ exitCode: 0, isTimedOut: false, isCancelled: false })
    }),
  }
  return { port, leases, revocations, runs, canary, helperClose, socketClose }
}

export function serviceFixture() {
  const input = envelope()
  const port: VaultExecHostPort = {
    platform: 'linux',
    authorize: vi.fn<VaultExecHostPort['authorize']>((_handle, _use) =>
      Promise.resolve(input.approvals[0]!.ticket),
    ),
    list: vi.fn(() => Promise.resolve([metadata()])),
    requestMissing: vi.fn(() => Promise.resolve(metadata())),
    realPath: vi.fn((path) => Promise.resolve(path)),
    launch: vi.fn<VaultExecHostPort['launch']>((_input, _signal, check) => {
      check()
      return Promise.resolve({
        stdout: 'scrubbed',
        stderr: '',
        exitCode: 0,
        isTimedOut: false,
        isCancelled: false,
      })
    }),
  }
  const service = new VaultExecService(port)
  return { input, port, service, signal: new AbortController().signal }
}
