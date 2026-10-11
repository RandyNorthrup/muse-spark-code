import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  sudoInvocation,
  VaultAskpass,
  clearSudoTimestamp,
} from '../../../src/core/vault/exec/sudoFeed'
import { vaultUseDigest } from '../../../src/core/vault/useDigest'
import { type VaultUse } from '../../../src/shared/vault'
import { UI_TEXT, VAULT_ASKPASS_TTL_MS } from '../../../src/shared/constants'
import { envelope, feederFixture } from './execFixture'

describe('M109 X sudo and askpass', () => {
  const use: Extract<VaultUse, { kind: 'sudo' }> = {
    kind: 'sudo',
    command: envelope().run.command,
    sudoPath: '/usr/bin/sudo',
  }
  it('executes the approved absolute sudo with -S -k and exact argv', () => {
    expect(sudoInvocation(use, vaultUseDigest(use))).toEqual({
      file: '/usr/bin/sudo',
      args: ['-S', '-k', '-p', '', '--', '/usr/bin/tool', '--check'],
      cwd: '/workspace',
    })
    for (const changed of [
      { ...use, sudoPath: '/attacker/sudo' },
      { ...use, command: { ...use.command, cwd: '/other' } },
      { ...use, command: { ...use.command, argv: ['--different'] } },
    ])
      expect(() => sudoInvocation(changed, vaultUseDigest(use))).toThrow(UI_TEXT.vault.useChanged)
  })
  it('caps askpass at three uses, returns private bytes and erases them on close', () => {
    const password = Buffer.from(randomBytes(32).toString('base64url'))
    const access = new VaultAskpass(password, () => 0)
    for (let count = 0; count < 3; count++) {
      const returned = access.read()
      expect(returned.subarray(0, -1)).toEqual(password)
      returned.fill(0)
    }
    expect(() => access.read()).toThrow(UI_TEXT.vault.noAccess)
    access.close()
    expect(password.every((byte) => byte === 0)).toBe(true)
    expect(() => access.read()).toThrow(UI_TEXT.vault.noAccess)
  })
  it('rejects helper line injection and refuses swapped cleanup paths or failed timestamp clearing', async () => {
    for (const bad of [
      Buffer.from('nul\0byte'),
      Buffer.from('line\nbreak'),
      Buffer.from('line\rbreak'),
    ])
      expect(() => new VaultAskpass(bad, () => 0)).toThrow(UI_TEXT.vault.noAccess)
    const { port } = feederFixture()
    for (const swapped of ['/usr/bin/sudo', '/workspace']) {
      vi.mocked(port.realPath).mockImplementation((path) =>
        Promise.resolve(path === swapped ? '/swapped' : path),
      )
      await expect(clearSudoTimestamp('/usr/bin/sudo', '/workspace', {}, port)).rejects.toThrow(
        UI_TEXT.vault.useChanged,
      )
      expect(port.run).not.toHaveBeenCalled()
    }
    vi.mocked(port.realPath).mockImplementation((path) => Promise.resolve(path))
    vi.mocked(port.run).mockResolvedValue({ exitCode: 1, isTimedOut: false, isCancelled: false })
    await expect(clearSudoTimestamp('/usr/bin/sudo', '/workspace', {}, port)).rejects.toThrow(
      UI_TEXT.vault.noAccess,
    )
  })
  it('expires at the ten-minute boundary even with remaining uses', () => {
    let time = 0
    const access = new VaultAskpass(Buffer.from(randomBytes(32).toString('hex')), () => time)
    time = VAULT_ASKPASS_TTL_MS
    expect(() => access.read()).toThrow(UI_TEXT.vault.noAccess)
    access.close()
  })
})
