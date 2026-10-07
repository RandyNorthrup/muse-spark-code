import { randomBytes } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  chooseVaultDecision,
  readVaultLine,
  readVaultMaterial,
} from '../../src/runtime/vault/vaultInput'
import { wipeVaultMaterial } from '../../src/runtime/vault/vaultCommand'
import { vaultMaterialSchema } from '../../src/shared/vault'
import { UI_TEXT, VAULT_LIMITS } from '../../src/shared/constants'

function inputHarness(isTTY = false) {
  const input = Object.assign(new PassThrough(), { isTTY, isRaw: false, setRawMode: vi.fn() })
  const output = new PassThrough()
  const chunks: string[] = []
  output.on('data', (data: Buffer) => {
    chunks.push(data.toString('utf8'))
  })
  const controller = new AbortController()
  return { input, output, chunks, controller }
}

afterEach(() => vi.restoreAllMocks())

describe('M109 H private terminal input', () => {
  it('H20 material comes only from bounded stdin and every byte field is owned', async () => {
    const h = inputHarness()
    const value = randomBytes(32)
    const reading = readVaultMaterial(h.input, h.output, h.controller.signal)
    h.input.end(JSON.stringify({ kind: 'secret', value: value.toString('base64') }))
    const material = vaultMaterialSchema.parse(await reading)
    expect(material.kind).toBe('secret')
    if (material.kind !== 'secret') throw new Error('kind')
    expect(Buffer.from(material.value)).toEqual(value)
    wipeVaultMaterial(material)
    expect(material.value.every((byte) => byte === 0)).toBe(true)
    expect(h.chunks).toEqual([])
  })
  it.each([
    'accessToken',
    'refreshToken',
    'username',
    'password',
    'totpSeed',
    'seed',
    'privateKey',
    'cookies',
  ])('H21 wipe includes %s', (field) => {
    const bytes = randomBytes(32)
    wipeVaultMaterial({ [field]: bytes })
    expect(bytes.every((byte) => byte === 0)).toBe(true)
  })
  it('H22 TTY echo restored after enter/backspace; value never echoed', async () => {
    const h = inputHarness(true)
    const reading = readVaultLine(h.input, h.output, UI_TEXT.vault.value, h.controller.signal)
    const incoming = Buffer.from('private-x\u{7F}y\r')
    h.input.write(incoming)
    const line = await reading
    expect(line.toString()).toBe('private-y')
    expect(incoming.every((byte) => byte === 0)).toBe(true)
    expect(h.input.setRawMode.mock.calls).toEqual([[true], [false]])
    expect(h.chunks.join('')).not.toContain('private-')
    expect(h.input.listenerCount('data')).toBe(0)
    line.fill(0)
  })
  it.each(['abort', 'interrupt', 'eof', 'error', 'output-error'])(
    'H23 %s restores echo and detaches listeners',
    async (cause) => {
      const h = inputHarness(true)
      const reading = readVaultLine(h.input, h.output, UI_TEXT.vault.value, h.controller.signal)
      const observed = expect(reading).rejects.toThrow(UI_TEXT.vault.noAccess)
      switch (cause) {
        case 'abort': {
          h.controller.abort()
          break
        }
        case 'interrupt': {
          h.input.write(Buffer.from([3]))
          break
        }
        case 'eof': {
          h.input.end()
          break
        }
        case 'error': {
          h.input.emit('error', new Error('private-canary'))
          break
        }
        case 'output-error': {
          {
            h.output.emit('error', new Error('private-canary'))
            // No default
          }
          break
        }
      }
      await observed
      expect(h.input.setRawMode.mock.calls).toEqual([[true], [false]])
      expect(h.input.listenerCount('data')).toBe(0)
    },
  )
  it('H24 rejects oversized input and malformed base64 without private errors', async () => {
    for (const bytes of [
      Buffer.alloc(VAULT_LIMITS.frameBytes + 1, 65),
      Buffer.from('{"kind":"secret","value":"private-canary"}'),
    ]) {
      const h = inputHarness()
      const reading = readVaultMaterial(h.input, h.output, h.controller.signal)
      const observed = expect(reading).rejects.toThrow(UI_TEXT.vault.noAccess)
      h.input.end(bytes)
      await observed
    }
  })
  it('H25 pipes cannot approve uses or standing grants', async () => {
    const h = inputHarness()
    await expect(
      chooseVaultDecision(h.input, h.output, 'test', ['allowOnce', 'deny'], h.controller.signal),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
  })
  it('H26 typed answers match only offered ids; raw mode failures fail closed', async () => {
    const h = inputHarness(true)
    const answer = chooseVaultDecision(
      h.input,
      h.output,
      'test',
      ['allowOnce', 'deny'],
      h.controller.signal,
    )
    h.input.write(Buffer.from('allowSession\r'))
    expect(await answer).toBe('deny')
    h.input.setRawMode.mockImplementation(() => {
      throw new Error('private-canary')
    })
    await expect(readVaultLine(h.input, h.output, 'test', h.controller.signal)).rejects.toThrow(
      UI_TEXT.vault.noAccess,
    )
  })
  it('H27 prior raw mode is restored; a TTY without raw-mode support refuses entry', async () => {
    const h = inputHarness(true)
    h.input.isRaw = true
    const reading = readVaultLine(h.input, h.output, 'test', h.controller.signal)
    h.input.write(Buffer.from('x\r'))
    const bytes = await reading
    bytes.fill(0)
    expect(h.input.setRawMode.mock.calls).toEqual([[true], [true]])
    const unsupported = Object.assign(new PassThrough(), { isTTY: true })
    await expect(readVaultLine(unsupported, h.output, 'test', h.controller.signal)).rejects.toThrow(
      UI_TEXT.vault.noAccess,
    )
  })
  it('H28 malformed material wipes every allocated private byte owner, including partial decode', async () => {
    const h = inputHarness()
    const value = randomBytes(32).toString('base64')
    const allocation = vi.spyOn(Buffer, 'alloc')
    const reading = readVaultMaterial(h.input, h.output, h.controller.signal)
    const observed = expect(reading).rejects.toThrow(UI_TEXT.vault.noAccess)
    h.input.end(JSON.stringify({ kind: 'oauth', accessToken: value, refreshToken: 'bad' }))
    await observed
    const owners = allocation.mock.results.flatMap((result) =>
      result.type === 'return' && result.value instanceof Buffer ? [result.value] : [],
    )
    expect(owners.some((owner) => owner.length === 32)).toBe(true)
    expect(owners.every((owner) => owner.every((byte) => byte === 0))).toBe(true)
  })
  it('H29 private material rejects unknown kinds and extra fields after byte decode', async () => {
    for (const extra of [{ kind: 'unknown' }, { kind: 'secret', extra: 'private-canary' }]) {
      const h = inputHarness()
      const reading = readVaultMaterial(h.input, h.output, h.controller.signal)
      const observed = expect(reading).rejects.toThrow(UI_TEXT.vault.noAccess)
      h.input.end(JSON.stringify({ value: randomBytes(32).toString('base64'), ...extra }))
      await observed
      expect(h.chunks.join('')).not.toContain('private-canary')
    }
  })
  it('H29b prototype keys cannot disappear at the record boundary', async () => {
    const h = inputHarness()
    const reading = readVaultMaterial(h.input, h.output, h.controller.signal)
    const observed = expect(reading).rejects.toThrow(UI_TEXT.vault.noAccess)
    h.input.end(
      JSON.stringify(
        Object.fromEntries([
          ['kind', 'secret'],
          ['value', randomBytes(32).toString('base64')],
          ['__proto__', { kind: 'secret' }],
        ]),
      ),
    )
    await observed
  })
  it('H24b standalone line reader rejects the size boundary before material parsing', async () => {
    const h = inputHarness()
    const reading = readVaultLine(h.input, h.output, 'test', h.controller.signal)
    const observed = expect(reading).rejects.toThrow(UI_TEXT.vault.noAccess)
    h.input.end(Buffer.alloc(VAULT_LIMITS.frameBytes + 1, 65))
    await observed
  })
})
