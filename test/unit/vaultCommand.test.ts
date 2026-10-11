import { describe, expect, it } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import {
  runVaultCommand,
  vaultRead,
  type VaultCommandOptions,
} from '../../src/runtime/vault/vaultCommand'
import { UI_TEXT, VAULT_PROTOCOL_VERSION, VAULT_LIMITS } from '../../src/shared/constants'
import { approval, grant, metadata, panel, audit } from './helpers/vault/fixtures'
import { commandHarness } from './helpers/vault/runtime'

const event = (request = approval()) => ({ v: VAULT_PROTOCOL_VERSION, kind: 'approval', request })

function cancelledInput(h: ReturnType<typeof commandHarness>, phase: string): VaultCommandOptions {
  let options: VaultCommandOptions = { command: 'status' }
  switch (phase) {
    case 'open': {
      h.deps.open.mockImplementation(() => {
        h.controller.abort()
        return Promise.resolve(h.port)
      })
      break
    }
    case 'material': {
      options = { command: 'add', metadata: metadata() }
      h.deps.readMaterial.mockImplementation(() => {
        h.controller.abort()
        return Promise.resolve({ kind: 'secret', value: h.bytes })
      })

      break
    }
    case 'grant': {
      options = { command: 'grant', grant: grant() }
      h.deps.choose.mockImplementation(() => {
        h.controller.abort()
        return Promise.resolve('allowOnce')
      })

      break
    }
    // No default
  }
  return options
}

function watchBoundary(h: ReturnType<typeof commandHarness>, cause: string): void {
  switch (cause) {
    case 'before-lock': {
      h.port.status.mockResolvedValue({ ...panel().status, state: 'locked' })
      break
    }
    case 'before-expiry': {
      h.deps.now.mockReturnValue(120_000)
      break
    }
    case 'after-lock': {
      {
        h.deps.choose.mockImplementation(() => {
          h.port.status.mockResolvedValue({ ...panel().status, state: 'locked' })
          return Promise.resolve('allowOnce')
        })
        // No default
      }
      break
    }
  }
}

