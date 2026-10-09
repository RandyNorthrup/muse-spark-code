import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../os/', import.meta.url))
const update = path.join(root, 'update')

function sections(text) {
  const out = new Map()
  let current = ''
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue
    const head = line.match(/^\[(.+)\]$/)
    if (head) {
      current = head[1]
      out.set(current, {})
      continue
    }
    const kv = line.match(/^([^=]+)=(.*)$/)
    if (!current || !kv) throw new Error(`unparseable line: ${raw}`)
    out.get(current)[kv[1].trim()] = kv[2].trim()
  }
  return out
}

function repartLabels(dirs) {
  const labels = new Map()
  for (const dir of dirs) {
    const files = readdirSync(dir).filter((f) => f.endsWith('.conf'))
    for (const file of files) {
      const conf = sections(readFileSync(path.join(dir, file), 'utf8'))
      const part = conf.get('Partition')
      if (part?.Label) labels.set(part.Label, file)
    }
  }
  return labels
}

function slotDevices(conf) {
  const devices = new Map()
  for (const [name, kv] of conf) {
    if (!name.startsWith('slot.')) continue
    devices.set(name, kv.device ?? '')
  }
  return devices
}

describe('M110-OS2 RAUC slot configuration', () => {
  const efi = sections(readFileSync(path.join(update, 'system-efi.conf'), 'utf8'))
  const pi = sections(readFileSync(path.join(update, 'system-pi.conf'), 'utf8'))
  const repart = repartLabels([path.join(root, 'repart'), path.join(root, 'pi/repart')])

  it('uses the EFI backend on UEFI and the custom tryboot backend on Pi', () => {
    expect(efi.get('system').bootloader).toBe('efi')
    expect(pi.get('system').bootloader).toBe('custom')
    expect(pi.get('system')['bootloader-custom-backend']).toBe(
      '/usr/lib/muse-update/pi-tryboot-backend',
    )
  })

  it('names one bundle family for both targets', () => {
    expect(efi.get('system').compatible).toBe('Muse Node OS 1')
    expect(pi.get('system').compatible).toBe(efi.get('system').compatible)
  })

  it('carries a keyring path and no key material', () => {
    for (const conf of [efi, pi]) {
      expect(conf.get('keyring').path).toBe('/etc/rauc/keyring.pem')
    }
    for (const file of ['system-efi.conf', 'system-pi.conf']) {
      const text = readFileSync(path.join(update, file), 'utf8')
      expect(text).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/)
      expect(text).not.toMatch(/BEGIN CERTIFICATE/)
    }
  })

  it('maps every slot device onto an OS1 repart label', () => {
    const devices = [...slotDevices(efi), ...slotDevices(pi)]
    expect(devices.length).toBeGreaterThan(0)
    for (const [slot, device] of devices) {
      const label = (device.match(/^\/dev\/disk\/by-partlabel\/(.+)$/) ?? [])[1]
      expect(`${slot} device ${device}`).toBe(`${slot} device /dev/disk/by-partlabel/${label}`)
      expect(repart.has(label ?? '')).toBe(true)
    }
  })

  it('covers the A/B usr data, verity and boot payloads on both targets', () => {
    const efiLabels = slotDevices(efi)
      .values()
      .map((d) => d.split('/').pop())
      .toArray()
    expect(efiLabels).toEqual(
      expect.arrayContaining([
        'muse-efi',
        'muse-usr-a',
        'muse-usr-b',
        'muse-usr-a-verity',
        'muse-usr-b-verity',
      ]),
    )
    const piLabels = slotDevices(pi)
      .values()
      .map((d) => d.split('/').pop())
      .toArray()
    expect(piLabels).toEqual(
      expect.arrayContaining([
        'muse-pi-boot-a',
        'muse-pi-boot-b',
        'muse-usr-a',
        'muse-usr-b',
        'muse-usr-a-verity',
        'muse-usr-b-verity',
      ]),
    )
  })

  it('pairs each verity hash slot with its data slot and names boot A/B', () => {
    expect(efi.get('slot.usr.0').bootname).toBe('A')
    expect(efi.get('slot.usr.1').bootname).toBe('B')
    expect(efi.get('slot.usrhash.0').parent).toBe('usr.0')
    expect(efi.get('slot.usrhash.1').parent).toBe('usr.1')
    expect(pi.get('slot.boot.0').bootname).toBe('A')
    expect(pi.get('slot.boot.1').bootname).toBe('B')
    expect(pi.get('slot.usr.0').parent).toBe('boot.0')
    expect(pi.get('slot.usr.1').parent).toBe('boot.1')
    expect(pi.get('slot.usrhash.0').parent).toBe('boot.0')
    expect(pi.get('slot.usrhash.1').parent).toBe('boot.1')
  })

  it('leaves the non-update partitions out of the slot map', () => {
    const labels = [...slotDevices(efi).values(), ...slotDevices(pi).values()].map((d) =>
      d.split('/').pop(),
    )
    expect(labels).not.toContain('muse-root')
    expect(labels).not.toContain('muse-var')
  })
})
