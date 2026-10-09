import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const check = fileURLToPath(new URL('../../os/update/pi-eeprom-check', import.meta.url))

// The check is POSIX sh. CI runs unit tests on Windows with Git Bash, so
// resolve a shell the way the runner does and hand it forward-slash paths;
// a missing shell fails loudly, never skips.
function posixPath(p) {
  return process.platform === 'win32' ? p.split(path.sep).join(path.posix.sep) : p
}
let shell = 'sh'
if (process.platform === 'win32') {
  const candidates = [
    'sh',
    path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/sh.exe'),
  ]
  const found = candidates.find((candidate) => {
    try {
      const probe = spawnSync(candidate, ['-c', 'echo os2-shell-ok'], { encoding: 'utf8' })
      return probe.status === 0 && probe.stdout.includes('os2-shell-ok')
    } catch {
      return false
    }
  })
  if (found === undefined) throw new Error('M110-OS2 needs a POSIX shell (Git for Windows)')
  shell = found
}
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
const eeprom = (lines) => `#!/bin/sh\n${lines.map((line) => `echo "${line}"`).join('\n')}\n`
// Status-mode output in upstream rpi-eeprom-update's printVersions shape
// (raspberrypi/rpi-eeprom): one BOOTLOADER line, CURRENT/LATEST/RELEASE,
// then the VL805 block. It carries no write-protect line.
const upstreamStatus = (state, exitCode) =>
  `${eeprom([
    `BOOTLOADER: ${state}`,
    '   CURRENT: Thu 18 Jan 13:59:23 UTC 2024 (1705586363)',
    '    LATEST: Thu 18 Jan 13:59:23 UTC 2024 (1705586363)',
    '   RELEASE: default (/lib/firmware/raspberrypi/bootloader-2711/default)',
    '            Use raspi-config to change the release.',
    '',
    '  VL805_FW: Using bootloader EEPROM',
    '     VL805: up to date',
    '   CURRENT: 000138c0',
    '    LATEST: 000138c0',
  ])}exit ${exitCode}\n`

function run(revisionFile, vcCmd, eepromCmd) {
  return spawnSync(shell, [posixPath(check)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MUSE_PI_REVISION_FILE: posixPath(revisionFile),
      MUSE_VCGENCMD: posixPath(vcCmd),
      MUSE_RPI_EEPROM_CMD: posixPath(eepromCmd),
    },
  })
}

