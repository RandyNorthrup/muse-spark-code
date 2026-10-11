import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { VaultExecService } from '../../../src/core/vault/exec/service'
import { vaultExecTools } from '../../../src/core/vault/exec/tools'
import {
  vaultRunSchema,
  vaultShellSecretsSchema,
  vaultExecEnvelopeSchema,
  vaultExecResultSchema,
} from '../../../src/core/vault/exec/schema'
import { readVaultExecEnvelope, vaultExecEntry } from '../../../src/core/vault/exec/entry'
import { VAULT_EXEC_PARAMETERS } from '../../../src/core/vault/exec/toolSchema'
import { UI_TEXT, VAULT_LIMITS } from '../../../src/shared/constants'
import { metadata } from '../helpers/vault/fixtures'
import { envelope, feederFixture, serviceFixture } from './execFixture'

describe('M109 X routes and handles', () => {
  it('keeps shipped JSON descriptors equal to the validating schemas without runtime conversion', () => {
    expect(VAULT_EXEC_PARAMETERS.list).toEqual(z.toJSONSchema(z.strictObject({})))
    expect(VAULT_EXEC_PARAMETERS.request).toEqual(
      z.toJSONSchema(
        z.strictObject({
          name: z
            .string()
            .check(z.regex(/^[a-z][a-z0-9-]{0,47}$/u), z.maxLength(VAULT_LIMITS.name)),
        }),
      ),
    )
    expect(VAULT_EXEC_PARAMETERS.run).toEqual(z.toJSONSchema(vaultRunSchema))
    expect(VAULT_EXEC_PARAMETERS.secrets).toEqual(z.toJSONSchema(vaultShellSecretsSchema))
  })
  it('validates strict handle-only secrets and refuses handles in argv', () => {
    const run = envelope().run
    expect(vaultRunSchema.safeParse(run).success).toBe(true)
    for (const secrets of [
      {},
      {
        env: Object.fromEntries(
          Array.from({ length: VAULT_LIMITS.names + 1 }, (_, index) => [
            `TOKEN_${String(index)}`,
            'secret://test-secret',
          ]),
        ),
      },
      { env: { TOKEN: randomBytes(32).toString('hex') } },
      { env: { TOKEN: 'secret://test-secret' }, approval: 'allow' },
      { env: { ssh_auth_sock: 'secret://test-secret' } },
      { stdin: 'secret://test-secret', totp: 'secret://test-secret' },
      {
        sudo: { handle: 'secret://test-secret', path: '/usr/bin/sudo' },
        stdin: 'secret://test-secret',
      },
    ])
      expect(vaultRunSchema.safeParse({ ...run, secrets }).success).toBe(false)
    expect(
      vaultRunSchema.safeParse({
        ...run,
        command: { ...run.command, argv: ['secret://test-secret'] },
      }).success,
    ).toBe(false)
    expect(
      vaultExecEnvelopeSchema.safeParse({ ...envelope(), ticketInEnvironment: 'forged' }).success,
    ).toBe(false)
    expect(
      vaultExecResultSchema.safeParse({
        stdout: '',
        stderr: '',
        exitCode: 0,
        isTimedOut: false,
        isCancelled: false,
        isWorkspaceShutdownProven: true,
      }).success,
    ).toBe(false)
  })
  it('authorizes exact uses, passes launch admission and preserves timeout policy', async () => {
    const { service, port, input, signal } = serviceFixture()
    const check = vi.fn()
    await expect(service.run(input.run, signal, check, { timeoutMs: 1234 })).resolves.toMatchObject(
      { stdout: 'scrubbed' },
    )
    expect(port.authorize).toHaveBeenCalledWith(
      'secret://test-secret',
      input.approvals[0]!.use,
      signal,
    )
    expect(port.launch).toHaveBeenCalledWith(input, signal, expect.any(Function), {
      timeoutMs: 1234,
    })
    expect(check.mock.calls.length).toBeGreaterThan(2)
  })
  it('refuses a wrong ticket digest before launch', async () => {
    const { service, port, input, signal } = serviceFixture()
    input.approvals[0]!.ticket.digest = 'f'.repeat(64)
    await expect(service.run(input.run, signal, () => undefined)).rejects.toThrow(
      UI_TEXT.vault.useChanged,
    )
    expect(port.launch).not.toHaveBeenCalled()
  })
  it('rechecks cancellation and workspace admission after asynchronous authorization', async () => {
    const { service, port, input } = serviceFixture()
    const controller = new AbortController()
    vi.mocked(port.authorize).mockImplementation(() => {
      controller.abort()
      return Promise.resolve(input.approvals[0]!.ticket)
    })
    await expect(service.run(input.run, controller.signal, () => undefined)).rejects.toThrow()
    expect(port.launch).not.toHaveBeenCalled()
  })
  it('refuses Windows elevation before prompting or loading paths', async () => {
    const { port, signal } = serviceFixture()
    const service = new VaultExecService({ ...port, platform: 'win32' })
    await expect(
      service.run(
        envelope({ sudo: { handle: 'secret://test-secret', path: 'C:/Windows/sudo.exe' } }).run,
        signal,
        () => undefined,
      ),
    ).rejects.toThrow(UI_TEXT.vault.windowsElevation)
    expect(port.authorize).not.toHaveBeenCalled()
    expect(port.realPath).not.toHaveBeenCalled()
  })
  it('normalizes Windows separators before authorizing', async () => {
    const { service, port, signal } = serviceFixture()
    const run = {
      ...envelope().run,
      command: { executable: String.raw`C:\bin\tool.exe`, cwd: String.raw`C:\workspace`, argv: [] },
    }
    vi.mocked(port.authorize).mockImplementation((_handle, use) =>
      Promise.resolve({
        ...envelope().approvals[0]!.ticket,
        digest:
          (use.kind === 'environment' ? use.command.executable : '') === 'C:/bin/tool.exe'
            ? 'f'.repeat(64)
            : 'e'.repeat(64),
      }),
    )
    await expect(service.run(run, signal, () => undefined)).rejects.toThrow(
      UI_TEXT.vault.useChanged,
    )
    expect(port.authorize).toHaveBeenCalledWith(
      'secret://test-secret',
      expect.objectContaining({
        command: { executable: 'C:/bin/tool.exe', cwd: 'C:/workspace', argv: [] },
      }),
      signal,
    )
  })
  it('lists only public metadata and returns a handle after host-owned entry', async () => {
    const { service, port, signal } = serviceFixture()
    vi.mocked(port.list).mockResolvedValue([metadata(), { ...metadata(), hidden: true }])
    const listed: unknown = JSON.parse(await service.list(signal))
    expect(listed).toEqual([
      {
        handle: 'secret://test-secret',
        kind: 'secret',
        label: 'Generated test item',
        bindings: [],
      },
    ])
    expect(await service.requestMissing('test-secret', signal)).toBe('secret://test-secret')
    vi.mocked(port.requestMissing).mockResolvedValue({ ...metadata(), hidden: true })
    await expect(service.requestMissing('test-secret', signal)).rejects.toThrow(
      UI_TEXT.vault.noAccess,
    )
  })
  it('exposes the same three tools without an approval answer or secret value parameter', async () => {
    const { service, signal, input } = serviceFixture()
    const tools = vaultExecTools(service, () => undefined, {
      refused: 'Credential use refused',
      list: 'List handles',
      request: 'Ask the person to add a credential',
      run: 'Run a command with brokered uses',
    })
    expect(tools.map(({ name }) => name)).toEqual(['secret_list', 'secret_request', 'vault_run'])
    expect(JSON.stringify(tools.map(({ inputSchema }) => inputSchema))).not.toContain('allowOnce')
    await expect(tools[0]!.call({ disclosure: true }, signal)).rejects.toThrow()
    await expect(tools[0]!.call({}, signal)).resolves.toContain('secret://test-secret')
    await expect(tools[1]!.call({ name: 'test-secret' }, signal)).resolves.toBe(
      'secret://test-secret',
    )
    await expect(tools[2]!.call(input.run, signal)).resolves.toContain('scrubbed')
    expect(z.toJSONSchema(vaultRunSchema)).toEqual(tools[2]!.inputSchema)
    await expect(tools[1]!.call({ name: '../forged' }, signal)).rejects.toThrow(
      'Credential use refused',
    )
    const fixture = serviceFixture()
    vi.mocked(fixture.port.launch).mockResolvedValue({
      stdout: 'unsafe',
      stderr: '',
      exitCode: null,
      isTimedOut: false,
      isCancelled: false,
    })
    const refused = vaultExecTools(fixture.service, () => undefined, {
      list: '',
      request: '',
      run: '',
      refused: 'Credential use refused',
    })
    await expect(refused[2]!.call(input.run, signal)).rejects.toThrow('Credential use refused')
  })
  it('accepts an envelope only from the bounded inherited pipe and wipes input buffers', async () => {
    const input = envelope()
    const bytes = Buffer.from(JSON.stringify(input))
    await expect(readVaultExecEnvelope(Readable.from([bytes]))).resolves.toEqual(input)
    expect(bytes.every((byte) => byte === 0)).toBe(true)
    await expect(
      readVaultExecEnvelope(
        Readable.from([Buffer.from(' '.repeat(VAULT_LIMITS.frameBytes) + JSON.stringify(input))]),
      ),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    await expect(readVaultExecEnvelope(Readable.from([Buffer.from('{}')]))).rejects.toThrow(
      UI_TEXT.vault.noAccess,
    )
    const { port } = feederFixture()
    await expect(
      vaultExecEntry(
        Readable.from([Buffer.from(JSON.stringify(input))]),
        {},
        port,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ exitCode: 0 })
  })
})
