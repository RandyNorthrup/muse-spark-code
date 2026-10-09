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
  const bootDir = path.join(dir, 'controller')
  const dt = path.join(dir, 'proc/device-tree/chosen/bootloader')
  const bin = path.join(dir, 'bin')
  mkdirSync(bootDir, { recursive: true })
  mkdirSync(dt, { recursive: true })
  mkdirSync(bin, { recursive: true })
  writeFileSync(path.join(dt, 'partition'), '1\n')
  const uptime = path.join(dir, 'uptime')
  writeFileSync(uptime, '100.00 200.00\n')
  const raucLog = path.join(dir, 'rauc.log')
  const rebootFlag = path.join(dir, 'rebooted')
  const cURLLog = path.join(dir, 'curl.log')
  const rauc = fakeExecutable(bin, 'rauc', `echo "$@" >> ${posixPath(raucLog)}\nexit 0`)
  const reboot = fakeExecutable(bin, 'reboot', `touch ${posixPath(rebootFlag)}\nexit 0`)
  fakeExecutable(bin, 'curl', `echo "$@" >> ${posixPath(cURLLog)}\nexit 0`)
  const probeOk = fakeExecutable(bin, 'probe-ok', 'exit 0')
  const probeBad = fakeExecutable(bin, 'probe-bad', 'exit 1')
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    MUSE_PI_BOOT_DIR: posixPath(bootDir),
    MUSE_PI_DEVICE_TREE: posixPath(path.join(dir, 'proc/device-tree')),
    MUSE_PI_LOCK_FILE: posixPath(path.join(dir, 'pi-tryboot.lock')),
    MUSE_TRYBOOT_BACKEND: posixPath(backend),
    MUSE_RAUC_CMD: posixPath(rauc),
    MUSE_REBOOT_CMD: posixPath(reboot),
    MUSE_MARK_GOOD_INTERVAL_SEC: '0',
    MUSE_MARK_GOOD_TIMEOUT_SEC: '0',
    MUSE_PROC_UPTIME: posixPath(uptime),
    MUSE_EFI_TRIAL_FILE: posixPath(path.join(dir, 'efi-trial')),
    MUSE_PROC_CMDLINE: posixPath(path.join(dir, 'cmdline')),
  }
  return {
    dir,
    bootDir,
    dt,
    bin,
    uptime,
    raucLog,
    rebootFlag,
    cURLLog,
    rauc,
    reboot,
    probeOk,
    probeBad,
    env,
  }
}

const POS = ['MUSE_READYZ_PROBE', 'MUSE_PI_BOOT_DIR', 'MUSE_NODE_PORT_FILE']

function runMarkGood(h, extraEnv = {}) {
  const env = { ...h.env, ...extraEnv }
  for (const key of [
    ...POS,
    'MUSE_PI_DEVICE_TREE',
    'MUSE_PI_LOCK_FILE',
    'MUSE_PROC_UPTIME',
    'MUSE_EFI_TRIAL_FILE',
    'MUSE_PROC_CMDLINE',
    'MUSE_REBOOT_CMD',
    'MUSE_RAUC_CMD',
  ]) {
    if (env[key] !== undefined) env[key] = posixPath(env[key])
  }
  return spawnSync(shell, [posixPath(markGood)], {
    encoding: 'utf8',
    env,
  })
}

function backendRun(h, args, extraEnv = {}) {
  return spawnSync(shell, [posixPath(backend), ...args], {
    encoding: 'utf8',
    env: {
      ...h.env,
      ...Object.fromEntries(
        Object.entries(extraEnv).map(([key, value]) => [
          key,
          typeof value === 'string' ? posixPath(value) : value,
        ]),
      ),
    },
  })
}

