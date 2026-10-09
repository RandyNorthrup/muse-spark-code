import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const check = fileURLToPath(new URL('../../os/update/pi-eeprom-check', import.meta.url))
const temporary = []
function directory() {
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'm110-os2-eeprom-'))
  temporary.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fixture(dir, name, body, isExecutable = false) {
  const file = path.join(dir, name)
  writeFileSync(file, body)
  if (isExecutable) chmodSync(file, 0o755)
  return file
}

const cpuinfo = (model, revision) =>
  `processor\t: 0\nModel\t\t: ${model}\nRevision\t: ${revision}\nSerial\t\t: 10000000\n`
const vc = (firstLine) => `#!/bin/sh\necho "${firstLine}"\necho "version abc (release)"\n`

function run(revisionFile, vcCmd) {
  return spawnSync('sh', [check], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MUSE_PI_REVISION_FILE: revisionFile,
      MUSE_VCGENCMD: vcCmd,
    },
  })
}

describe('M110-OS2 Pi EEPROM checks', () => {
  it('requires a writable EEPROM on Pi 4 rev 1.0 and 1.1', () => {
    const dir = directory()
    const fakeVc = fixture(dir, 'vc', vc('2025/03/10 12:00:00'), true)
    for (const [rev, code] of [
      ['Raspberry Pi 4 Model B Rev 1.0', 'b03110'],
      ['Raspberry Pi 4 Model B Rev 1.1', 'b03111'],
    ]) {
      const cpu = fixture(dir, `cpu-${code}`, cpuinfo(rev, code))
      const result = run(cpu, fakeVc)
      expect(result.stdout.trim()).toBe('PI4_EEPROM_WRITE_REQUIRED')
      expect(result.status).toBe(3)
    }
  })

  it('passes a later Pi 4 without reading the bootloader', () => {
    const dir = directory()
    const cpu = fixture(dir, 'cpu', cpuinfo('Raspberry Pi 4 Model B Rev 1.2', 'b03112'))
    const missing = path.join(dir, 'no-vcgencmd')
    const result = run(cpu, missing)
    expect(result.stdout.trim()).toBe('OK')
    expect(result.status).toBe(0)
  })

  it('reads the Pi 4 revision from hex when the Model line is absent', () => {
    const dir = directory()
    const early = fixture(dir, 'early', 'processor\t: 0\nRevision\t: b03111\n')
    const result = run(early, path.join(dir, 'no-vcgencmd'))
    expect(result.stdout.trim()).toBe('PI4_EEPROM_WRITE_REQUIRED')
    expect(result.status).toBe(3)
  })

  it('passes a Pi 5 with a bootloader dated 2025-03-10 or later', () => {
    const dir = directory()
    const cpu = fixture(dir, 'cpu', cpuinfo('Raspberry Pi 5 Model B Rev 1.0', 'c04170'))
    for (const date of ['2025/03/10 12:00:00', '2025-03-11 12:00:00', '2026/01/05 00:00:00']) {
      const fakeVc = fixture(dir, `vc-${date.slice(0, 4)}`, vc(date), true)
      const result = run(cpu, fakeVc)
      expect(result.stdout.trim()).toBe('OK')
      expect(result.status).toBe(0)
    }
  })

  it('refuses a Pi 5 with an older bootloader', () => {
    const dir = directory()
    const cpu = fixture(dir, 'cpu', cpuinfo('Raspberry Pi 5 Model B Rev 1.0', 'c04170'))
    const fakeVc = fixture(dir, 'vc', vc('2024/09/23 14:00:00'), true)
    const result = run(cpu, fakeVc)
    expect(result.stdout.trim()).toBe('PI5_BOOTLOADER_TOO_OLD')
    expect(result.status).toBe(4)
  })

  it.each([
    ['missing revision file', null, '2025/03/10 12:00:00'],
    ['unparseable bootloader date', 'cpu', 'garbage'],
  ])('fails closed with CANNOT_DETERMINE (%s)', (_label, cpuName, vcDate) => {
    const dir = directory()
    const cpu =
      cpuName === null
        ? path.join(dir, 'no-such-file')
        : fixture(dir, 'cpu', cpuinfo('Raspberry Pi 5 Model B Rev 1.0', 'c04170'))
    const fakeVc = fixture(dir, 'vc', vc(vcDate), true)
    const result = run(cpu, fakeVc)
    expect(result.stdout.trim()).toBe('CANNOT_DETERMINE')
    expect(result.status).toBe(2)
  })

  it('fails closed on old-style revision codes', () => {
    const dir = directory()
    const cpu = fixture(dir, 'cpu', 'processor\t: 0\nRevision\t: 0002\n')
    const result = run(cpu, path.join(dir, 'no-vcgencmd'))
    expect(result.stdout.trim()).toBe('CANNOT_DETERMINE')
    expect(result.status).toBe(2)
  })

  it('emits a machine-readable code only on stdout', () => {
    const dir = directory()
    const cpu = fixture(dir, 'cpu', cpuinfo('Raspberry Pi 4 Model B Rev 1.1', 'b03111'))
    const fakeVc = fixture(dir, 'vc', vc('2025/03/10 12:00:00'), true)
    const result = run(cpu, fakeVc)
    expect(result.stdout.trim()).toMatch(/^[A-Z0-9_]+$/)
    expect(result.stdout.trim()).not.toContain(' ')
  })
})
