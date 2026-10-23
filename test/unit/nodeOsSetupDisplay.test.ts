// M110os OS3: the console screen, its QR and the install-target
// candidates. The QR comes from the real encoder, the disk list from the
// real /sys on Linux and from a sysfs-shaped fixture everywhere, and the
// address from the real interfaces.
import { hostname, networkInterfaces } from 'node:os'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/l10n/text'
import {
  consoleDisplay,
  displayAddress,
  primaryLanAddress,
  qrBlocks,
  setupQrPayload,
} from '../../src/runtime/node/firstBoot/display'
import { listDisks } from '../../src/runtime/node/firstBoot/disks'
import { escapeHtml, seedPrefill } from '../../src/runtime/node/firstBoot/pages'
import { applySeed, createSetupState } from '../../src/runtime/node/firstBoot/setupStore'
import { issueSetupCode } from '../../src/runtime/node/firstBoot/setupCode'

describe('console display', () => {
  it('shows every fact with its QR', () => {
    const text = UI_TEXT.nodeOs
    const screen = consoleDisplay({
      address: '192.168.1.10',
      name: 'mynode',
      fingerprint: 'SHA256:ab12',
      code: 'AAAAA-BBBBB-CCCCC-DDDDD',
    })
    for (const line of [
      text.setupTitle,
      `${text.consoleAddress}: 192.168.1.10`,
      `${text.consoleName}: mynode`,
      `${text.consoleFingerprint}: SHA256:ab12`,
      `${text.consoleCode}: AAAAA-BBBBB-CCCCC-DDDDD`,
    ]) {
      expect(screen).toContain(line)
    }
    expect(screen).toContain('██')
  })

  it('encodes the setup address and code as JSON', () => {
    const payload: unknown = JSON.parse(setupQrPayload('192.168.1.10', 'AAAAA'))
    expect(payload).toEqual({ v: 1, url: 'http://192.168.1.10/', code: 'AAAAA' })
  })

  it('renders a bordered QR and gives up past every version', () => {
    const rows = qrBlocks(setupQrPayload('192.168.1.10', 'AAAAA-BBBBB-CCCCC-DDDDD'))
    if (rows === undefined) throw new Error('real payload has no QR')
    expect(rows.length).toBeGreaterThan(4)
    const width = rows[0]?.length ?? 0
    for (const row of rows) expect(row.length).toBe(width)
    expect(rows[0]?.trim()).toBe('')
    expect(rows.at(-1)?.trim()).toBe('')
    expect(qrBlocks('x'.repeat(5000))).toBeUndefined()
  })

  it('reads the address from the real interfaces', () => {
    const shown = displayAddress()
    const candidates = new Set<string>()
    const families = Object.values(networkInterfaces())
    for (const addresses of families) {
      if (addresses === undefined) continue
      for (const address of addresses) candidates.add(address.address)
    }
    expect(shown === `${hostname()}.local` || candidates.has(shown)).toBe(true)
    expect(primaryLanAddress() === undefined || candidates.has(primaryLanAddress() ?? '')).toBe(
      true,
    )
  })
})

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'node-os-disks-'))
  const block = path.join(root, 'block')
  const entry = (name: string, files: Record<string, string>): void => {
    const dir = path.join(block, name)
    mkdirSync(dir, { recursive: true })
    for (const [file, content] of Object.entries(files))
      writeFileSync(path.join(dir, file), content)
  }
  entry('sda', { size: '1953525168\n', removable: '0\n' })
  entry('sda1', { partition: '1\n', size: '1024\n', removable: '0\n' })
  entry('nvme0n1', { size: '1000215216\n', removable: '0\n' })
  entry('mmcblk0boot0', { size: '8192\n', removable: '0\n' })
  entry('sdb', { size: '0\n', removable: '1\n' })
  mkdirSync(path.join(block, 'ghost'), { recursive: true })
  return root
}

describe('disk candidates', () => {
  it('lists whole disks from a sysfs-shaped tree', () => {
    const root = fixture()
    try {
      expect(listDisks(root)).toEqual([
        {
          name: 'nvme0n1',
          device: '/dev/nvme0n1',
          sizeBytes: 1_000_215_216 * 512,
          removable: false,
        },
        { name: 'sda', device: '/dev/sda', sizeBytes: 1_953_525_168 * 512, removable: false },
      ])
      expect(listDisks(path.join(root, 'nope'))).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform === 'linux')('reads the real /sys/block shape', () => {
    for (const disk of listDisks('/sys')) {
      expect(disk.device).toBe(`/dev/${disk.name}`)
      expect(Number.isSafeInteger(disk.sizeBytes)).toBe(true)
      expect(disk.sizeBytes).toBeGreaterThan(0)
      expect(typeof disk.removable).toBe('boolean')
    }
  })
})

describe('page helpers', () => {
  it('escapes interpolated text', () => {
    expect(escapeHtml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;')
  })

  it('prefills the wizard from the seed', () => {
    const state = applySeed(createSetupState(issueSetupCode()), {
      ok: true,
      network: {
        network: { kind: 'wifi', ssid: 'SeedNet', psk: 'seed-password' },
        ignored: [],
      },
      user: { hostname: 'seedbox', sshKeys: ['ssh-ed25519 AAAA seed'], ignored: [] },
    })
    expect(seedPrefill(state)).toEqual({
      networkKind: 'wifi',
      ssid: 'SeedNet',
      diskTarget: '',
      encryption: 'tpm',
      sshKey: 'ssh-ed25519 AAAA seed',
      chrome: 'skip',
      nvidia: 'skip',
    })
    expect(state.seedHostname).toBe('seedbox')
  })
})