// Arm a trial of B through RAUC's own call and boot into it.
function armTrialB(h) {
  writeFileSync(path.join(h.bootDir, 'autoboot.txt'), OS1_INITIAL)
  expect(backendRun(h, ['set-primary', 'B']).status).toBe(0)
  writeFileSync(path.join(h.dt, 'partition'), '2\n')
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
    armTrialB(h)
    const result = runMarkGood(h, {
      MUSE_READYZ_PROBE: h.probeOk,
    })
    expect(result.status).toBe(0)
    expect(backendRun(h, ['get-primary']).stdout.trim()).toBe('B')
    expect(readFileSync(h.raucLog, 'utf8')).toContain('status mark-good boot.1')
    expect(() => readFileSync(h.rebootFlag)).toThrow()
  })

  it('never marks good on a probe error: marks bad and reboots to stable', () => {
    const h = harness()
    armTrialB(h)
    const result = runMarkGood(h, {
      MUSE_READYZ_PROBE: h.probeBad,
    })
    expect(result.status).not.toBe(0)
    expect(backendRun(h, ['get-primary']).stdout.trim()).toBe('A')
    expect(backendRun(h, ['get-trial']).stdout.trim()).toBe('none')
    expect(backendRun(h, ['get-state', 'B']).stdout.trim()).toBe('bad')
    expect(readFileSync(h.raucLog, 'utf8')).toContain('status mark-bad boot.1')
    expect(readFileSync(h.raucLog, 'utf8')).not.toContain('booted')
    expect(readFileSync(h.rebootFlag, 'utf8')).toBe('')
  })

  it('marks a missing probe as failure, never as good', () => {
    const h = harness()
    armTrialB(h)
    const result = runMarkGood(h, {
      MUSE_READYZ_PROBE: path.join(h.dir, 'bin', 'no-such-probe'),
    })
    expect(result.status).not.toBe(0)
    expect(backendRun(h, ['get-state', 'B']).stdout.trim()).toBe('bad')
    expect(readFileSync(h.rebootFlag, 'utf8')).toBe('')
  })

  it('marks bad without rebooting when the boot already fell back', () => {
    const h = harness()
    writeFileSync(path.join(h.bootDir, 'autoboot.txt'), OS1_INITIAL)
    expect(backendRun(h, ['set-primary', 'B']).status).toBe(0)
    // The crash fell back to A by itself (device tree still says 1); even a
    // passing probe must not mark the untried slot good.
    const result = runMarkGood(h, {
      MUSE_READYZ_PROBE: h.probeOk,
    })
    expect(result.status).not.toBe(0)
    expect(backendRun(h, ['get-trial']).stdout.trim()).toBe('none')
    expect(backendRun(h, ['get-state', 'B']).stdout.trim()).toBe('bad')
    expect(readFileSync(h.raucLog, 'utf8')).toContain('status mark-bad boot.1')
    expect(() => readFileSync(h.rebootFlag)).toThrow()
  })

  it('probes the production port path: numeric ports reach curl', () => {
    for (const port of ['8080', '443']) {
      const h = harness()
      armTrialB(h)
      const portFile = path.join(h.dir, 'port')
      writeFileSync(portFile, `${port}\n`)
      const result = runMarkGood(h, { MUSE_NODE_PORT_FILE: portFile })
      expect(result.status).toBe(0)
      expect(readFileSync(h.cURLLog, 'utf8')).toContain(`http://127.0.0.1:${port}/readyz`)
      expect(backendRun(h, ['get-primary']).stdout.trim()).toBe('B')
    }
  })

  it.each([
    ['alpha', 'invalid'],
    ['empty', ''],
    ['zero', '0'],
    ['too big', '65536'],
    ['huge', '9'.repeat(20)],
    ['negative', '-1'],
  ])('refuses a %s port without calling curl and marks the trial bad', (_label, port) => {
    const h = harness()
    armTrialB(h)
    const portFile = path.join(h.dir, 'port')
    writeFileSync(portFile, `${port}\n`)
    const result = runMarkGood(h, { MUSE_NODE_PORT_FILE: portFile })
    expect(result.status).not.toBe(0)
    expect(() => readFileSync(h.cURLLog, 'utf8')).toThrow()
    expect(backendRun(h, ['get-state', 'B']).stdout.trim()).toBe('bad')
    expect(readFileSync(h.rebootFlag, 'utf8')).toBe('')
  })

  it('quotes probe and reboot paths that contain spaces', () => {
    const h = harness()
    armTrialB(h)
    const spaced = path.join(h.dir, 'with space', 'bin')
    mkdirSync(spaced, { recursive: true })
    const probe = fakeExecutable(spaced, 'probe ok.sh', 'exit 0')
    const reboot = fakeExecutable(
      spaced,
      'reboot me.sh',
      `touch ${posixPath(h.rebootFlag)}\nexit 0`,
    )
    const pass = runMarkGood(h, { MUSE_READYZ_PROBE: probe, MUSE_REBOOT_CMD: reboot })
    expect(pass.status).toBe(0)
    expect(backendRun(h, ['get-primary']).stdout.trim()).toBe('B')
    const probeBad = fakeExecutable(spaced, 'probe bad.sh', 'exit 1')
    const fail = runMarkGood(h, { MUSE_READYZ_PROBE: probeBad, MUSE_REBOOT_CMD: reboot })
    expect(fail.status).not.toBe(0)
    expect(readFileSync(h.rebootFlag, 'utf8')).toBe('')
  })

  it('stops probing after the monotonic deadline', () => {
    const h = harness()
    armTrialB(h)
    const count = path.join(h.dir, 'probes')
    writeFileSync(count, '0')
    // Each failed probe advances the fixture clock by 2 s from a 100 s start
    // with a 5 s deadline: the loop must stop on elapsed time, not attempts.
    fakeExecutable(
      h.bin,
      'count-probe',
      `cur=$(cut -d. -f1 < ${posixPath(h.uptime)})\n` +
        `echo "$((cur + 2)).00 0.00" > ${posixPath(h.uptime)}\n` +
        `n=$(cat ${posixPath(count)})\necho "$((n + 1))" > ${posixPath(count)}\nexit 1`,
    )
    const result = runMarkGood(h, {
      MUSE_READYZ_PROBE: path.join(h.bin, 'count-probe'),
      MUSE_MARK_GOOD_TIMEOUT_SEC: '5',
      MUSE_MARK_GOOD_MAX_ATTEMPTS: '100',
    })
    expect(result.status).not.toBe(0)
    const probes = Number(readFileSync(count, 'utf8').trim())
    expect(probes).toBeGreaterThan(1)
    expect(probes).toBeLessThan(100)
    expect(backendRun(h, ['get-state', 'B']).stdout.trim()).toBe('bad')
  })

  it('stops probing after the attempt cap', () => {
    const h = harness()
    armTrialB(h)
    const count = path.join(h.dir, 'probes')
    writeFileSync(count, '0')
    fakeExecutable(
      h.bin,
      'count-probe',
      `n=$(cat ${posixPath(count)})\necho "$((n + 1))" > ${posixPath(count)}\nexit 1`,
    )
    const result = runMarkGood(h, {
      MUSE_READYZ_PROBE: path.join(h.bin, 'count-probe'),
      MUSE_MARK_GOOD_TIMEOUT_SEC: '300',
      MUSE_MARK_GOOD_MAX_ATTEMPTS: '2',
    })
    expect(result.status).not.toBe(0)
    expect(readFileSync(count, 'utf8').trim()).toBe('2')
  })

  it('kills a hung probe with the per-call timeout', () => {
    const h = harness()
    armTrialB(h)
    fakeExecutable(h.bin, 'hung-probe', 'sleep 30\nexit 0')
    const result = runMarkGood(h, {
      MUSE_READYZ_PROBE: path.join(h.bin, 'hung-probe'),
      MUSE_MARK_GOOD_TIMEOUT_SEC: '300',
      MUSE_MARK_GOOD_MAX_ATTEMPTS: '1',
      MUSE_MARK_GOOD_CALL_TIMEOUT_SEC: '1',
    })
    expect(result.status).not.toBe(0)
    expect(backendRun(h, ['get-state', 'B']).stdout.trim()).toBe('bad')
    expect(readFileSync(h.rebootFlag, 'utf8')).toBe('')
  })

  it('does nothing on EFI without a trial marker, even when the probe fails', () => {
    const h = harness()
    // No autoboot.txt anywhere near and no marker file: ordinary boot.
    h.env.MUSE_PI_BOOT_DIR = path.join(h.dir, 'no-boot-dir')
    const pass = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk })
    expect(pass.status).toBe(0)
    expect(() => readFileSync(h.raucLog, 'utf8')).toThrow()
    const fail = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeBad })
    expect(fail.status).toBe(0)
    expect(() => readFileSync(h.raucLog, 'utf8')).toThrow()
    expect(() => readFileSync(h.rebootFlag)).toThrow()
  })

  it('marks the EFI trial slot good and clears the marker', () => {
    const h = harness()
    h.env.MUSE_PI_BOOT_DIR = path.join(h.dir, 'no-boot-dir')
    writeFileSync(path.join(h.dir, 'efi-trial'), 'B\n')
    writeFileSync(path.join(h.dir, 'cmdline'), 'root=/dev/x muse.slot=B quiet\n')
    const result = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk })
    expect(result.status).toBe(0)
    expect(readFileSync(h.raucLog, 'utf8')).toContain('status mark-good usr.1')
    expect(() => readFileSync(path.join(h.dir, 'efi-trial'))).toThrow()
    expect(() => readFileSync(h.rebootFlag)).toThrow()
  })

  it('marks the EFI trial bad plus reboot on probe failure', () => {
    const h = harness()
    h.env.MUSE_PI_BOOT_DIR = path.join(h.dir, 'no-boot-dir')
    writeFileSync(path.join(h.dir, 'efi-trial'), 'B\n')
    writeFileSync(path.join(h.dir, 'cmdline'), 'root=/dev/x muse.slot=B quiet\n')
    const result = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeBad })
    expect(result.status).not.toBe(0)
    expect(readFileSync(h.raucLog, 'utf8')).toContain('status mark-bad usr.1')
    expect(() => readFileSync(path.join(h.dir, 'efi-trial'))).toThrow()
    expect(readFileSync(h.rebootFlag, 'utf8')).toBe('')
  })

  it('marks bad without rebooting when EFI runs the stable slot', () => {
    const h = harness()
    h.env.MUSE_PI_BOOT_DIR = path.join(h.dir, 'no-boot-dir')
    writeFileSync(path.join(h.dir, 'efi-trial'), 'B\n')
    writeFileSync(path.join(h.dir, 'cmdline'), 'root=/dev/x muse.slot=A quiet\n')
    const result = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk })
    expect(result.status).not.toBe(0)
    expect(readFileSync(h.raucLog, 'utf8')).toContain('status mark-bad usr.1')
    expect(() => readFileSync(path.join(h.dir, 'efi-trial'))).toThrow()
    expect(() => readFileSync(h.rebootFlag)).toThrow()
  })

  it('fails closed on a corrupt EFI marker or a missing slot stamp', () => {
    const h = harness()
    h.env.MUSE_PI_BOOT_DIR = path.join(h.dir, 'no-boot-dir')
    writeFileSync(path.join(h.dir, 'efi-trial'), 'sometimes\n')
    writeFileSync(path.join(h.dir, 'cmdline'), 'root=/dev/x muse.slot=B quiet\n')
    const corrupt = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk })
    expect(corrupt.status).not.toBe(0)
    expect(() => readFileSync(h.raucLog, 'utf8')).toThrow()
    writeFileSync(path.join(h.dir, 'efi-trial'), 'B\n')
    writeFileSync(path.join(h.dir, 'cmdline'), 'root=/dev/x quiet\n')
    const unstamped = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk })
    expect(unstamped.status).not.toBe(0)
    expect(() => readFileSync(h.raucLog, 'utf8')).toThrow()
    expect(() => readFileSync(h.rebootFlag)).toThrow()
  })

  it('ships a unit that bounds the run and reboots on a hang', () => {
    const text = readFileSync(path.join(updateDir, 'muse-mark-good.service'), 'utf8')
    expect(text).toContain('Type=oneshot')
    expect(text).toContain('After=muse-node.service')
    expect(text).toContain('ExecStart=/usr/lib/muse-update/mark-good')
    expect(text).toContain('WantedBy=multi-user.target')
    expect(text).toContain('TimeoutStartSec=360')
    expect(text).toMatch(/^FailureAction=reboot$/m)
  })
})
