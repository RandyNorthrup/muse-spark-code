import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const updateDir = fileURLToPath(new URL('../../os/update/', import.meta.url))
const markGood = path.join(updateDir, 'mark-good')
const backend = path.join(updateDir, 'pi-tryboot-backend')

// The scripts are POSIX sh. CI runs unit tests on Windows with Git Bash, so
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
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'm110-os2-markgood-'))
  temporary.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const OS1_INITIAL = '[all]\ntryboot_a_b=1\nboot_partition=1\n[tryboot]\nboot_partition=2\n'

function fakeExecutable(dir, name, body) {
  const file = path.join(dir, name)
  writeFileSync(file, `#!/bin/sh\n${body}\n`)
  chmodSync(file, 0o755)
  return file
}

function harness() {
  const dir = directory()
  const bootDir = path.join(dir, 'boot')
  const bin = path.join(dir, 'bin')
  mkdirSync(bootDir, { recursive: true })
  mkdirSync(bin, { recursive: true })
  const raucLog = path.join(dir, 'rauc.log')
  const rebootFlag = path.join(dir, 'rebooted')
  const rauc = fakeExecutable(bin, 'rauc', `echo "$@" >> ${posixPath(raucLog)}\nexit 0`)
  const reboot = fakeExecutable(bin, 'reboot', `touch ${posixPath(rebootFlag)}\nexit 0`)
  const probeOk = fakeExecutable(bin, 'probe-ok', 'exit 0')
  const probeBad = fakeExecutable(bin, 'probe-bad', 'exit 1')
  const env = {
    ...process.env,
    MUSE_PI_BOOT_DIR: posixPath(bootDir),
    MUSE_TRYBOOT_BACKEND: posixPath(backend),
    MUSE_RAUC_CMD: posixPath(rauc),
    MUSE_REBOOT_CMD: posixPath(reboot),
    MUSE_MARK_GOOD_INTERVAL_SEC: '0',
    MUSE_MARK_GOOD_TIMEOUT_SEC: '0',
    MUSE_PI_CURRENT_SLOT: 'A',
  }
  return { dir, bootDir, raucLog, rebootFlag, rauc, reboot, probeOk, probeBad, env }
}

function runMarkGood(h, extraEnv = {}) {
  const env = { ...h.env, ...extraEnv }
  if (env.MUSE_READYZ_PROBE !== undefined) env.MUSE_READYZ_PROBE = posixPath(env.MUSE_READYZ_PROBE)
  if (env.MUSE_PI_BOOT_DIR !== undefined) env.MUSE_PI_BOOT_DIR = posixPath(env.MUSE_PI_BOOT_DIR)
  return spawnSync(shell, [posixPath(markGood)], {
    encoding: 'utf8',
    env,
  })
}

function backendRun(h, args, extraEnv = {}) {
  return spawnSync(shell, [posixPath(backend), ...args], {
    encoding: 'utf8',
    env: { ...h.env, ...extraEnv },
  })
}

describe('M110-OS2 trial-boot mark-good', () => {
  it('does nothing when no trial is armed', () => {
    const h = harness()
    writeFileSync(path.join(h.bootDir, 'autoboot.txt'), OS1_INITIAL)
    const result = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk })
    expect(result.status).toBe(0)
    expect(() => readFileSync(h.raucLog, 'utf8')).toThrow()
  })

  it('marks good only after the probe passes on the trial slot', () => {
    const h = harness()
    writeFileSync(path.join(h.bootDir, 'autoboot.txt'), OS1_INITIAL)
    backendRun(h, ['set-state', 'B', 'active'])
    const result = runMarkGood(h, {
      MUSE_READYZ_PROBE: h.probeOk,
      MUSE_PI_CURRENT_SLOT: 'B',
    })
    expect(result.status).toBe(0)
    expect(backendRun(h, ['get-primary']).stdout.trim()).toBe('B')
    expect(readFileSync(h.raucLog, 'utf8')).toContain('status mark-good')
    expect(() => readFileSync(h.rebootFlag)).toThrow()
  })

  it('never marks good on a probe error: marks bad and reboots to stable', () => {
    const h = harness()
    writeFileSync(path.join(h.bootDir, 'autoboot.txt'), OS1_INITIAL)
    backendRun(h, ['set-state', 'B', 'active'])
    const result = runMarkGood(h, {
      MUSE_READYZ_PROBE: h.probeBad,
      MUSE_PI_CURRENT_SLOT: 'B',
    })
    expect(result.status).not.toBe(0)
    expect(backendRun(h, ['get-primary']).stdout.trim()).toBe('A')
    expect(backendRun(h, ['get-trial']).stdout.trim()).toBe('none')
    expect(backendRun(h, ['get-state', 'B']).stdout.trim()).toBe('bad')
    expect(readFileSync(h.raucLog, 'utf8')).toContain('status mark-bad')
    expect(readFileSync(h.rebootFlag, 'utf8')).toBe('')
  })

  it('marks a missing probe as failure, never as good', () => {
    const h = harness()
    writeFileSync(path.join(h.bootDir, 'autoboot.txt'), OS1_INITIAL)
    backendRun(h, ['set-state', 'B', 'active'])
    const result = runMarkGood(h, {
      MUSE_READYZ_PROBE: path.join(h.dir, 'bin', 'no-such-probe'),
      MUSE_PI_CURRENT_SLOT: 'B',
    })
    expect(result.status).not.toBe(0)
    expect(backendRun(h, ['get-state', 'B']).stdout.trim()).toBe('bad')
    expect(readFileSync(h.rebootFlag, 'utf8')).toBe('')
  })

  it('marks bad without rebooting when the boot already fell back', () => {
    const h = harness()
    writeFileSync(path.join(h.bootDir, 'autoboot.txt'), OS1_INITIAL)
    backendRun(h, ['set-state', 'B', 'active'])
    // The crash fell back to A by itself; even a passing probe must not
    // mark the untried slot good.
    const result = runMarkGood(h, {
      MUSE_READYZ_PROBE: h.probeOk,
      MUSE_PI_CURRENT_SLOT: 'A',
    })
    expect(result.status).not.toBe(0)
    expect(backendRun(h, ['get-trial']).stdout.trim()).toBe('none')
    expect(backendRun(h, ['get-state', 'B']).stdout.trim()).toBe('bad')
    expect(() => readFileSync(h.rebootFlag)).toThrow()
  })

  it('marks the EFI slot good on a passing probe and bad plus reboot on failure', () => {
    const h = harness()
    // No autoboot.txt anywhere near: EFI target.
    h.env.MUSE_PI_BOOT_DIR = path.join(h.dir, 'no-boot-dir')
    const pass = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk })
    expect(pass.status).toBe(0)
    expect(readFileSync(h.raucLog, 'utf8')).toContain('status mark-good')
    const fail = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeBad })
    expect(fail.status).not.toBe(0)
    expect(readFileSync(h.raucLog, 'utf8')).toContain('status mark-bad')
    expect(readFileSync(h.rebootFlag, 'utf8')).toBe('')
  })

  it('ships a unit that runs once per boot after the node service', () => {
    const text = readFileSync(path.join(updateDir, 'muse-mark-good.service'), 'utf8')
    expect(text).toContain('Type=oneshot')
    expect(text).toContain('After=muse-node.service')
    expect(text).toContain('ExecStart=/usr/lib/muse-update/mark-good')
    expect(text).toContain('WantedBy=multi-user.target')
  })
})