describe('M109 H terminal commands', () => {
  const commands: readonly (readonly string[])[] = [
    ['status'],
    ['unlock'],
    ['unlock', metadata().id],
    ['lock'],
    ['list'],
    ['add', JSON.stringify(metadata())],
    ['remove', metadata().id],
    ['grant', JSON.stringify(grant())],
    ['revoke', grant().id],
    ['audit'],
    ['import', String.raw`C:\picked\id_key`],
    ['public-key', metadata().id],
    ['watch'],
  ]
  it.each(commands)('H1 parses and runs explicit command %j', async (...args) => {
    const parsed = parseCommandLine(['vault', ...args])
    expect(parsed.command).toBe('vault')
    if (parsed.command !== 'vault') throw new Error('not vault')
    const h = commandHarness()
    expect(await runVaultCommand(parsed.options, h.deps)).toBe(0)
    expect(h.port.close).toHaveBeenCalledOnce()
    if (parsed.options.command === 'add') expect(h.bytes.every((byte) => byte === 0)).toBe(true)
  })
  it('H2 rejects values in arguments, unknown fields, extra arguments and malformed ids without echo', () => {
    for (const args of [
      ['add', JSON.stringify({ ...metadata(), value: 'private-canary' })],
      ['grant', JSON.stringify({ ...grant(), value: 'private-canary' })],
      ['remove', 'private-canary'],
      ['unlock', 'private-canary'],
      ['status', 'private-canary'],
      ['watch', '--allow'],
      ['lock', 'x', 'y'],
      ['import', 'bad\npath'],
    ]) {
      const parsed = parseCommandLine(['vault', ...args])
      expect(parsed.command).toBe('invalid')
      expect(JSON.stringify(parsed)).not.toContain('private-canary')
    }
  })
  it('H3 always wipes private material on invalid kind and failed storage', async () => {
    for (const isFails of [true, false]) {
      const h = commandHarness()
      h.port.add.mockRejectedValue(new Error('private-canary'))
      const options: VaultCommandOptions = {
        command: 'add',
        metadata: { ...metadata(), kind: isFails ? 'password' : 'secret' },
      }
      expect(await runVaultCommand(options, h.deps)).toBe(1)
      expect(h.bytes.every((byte) => byte === 0)).toBe(true)
      if (isFails) expect(h.port.add).not.toHaveBeenCalled()
      expect(JSON.stringify(h.deps.printError.mock.calls)).not.toContain('private-canary')
    }
  })
  it('H4 standing grant shows every scope and requires explicit terminal consent', async () => {
    const h = commandHarness()
    h.deps.choose.mockResolvedValue('allowSession')
    expect(await runVaultCommand({ command: 'grant', grant: grant() }, h.deps)).toBe(1)
    expect(h.port.grant).not.toHaveBeenCalled()
    expect(h.deps.choose.mock.calls[0]?.[0]).toContain(
      JSON.stringify({ ...grant(), createdBy: 'vaultCli' }),
    )
    expect(h.deps.choose.mock.calls[0]?.[1]).toEqual(['allowOnce', 'deny'])
  })
  it.each(['status', 'list', 'audit'] as const)(
    'H5 validates public %s before output',
    async (command) => {
      const h = commandHarness()
      switch (command) {
        case 'status': {
          h.port.status.mockResolvedValue({ ...panel().status, value: 'private-canary' })
          break
        }
        case 'list': {
          h.port.list.mockResolvedValue([{ ...metadata(), value: 'private-canary' }])
          break
        }
        case 'audit': {
          {
            h.port.audit.mockResolvedValue([{ ...audit(), value: 'private-canary' }])
            // No default
          }
          break
        }
      }
      expect(await runVaultCommand({ command }, h.deps)).toBe(1)
      expect(h.deps.print).not.toHaveBeenCalled()
    },
  )
  it('H5b audit filters item, requester, kind and outcome with strict argument validation', async () => {
    const h = commandHarness()
    const parsed = parseCommandLine([
      'vault',
      'audit',
      '--item',
      metadata().handle,
      '--requester',
      audit().requester.id,
      '--kind',
      'environment',
      '--outcome',
      'pending',
    ])
    if (parsed.command !== 'vault') throw new Error('parse')
    expect(await runVaultCommand(parsed.options, h.deps)).toBe(0)
    expect(h.deps.print).toHaveBeenCalledWith(JSON.stringify([audit()]))
    expect(await vaultRead(h.port, 'audit', false, { outcome: 'denied' })).toBe('[]')
    for (const args of [
      ['--kind', 'secret'],
      ['--outcome', 'unknown'],
      ['--item', 'bad'],
      ['--requester', 'bad'],
      ['--unknown', 'value'],
    ])
      expect(parseCommandLine(['vault', 'audit', ...args]).command).toBe('invalid')
  })
  it('H6 public-key exports only the chosen SSH public key', async () => {
    const h = commandHarness()
    h.port.publicKey.mockResolvedValue({
      ...metadata(),
      id: 'f'.repeat(32),
      kind: 'sshKey',
      publicKey: 'public',
    })
    expect(await runVaultCommand({ command: 'public-key', itemId: metadata().id }, h.deps)).toBe(1)
    expect(h.deps.print).not.toHaveBeenCalled()
  })
  it('H7 missing broker, aborted open and failed close return failure', async () => {
    const h = commandHarness()
    h.deps.open.mockRejectedValueOnce(new Error('private-canary'))
    expect(await runVaultCommand({ command: 'status' }, h.deps)).toBe(1)
    expect(h.deps.printError).toHaveBeenCalledWith(UI_TEXT.vault.brokerBlocked)
    h.port.close.mockRejectedValueOnce(new Error('private-canary'))
    expect(await runVaultCommand({ command: 'status' }, h.deps)).toBe(1)
    h.controller.abort()
    expect(await runVaultCommand({ command: 'status' }, h.deps)).toBe(1)
  })
  it('H7b cancellation after open, material read and grant choice prevents effects and wipes', async () => {
    for (const phase of ['open', 'material', 'grant']) {
      const h = commandHarness()
      const options = cancelledInput(h, phase)
      expect(await runVaultCommand(options, h.deps)).toBe(1)
      expect(h.port.add).not.toHaveBeenCalled()
      expect(h.port.grant).not.toHaveBeenCalled()
      expect(h.deps.print).not.toHaveBeenCalled()
      expect(h.port.close).toHaveBeenCalledOnce()
      if (phase === 'material') expect(h.bytes.every((byte) => byte === 0)).toBe(true)
    }
  })
  it('H8 ACP lists hide agent-inaccessible items', async () => {
    const h = commandHarness()
    h.port.list.mockResolvedValue([
      metadata(),
      { ...metadata(), hidden: true },
      {
        ...metadata(),
        hidden: true,
        firstParty: true,
        policy: { mode: 'never', unattendedAllowed: false, allowDisclosure: false },
      },
    ])
    expect(JSON.parse(await vaultRead(h.port, 'list', true))).toEqual([metadata()])
  })
})