describe('M110-OS2 Pi EEPROM checks', () => {
  it('requires a writable, updated EEPROM on Pi 4 rev 1.0 and 1.1 with an update available', () => {
    const dir = directory()
    const fakeVc = fixture(dir, 'vc', vc('2025/03/10 12:00:00'), true)
    const stale = fixture(dir, 'eeprom-stale', upstreamStatus('update available', 1), true)
    for (const [rev, code] of [
      ['Raspberry Pi 4 Model B Rev 1.0', 'b03110'],
      ['Raspberry Pi 4 Model B Rev 1.1', 'b03111'],
    ]) {
      const cpu = fixture(dir, `cpu-${code}`, cpuinfo(rev, code))
      const result = run(cpu, fakeVc, stale)
      expect(result.stdout.trim()).toBe('PI4_EEPROM_WRITE_REQUIRED')
      expect(result.status).toBe(3)
      expect(result.stderr).toContain(
        'remedy=make-eeprom-writable-run-rpi-eeprom-update-a-reboot-retry',
      )
    }
  })

  it('passes an early Pi 4 once upstream status reports the bootloader up to date', () => {
    const dir = directory()
    const fakeVc = fixture(dir, 'vc', vc('2025/03/10 12:00:00'), true)
    const current = fixture(dir, 'eeprom-current', upstreamStatus('up to date', 0), true)
    const cpu = fixture(dir, 'cpu', cpuinfo('Raspberry Pi 4 Model B Rev 1.1', 'b03111'))
    const result = run(cpu, fakeVc, current)
    expect(result.stdout.trim()).toBe('OK')
    expect(result.status).toBe(0)
  })

  it.each([
    ['a missing tool', null],
    ['invented write-protect lines', eeprom(['EEPROM write protect: disabled'])],
    ['no BOOTLOADER line', eeprom(['   CURRENT: Thu 18 Jan 13:59:23 UTC 2024 (1705586363)'])],
    ['both BOOTLOADER lines', eeprom(['BOOTLOADER: up to date', 'BOOTLOADER: update available'])],
    ['unknown wording', eeprom(['BOOTLOADER: frozen'])],
    ['a failed status call', upstreamStatus('up to date', 2)],
  ])('fails closed on an early Pi 4 with %s', (_label, body) => {
    const dir = directory()
    const fakeVc = fixture(dir, 'vc', vc('2025/03/10 12:00:00'), true)
    const cpu = fixture(dir, 'cpu', cpuinfo('Raspberry Pi 4 Model B Rev 1.1', 'b03111'))
    const tool =
      body === null ? path.join(dir, 'no-rpi-eeprom') : fixture(dir, 'eeprom', body, true)
    const result = run(cpu, fakeVc, tool)
    expect(result.stdout.trim()).toBe('CANNOT_DETERMINE')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('remedy=')
  })

  it('passes a later Pi 4 without reading the bootloader', () => {
    const dir = directory()
    const cpu = fixture(dir, 'cpu', cpuinfo('Raspberry Pi 4 Model B Rev 1.2', 'b03112'))
    const missing = path.join(dir, 'no-vcgencmd')
    const result = run(cpu, missing, missing)
    expect(result.stdout.trim()).toBe('OK')
    expect(result.status).toBe(0)
  })

  it('reads the Pi 4 revision from hex when the Model line is absent', () => {
    const dir = directory()
    const early = fixture(dir, 'early', 'processor\t: 0\nRevision\t: b03111\n')
    const locked = fixture(dir, 'eeprom-stale', upstreamStatus('update available', 1), true)
    const result = run(early, path.join(dir, 'no-vcgencmd'), locked)
    expect(result.stdout.trim()).toBe('PI4_EEPROM_WRITE_REQUIRED')
    expect(result.status).toBe(3)
  })

  it.each([
    ['arithmetic', 'b03111+1'],
    ['trailing garbage', 'b03111x'],
    ['non-hex', 'zzzzzz'],
  ])('refuses a non-hex revision (%s) before arithmetic', (_label, revision) => {
    const dir = directory()
    const cpu = fixture(dir, 'cpu', cpuinfo('Raspberry Pi 4 Model B Rev 1.1', revision))
    const fakeVc = fixture(dir, 'vc', vc('2025/03/10 12:00:00'), true)
    const open = fixture(dir, 'eeprom-current', upstreamStatus('up to date', 0), true)
    const result = run(cpu, fakeVc, open)
    expect(result.stdout.trim()).toBe('CANNOT_DETERMINE')
    expect(result.status).toBe(2)
  })

  it('passes a Pi 5 with a bootloader dated 2025-03-10 or later', () => {
    const dir = directory()
    const cpu = fixture(dir, 'cpu', cpuinfo('Raspberry Pi 5 Model B Rev 1.0', 'c04170'))
    const missing = path.join(dir, 'no-rpi-eeprom')
    for (const date of ['2025/03/10 12:00:00', '2025-03-11 12:00:00', '2026/01/05 00:00:00']) {
      const fakeVc = fixture(dir, `vc-${date.slice(0, 4)}`, vc(date), true)
      const result = run(cpu, fakeVc, missing)
      expect(result.stdout.trim()).toBe('OK')
      expect(result.status).toBe(0)
    }
  })

  it('refuses a Pi 5 with an older bootloader', () => {
    const dir = directory()
    const cpu = fixture(dir, 'cpu', cpuinfo('Raspberry Pi 5 Model B Rev 1.0', 'c04170'))
    const fakeVc = fixture(dir, 'vc', vc('2024/09/23 14:00:00'), true)
    const result = run(cpu, fakeVc, path.join(dir, 'no-rpi-eeprom'))
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
    const result = run(cpu, fakeVc, path.join(dir, 'no-rpi-eeprom'))
    expect(result.stdout.trim()).toBe('CANNOT_DETERMINE')
    expect(result.status).toBe(2)
  })

  it('fails closed on old-style revision codes', () => {
    const dir = directory()
    const cpu = fixture(dir, 'cpu', 'processor\t: 0\nRevision\t: 0002\n')
    const result = run(cpu, path.join(dir, 'no-vcgencmd'), path.join(dir, 'no-rpi-eeprom'))
    expect(result.stdout.trim()).toBe('CANNOT_DETERMINE')
    expect(result.status).toBe(2)
  })

  it('emits a machine-readable code only on stdout', () => {
    const dir = directory()
    const cpu = fixture(dir, 'cpu', cpuinfo('Raspberry Pi 4 Model B Rev 1.1', 'b03111'))
    const fakeVc = fixture(dir, 'vc', vc('2025/03/10 12:00:00'), true)
    const locked = fixture(dir, 'eeprom-stale', upstreamStatus('update available', 1), true)
    const result = run(cpu, fakeVc, locked)
    expect(result.stdout.trim()).toMatch(/^[A-Z0-9_]+$/)
    expect(result.stdout.trim()).not.toContain(' ')
  })
})
