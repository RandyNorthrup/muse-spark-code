import { readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../os/', import.meta.url))
const update = path.join(root, 'update')
const interpreter = process.platform === 'win32' ? 'python' : 'python3'

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
      if (part?.Label) labels.set(part.Label, { file, part })
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

function labelOf(device) {
  return (device.match(/^\/dev\/disk\/by-partlabel\/(.+)$/) ?? [])[1]
}

describe('M110-OS2 RAUC slot configuration', () => {
  const efi = sections(readFileSync(path.join(update, 'system-efi.conf'), 'utf8'))
  const pi = sections(readFileSync(path.join(update, 'system-pi.conf'), 'utf8'))
  const repart = repartLabels([path.join(root, 'repart'), path.join(root, 'pi/repart')])

  it('uses the EFI backend on UEFI and the custom tryboot backend on Pi', () => {
    expect(efi.get('system').bootloader).toBe('efi')
    expect(pi.get('system').bootloader).toBe('custom')
    // RAUC 1.13 config_file.c reads the custom handler from [handlers]:
    // a key under [system] is never consulted.
    expect(pi.get('handlers')['bootloader-custom-backend']).toBe(
      '/usr/lib/muse-update/pi-tryboot-backend',
    )
    expect(pi.get('system')['bootloader-custom-backend']).toBeUndefined()
  })

  it('satisfies the RAUC 1.13 parser rules on both targets', () => {
    const result = spawnSync(
      interpreter,
      [
        path.join(update, 'check-rauc-conf.py'),
        path.join(update, 'system-efi.conf'),
        path.join(update, 'system-pi.conf'),
      ],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('RAUC_CONF_OK')
    expect(result.stdout).not.toContain('RAUC_CONF_HANDLER')
    expect(result.stdout).not.toContain('RAUC_CONF_CHILD')
    expect(result.stdout).not.toContain('RAUC_CONF_DUPLICATE')
  })

  it.each([
    [
      'handler under system',
      '[system]\nbootloader=custom\nbootloader-custom-backend=/x\n',
      'HANDLER_SECTION',
    ],
    [
      'duplicate bootname',
      '[system]\nbootloader=efi\n[slot.a.0]\ndevice=/dev/a\ntype=ext4\nbootname=A\n[slot.a.1]\ndevice=/dev/b\ntype=ext4\nbootname=A\n',
      'DUPLICATE_BOOTNAME',
    ],
    [
      'child with bootname',
      '[system]\nbootloader=efi\n[slot.a.0]\ndevice=/dev/a\ntype=ext4\nbootname=A\n[slot.b.0]\ndevice=/dev/b\ntype=ext4\nbootname=B\nparent=a.0\n',
      'CHILD_BOOTNAME',
    ],
    [
      'dangling parent',
      '[system]\nbootloader=efi\n[slot.a.0]\ndevice=/dev/a\ntype=ext4\nparent=nope.0\n',
      'PARENT_MISSING',
    ],
  ])('checker refuses %s', (_label, content, token) => {
    // Drive the checker's check_file directly through a heredoc-free import.
    const direct = spawnSync(
      interpreter,
      [
        '-c',
        `import importlib.util; spec = importlib.util.spec_from_file_location("c", ${JSON.stringify(path.join(update, 'check-rauc-conf.py'))}); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); print(m.check_file(${JSON.stringify(content)}, "probe"))`,
      ],
      { encoding: 'utf8' },
    )
    expect(direct.status).toBe(0)
    expect(direct.stdout).toContain(`RAUC_CONF_${token}`)
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
      const label = labelOf(device)
      expect(`${slot} device ${device}`).toBe(`${slot} device /dev/disk/by-partlabel/${label}`)
      expect(repart.has(label ?? '')).toBe(true)
    }
  })

  it('pins the exact slot to partition mapping on both targets', () => {
    // A swap of two device values (usr.0 <-> usr.1) keeps every label present
    // but boots/updates the wrong pairing: only an exact map fails it.
    const efiDevices = slotDevices(efi)
    expect(
      Object.fromEntries([...efiDevices].map(([slot, device]) => [slot, labelOf(device)])),
    ).toEqual({
      'slot.efi.0': 'muse-efi',
      'slot.usr.0': 'muse-usr-a',
      'slot.usr.1': 'muse-usr-b',
      'slot.usrhash.0': 'muse-usr-a-verity',
      'slot.usrhash.1': 'muse-usr-b-verity',
    })
    const piDevices = slotDevices(pi)
    expect(
      Object.fromEntries([...piDevices].map(([slot, device]) => [slot, labelOf(device)])),
    ).toEqual({
      'slot.boot.0': 'muse-pi-boot-a',
      'slot.boot.1': 'muse-pi-boot-b',
      'slot.usr.0': 'muse-usr-a',
      'slot.usr.1': 'muse-usr-b',
      'slot.usrhash.0': 'muse-usr-a-verity',
      'slot.usrhash.1': 'muse-usr-b-verity',
    })
  })

  it('keeps the shipped partition sizes each slot maps onto', () => {
    const expectedSizes = {
      // OS1 moved the ESP to 260M (88911bdef7) and check.py locks it there.
      'muse-efi': ['260M', '260M'],
      'muse-usr-a': ['1536M', '1536M'],
      'muse-usr-b': ['1536M', '1536M'],
      'muse-usr-a-verity': ['64M', '64M'],
      'muse-usr-b-verity': ['64M', '64M'],
      'muse-pi-boot-a': ['260M', '260M'],
      'muse-pi-boot-b': ['260M', '260M'],
    }
    for (const [label, [min, max]] of Object.entries(expectedSizes)) {
      const entry = repart.get(label)
      expect(entry).toBeDefined()
      expect(entry.part['SizeMinBytes']).toBe(min)
      expect(entry.part['SizeMaxBytes']).toBe(max)
    }
  })

  it('keeps the controller FAT out of the slot map', () => {
    // Post-handoff autoboot.txt lives on muse-pi-ctl, which is never a RAUC
    // slot: no slot device may reference it.
    const labels = [...slotDevices(efi).values(), ...slotDevices(pi).values()].map((d) =>
      labelOf(d),
    )
    expect(labels).not.toContain('muse-pi-ctl')
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
    // Pi boot slots carry the A/B bootnames; usr and hash slots ride along
    // as children with parent and no bootname of their own.
    expect(pi.get('slot.boot.0').bootname).toBe('A')
    expect(pi.get('slot.boot.1').bootname).toBe('B')
    expect(pi.get('slot.usr.0').parent).toBe('boot.0')
    expect(pi.get('slot.usr.0').bootname).toBeUndefined()
    expect(pi.get('slot.usr.1').parent).toBe('boot.1')
    expect(pi.get('slot.usr.1').bootname).toBeUndefined()
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