describe('M109 H vault watch', () => {
  it('H9 bound answers echo id/digest and repeated events never replay', async () => {
    const request = approval()
    const h = commandHarness([event(request), event(request)])
    expect(await runVaultCommand({ command: 'watch' }, h.deps)).toBe(0)
    expect(h.port.answer).toHaveBeenCalledExactlyOnceWith({
      requestId: request.id,
      digest: request.digest,
      decision: 'allowOnce',
    })
    const title = h.deps.choose.mock.calls[0]?.[0] ?? ''
    expect(title).toContain(JSON.stringify(request.use))
    expect(title).toContain(UI_TEXT.vault.processWarning)
    expect(title).toContain(UI_TEXT.vault.paidWarning)
  })
  it.each(['before-epoch', 'after-epoch', 'expired', 'cancelled'] as const)(
    'H10 %s prevents stale terminal consent',
    async (cause) => {
      const h = commandHarness([event()])
      h.deps.choose.mockImplementation(() => {
        switch (cause) {
          case 'after-epoch': {
            h.port.status.mockResolvedValue({ ...panel().status, lockEpoch: 1 })
            break
          }
          case 'expired': {
            h.deps.now.mockReturnValue(120_000)
            break
          }
          case 'cancelled': {
            {
              h.controller.abort()
              // No default
            }
            break
          }
        }
        return Promise.resolve('allowOnce')
      })
      if (cause === 'before-epoch')
        h.port.status.mockResolvedValue({ ...panel().status, lockEpoch: 1 })
      await runVaultCommand({ command: 'watch' }, h.deps)
      expect(h.port.answer).not.toHaveBeenCalled()
      if (cause === 'before-epoch') expect(h.deps.choose).not.toHaveBeenCalled()
    },
  )
  it('H11 only permitted session choice is honored; EOF and forged choice deny', async () => {
    for (const choice of ['allowSession', 'always', 'throws']) {
      const h = commandHarness([event()])
      if (choice === 'throws') h.deps.choose.mockRejectedValue(new Error('private-canary'))
      else h.deps.choose.mockResolvedValue(choice)
      expect(await runVaultCommand({ command: 'watch' }, h.deps)).toBe(0)
      expect(h.port.answer).toHaveBeenCalledWith(expect.objectContaining({ decision: 'deny' }))
    }
    const request = approval()
    request.item.policy.mode = 'askOncePerSession'
    const h = commandHarness([event(request)])
    h.deps.choose.mockResolvedValue('allowSession')
    expect(await runVaultCommand({ command: 'watch' }, h.deps)).toBe(0)
    expect(h.port.answer).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'allowSession' }),
    )
  })
  it('H12 taint and presence are explicit; unknown event values are rejected', async () => {
    const request = approval()
    request.taint = { tainted: true, reasons: [{ source: 'web', label: 'page' }] }
    request.item.requirePresence = true
    const h = commandHarness([event(request), { ...event(request), value: 'private-canary' }])
    expect(await runVaultCommand({ command: 'watch' }, h.deps)).toBe(1)
    expect(h.deps.choose.mock.calls[0]?.[0]).toContain(UI_TEXT.vault.presenceWarning)
    expect(h.deps.choose.mock.calls[0]?.[1]).toEqual(['allowOnce', 'deny'])
    expect(h.port.answer).toHaveBeenCalledOnce()
  })
  it('H13 locked and already-expired requests are never offered', async () => {
    for (const cause of ['before-lock', 'after-lock', 'before-expiry']) {
      const h = commandHarness([event()])
      watchBoundary(h, cause)
      expect(await runVaultCommand({ command: 'watch' }, h.deps)).toBe(0)
      expect(h.port.answer).not.toHaveBeenCalled()
      if (cause !== 'after-lock') expect(h.deps.choose).not.toHaveBeenCalled()
    }
  })
  it('H14 consumed-request memory is bounded, including requests while locked', async () => {
    const request = approval()
    const events = Array.from({ length: VAULT_LIMITS.items + 1 }, (_, index) =>
      event({ ...request, id: index.toString(16).padStart(32, '0') }),
    )
    const h = commandHarness(events)
    h.port.status.mockResolvedValue({ ...panel().status, state: 'locked' })
    expect(await runVaultCommand({ command: 'watch' }, h.deps)).toBe(1)
    expect(h.port.answer).not.toHaveBeenCalled()
  })
  it('H15 a malformed answer result is rejected without returning ticket or value', async () => {
    const h = commandHarness([event()])
    h.port.answer.mockResolvedValue({ kind: 'denied', reason: 'policy', value: 'private-canary' })
    expect(await runVaultCommand({ command: 'watch' }, h.deps)).toBe(1)
    expect(h.deps.print).not.toHaveBeenCalled()
  })
})
