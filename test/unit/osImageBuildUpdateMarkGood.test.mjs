import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  OS1_INITIAL,
  bootInto,
  hostLacks,
  noFlockReason,
  noTimeoutReason,
  piBackend as backend,
  piLayout,
  posixPath,
  shell,
} from './helpers/osPiTryboot.mjs'

const updateDir = fileURLToPath(new URL('../../os/update/', import.meta.url))
const markGood = path.join(updateDir, 'mark-good')

const noFlock = hostLacks('flock')
const noTimeout = hostLacks('timeout')
const piReason = [noFlock && noFlockReason, noTimeout && noTimeoutReason].filter(Boolean)
const efiReason = noTimeout ? ` (${noTimeoutReason})` : ''

const temporary = []
function directory() {
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'm110-os2-markgood-'))
  temporary.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fakeExecutable(dir, name, body) {
  const file = path.join(dir, name)
  writeFileSync(file, `#!/bin/sh\n${body}\n`)
  chmodSync(file, 0o755)
  return file
}

// The fake rauc logs its arguments and, like RAUC 1.13's custom bootloader
// dispatch (mark.c -> bootchooser.c), forwards a Pi mark-good/mark-bad of
// boot.0/boot.1 to the backend as `set-state <A|B> <good|bad>`.
const FAKE_RAUC = (log) =>
  `echo "$@" >> ${posixPath(log)}\n` +
  'case "$3" in boot.0) s=A ;; boot.1) s=B ;; *) exit 0 ;; esac\n' +
  'case "$2" in mark-good) st=good ;; mark-bad) st=bad ;; *) exit 0 ;; esac\n' +
  'exec "$MUSE_TRYBOOT_BACKEND" set-state "$s" "$st"'

function harness() {
  const dir = directory()
  const layout = piLayout(dir)
  const bin = path.join(dir, 'bin')
  mkdirSync(bin, { recursive: true })
  const uptime = path.join(dir, 'uptime')
  writeFileSync(uptime, '100.00 200.00\n')
  const raucLog = path.join(dir, 'rauc.log')
  const rebootFlag = path.join(dir, 'rebooted')
  const cURLLog = path.join(dir, 'curl.log')
  const rauc = fakeExecutable(bin, 'rauc', FAKE_RAUC(raucLog))
  const reboot = fakeExecutable(bin, 'reboot', `touch ${posixPath(rebootFlag)}\nexit 0`)
  fakeExecutable(bin, 'curl', `echo "$@" >> ${posixPath(cURLLog)}\nexit 0`)
  const probeOk = fakeExecutable(bin, 'probe-ok', 'exit 0')
  const probeBad = fakeExecutable(bin, 'probe-bad', 'exit 1')
  const env = {
    ...process.env,
    ...layout.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    MUSE_TRYBOOT_BACKEND: posixPath(backend),
    MUSE_RAUC_CMD: posixPath(rauc),
    MUSE_REBOOT_CMD: posixPath(reboot),
    MUSE_MARK_GOOD_INTERVAL_SEC: '0',
    MUSE_MARK_GOOD_TIMEOUT_SEC: '300',
    MUSE_MARK_GOOD_MAX_ATTEMPTS: '2',
    MUSE_PROC_UPTIME: posixPath(uptime),
    MUSE_EFI_TRIAL_FILE: posixPath(path.join(dir, 'efi-trial')),
    MUSE_PROC_CMDLINE: posixPath(path.join(dir, 'cmdline')),
  }
  return { dir, ...layout, bin, uptime, raucLog, rebootFlag, cURLLog, probeOk, probeBad, env }
}

function runMarkGood(h, extraEnv = {}) {
  const env = { ...h.env }
  for (const [key, value] of Object.entries(extraEnv)) env[key] = posixPath(value)
  return spawnSync(shell, [posixPath(markGood)], { encoding: 'utf8', env })
}

function backendRun(h, args) {
  return spawnSync(shell, [posixPath(backend), ...args], { encoding: 'utf8', env: h.env })
}

// Arm a trial of B through RAUC's own call and boot into it (partition 3).
function armTrialB(h) {
  writeFileSync(path.join(h.bootDir, 'autoboot.txt'), OS1_INITIAL)
  expect(backendRun(h, ['set-primary', 'B']).status).toBe(0)
  bootInto(h, 'B')
}

const rebooted = (h) => {
  try {
    return readFileSync(h.rebootFlag, 'utf8') === ''
  } catch {
    return false
  }
}

const piTitle = piReason.length > 0 ? ` (${piReason.join('; ')})` : ''

describe.skipIf(noFlock || noTimeout)(`M110-OS2 trial-boot mark-good: Pi${piTitle}`, () => {
  it('does nothing when no trial is armed, at the default per-call limit', () => {
    const h = harness()
    writeFileSync(path.join(h.bootDir, 'autoboot.txt'), OS1_INITIAL)
    // Default MUSE_MARK_GOOD_CALL_TIMEOUT_SEC (30): a guard that outlives a
    // finished call would hold the get-trial pipe for 30 s here.
    const result = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk })
    expect(result.status).toBe(0)
    expect(() => readFileSync(h.raucLog, 'utf8')).toThrow()
  })

  it('marks good only through RAUC after the probe passes on the trial slot', () => {
    const h = harness()
    armTrialB(h)
    const result = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk })
    expect(result.status).toBe(0)
    expect(backendRun(h, ['get-primary']).stdout.trim()).toBe('B')
    expect(backendRun(h, ['get-trial']).stdout.trim()).toBe('none')
    expect(readFileSync(h.raucLog, 'utf8')).toBe('status mark-good boot.1\n')
    expect(rebooted(h)).toBe(false)
  })

  it('promotes nothing when RAUC refuses mark-good', () => {
    const h = harness()
    armTrialB(h)
    const refusing = fakeExecutable(
      h.bin,
      'rauc-refuses',
      `echo "$@" >> ${posixPath(h.raucLog)}\nexit 1`,
    )
    const result = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk, MUSE_RAUC_CMD: refusing })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('FAIL rauc-good')
    expect(backendRun(h, ['get-primary']).stdout.trim()).toBe('A')
    expect(backendRun(h, ['get-trial']).stdout.trim()).toBe('B')
  })

  it('fails closed when RAUC accepts but the backend did not promote', () => {
    const h = harness()
    armTrialB(h)
    // RAUC that exits 0 without dispatching to the backend.
    const silent = fakeExecutable(h.bin, 'rauc-silent', 'exit 0')
    const result = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk, MUSE_RAUC_CMD: silent })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('FAIL promotion-unconfirmed primary=A trial=B')
  })

  it('never marks good on a probe error: marks bad, reboots to stable, exits handled', () => {
    const h = harness()
    armTrialB(h)
    const result = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeBad })
    expect(result.status).toBe(3)
    expect(result.stderr).toContain('TRIAL-FAILED-HANDLED probe-failed reboot-requested')
    expect(backendRun(h, ['get-primary']).stdout.trim()).toBe('A')
    expect(backendRun(h, ['get-trial']).stdout.trim()).toBe('none')
    expect(backendRun(h, ['get-state', 'B']).stdout.trim()).toBe('bad')
    expect(readFileSync(h.raucLog, 'utf8')).toContain('status mark-bad boot.1')
    expect(readFileSync(h.raucLog, 'utf8')).not.toContain('booted')
    expect(rebooted(h)).toBe(true)
  })

  it('treats a failed reboot request as unhandled (exit 1)', () => {
    const h = harness()
    armTrialB(h)
    const noReboot = fakeExecutable(h.bin, 'reboot-fails', 'exit 1')
    const result = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeBad, MUSE_REBOOT_CMD: noReboot })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('FAIL no-reboot')
  })

  it('marks a missing probe as failure, never as good', () => {
    const h = harness()
    armTrialB(h)
    const result = runMarkGood(h, { MUSE_READYZ_PROBE: path.join(h.bin, 'no-such-probe') })
    expect(result.status).toBe(3)
    expect(backendRun(h, ['get-state', 'B']).stdout.trim()).toBe('bad')
    expect(rebooted(h)).toBe(true)
  })

  it('marks bad without rebooting when the boot already fell back, exit handled', () => {
    const h = harness()
    writeFileSync(path.join(h.bootDir, 'autoboot.txt'), OS1_INITIAL)
    expect(backendRun(h, ['set-primary', 'B']).status).toBe(0)
    // The crash fell back to A by itself (device tree still says partition
    // 2); even a passing probe must not mark the untried slot good.
    const result = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk })
    expect(result.status).toBe(3)
    expect(result.stderr).toContain('TRIAL-FAILED-HANDLED fell-back')
    expect(backendRun(h, ['get-trial']).stdout.trim()).toBe('none')
    expect(backendRun(h, ['get-state', 'B']).stdout.trim()).toBe('bad')
    expect(readFileSync(h.raucLog, 'utf8')).toContain('status mark-bad boot.1')
    expect(rebooted(h)).toBe(false)
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
    expect(result.status).toBe(3)
    expect(() => readFileSync(h.cURLLog, 'utf8')).toThrow()
    expect(backendRun(h, ['get-state', 'B']).stdout.trim()).toBe('bad')
    expect(rebooted(h)).toBe(true)
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
    // The passing run consumed the trial (promoted B, now on partition 3):
    // arm a fresh trial of A and boot into it for the failing run.
    expect(backendRun(h, ['set-primary', 'A']).status).toBe(0)
    bootInto(h, 'A')
    const probeBad = fakeExecutable(spaced, 'probe bad.sh', 'exit 1')
    const fail = runMarkGood(h, { MUSE_READYZ_PROBE: probeBad, MUSE_REBOOT_CMD: reboot })
    expect(fail.status).toBe(3)
    expect(rebooted(h)).toBe(true)
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
    expect(result.status).toBe(3)
    expect(readFileSync(count, 'utf8').trim()).toBe('3')
    expect(backendRun(h, ['get-state', 'B']).stdout.trim()).toBe('bad')
  })

  it('never marks good when the passing probe returns after the deadline', () => {
    const h = harness()
    armTrialB(h)
    // Start at uptime 100; the probe passes but returns at 450, past the
    // 300 s trial window.
    fakeExecutable(h.bin, 'late-probe', `echo "450.00 0.00" > ${posixPath(h.uptime)}\nexit 0`)
    const result = runMarkGood(h, { MUSE_READYZ_PROBE: path.join(h.bin, 'late-probe') })
    expect(result.status).toBe(3)
    expect(result.stderr).toContain('deadline after-probe attempts=1')
    expect(backendRun(h, ['get-primary']).stdout.trim()).toBe('A')
    expect(backendRun(h, ['get-state', 'B']).stdout.trim()).toBe('bad')
    expect(readFileSync(h.raucLog, 'utf8')).not.toContain('mark-good')
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
    const result = runMarkGood(h, { MUSE_READYZ_PROBE: path.join(h.bin, 'count-probe') })
    expect(result.status).toBe(3)
    expect(readFileSync(count, 'utf8').trim()).toBe('2')
  })

  it('kills a hung probe that ignores TERM within the limit plus the kill grace', () => {
    const h = harness()
    armTrialB(h)
    fakeExecutable(h.bin, 'hung-probe', "trap '' TERM\nsleep 30\nexit 0")
    const started = Date.now()
    const result = runMarkGood(h, {
      MUSE_READYZ_PROBE: path.join(h.bin, 'hung-probe'),
      MUSE_MARK_GOOD_MAX_ATTEMPTS: '1',
      MUSE_MARK_GOOD_CALL_TIMEOUT_SEC: '1',
      MUSE_MARK_GOOD_KILL_GRACE_SEC: '1',
    })
    expect(Date.now() - started).toBeLessThan(4000)
    expect(result.status).toBe(3)
    expect(backendRun(h, ['get-state', 'B']).stdout.trim()).toBe('bad')
  })

  it('kills a finished call’s leftover descendants instead of waiting on them', () => {
    const h = harness()
    writeFileSync(path.join(h.bootDir, 'autoboot.txt'), OS1_INITIAL)
    // A backend that answers at once but leaves a child holding stdout: the
    // command substitution must not wait the child's 30 s.
    const leaky = fakeExecutable(h.bin, 'leaky-backend', 'sleep 30 &\necho none')
    const started = Date.now()
    const result = runMarkGood(h, { MUSE_TRYBOOT_BACKEND: leaky, MUSE_READYZ_PROBE: h.probeOk })
    expect(Date.now() - started).toBeLessThan(3000)
    expect(result.status).toBe(0)
  })
})

function efi() {
  const h = harness()
  h.env.MUSE_PI_BOOT_DIR = posixPath(path.join(h.dir, 'no-boot-dir'))
  return h
}

describe.skipIf(noTimeout)(`M110-OS2 trial-boot mark-good: EFI${efiReason}`, () => {
  it('does nothing on EFI without a trial marker, even when the probe fails', () => {
    const h = efi()
    const pass = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk })
    expect(pass.status).toBe(0)
    expect(() => readFileSync(h.raucLog, 'utf8')).toThrow()
    const fail = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeBad })
    expect(fail.status).toBe(0)
    expect(() => readFileSync(h.raucLog, 'utf8')).toThrow()
    expect(rebooted(h)).toBe(false)
  })

  it('marks the EFI trial slot good and clears the marker', () => {
    const h = efi()
    writeFileSync(path.join(h.dir, 'efi-trial'), 'B\n')
    writeFileSync(path.join(h.dir, 'cmdline'), 'root=/dev/x muse.slot=B quiet\n')
    const result = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk })
    expect(result.status).toBe(0)
    expect(readFileSync(h.raucLog, 'utf8')).toContain('status mark-good usr.1')
    expect(() => readFileSync(path.join(h.dir, 'efi-trial'))).toThrow()
    expect(rebooted(h)).toBe(false)
  })

  it('marks the EFI trial bad plus reboot on probe failure, exit handled', () => {
    const h = efi()
    writeFileSync(path.join(h.dir, 'efi-trial'), 'B\n')
    writeFileSync(path.join(h.dir, 'cmdline'), 'root=/dev/x muse.slot=B quiet\n')
    const result = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeBad })
    expect(result.status).toBe(3)
    expect(readFileSync(h.raucLog, 'utf8')).toContain('status mark-bad usr.1')
    expect(() => readFileSync(path.join(h.dir, 'efi-trial'))).toThrow()
    expect(rebooted(h)).toBe(true)
  })

  it('marks bad without rebooting when EFI runs the stable slot, exit handled', () => {
    const h = efi()
    writeFileSync(path.join(h.dir, 'efi-trial'), 'B\n')
    writeFileSync(path.join(h.dir, 'cmdline'), 'root=/dev/x muse.slot=A quiet\n')
    const result = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk })
    expect(result.status).toBe(3)
    expect(result.stderr).toContain('TRIAL-FAILED-HANDLED fell-back')
    expect(readFileSync(h.raucLog, 'utf8')).toContain('status mark-bad usr.1')
    expect(() => readFileSync(path.join(h.dir, 'efi-trial'))).toThrow()
    expect(rebooted(h)).toBe(false)
  })

  it('keeps the EFI marker and exits unhandled when RAUC refuses mark-bad after fallback', () => {
    const h = efi()
    writeFileSync(path.join(h.dir, 'efi-trial'), 'B\n')
    writeFileSync(path.join(h.dir, 'cmdline'), 'root=/dev/x muse.slot=A quiet\n')
    const refusing = fakeExecutable(
      h.bin,
      'rauc-refuses',
      `echo "$@" >> ${posixPath(h.raucLog)}\nexit 1`,
    )
    const result = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk, MUSE_RAUC_CMD: refusing })
    // The refusal is not a handled fallback: the marker stays (counting
    // the first refused attempt) so the next run retries the mark, and the
    // exit is a failure (never 3).
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('rauc-refused mark=bad slot=usr.1')
    expect(readFileSync(path.join(h.dir, 'efi-trial'), 'utf8').trim()).toBe('B 1')
    expect(rebooted(h)).toBe(false)
  })

  it('keeps the EFI marker and exits unhandled when RAUC refuses mark-bad on probe failure', () => {
    const h = efi()
    writeFileSync(path.join(h.dir, 'efi-trial'), 'B\n')
    writeFileSync(path.join(h.dir, 'cmdline'), 'root=/dev/x muse.slot=B quiet\n')
    const refusing = fakeExecutable(
      h.bin,
      'rauc-refuses',
      `echo "$@" >> ${posixPath(h.raucLog)}\nexit 1`,
    )
    const refused = runMarkGood(h, {
      MUSE_READYZ_PROBE: h.probeBad,
      MUSE_RAUC_CMD: refusing,
    })
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('rauc-refused mark=bad slot=usr.1')
    expect(readFileSync(path.join(h.dir, 'efi-trial'), 'utf8').trim()).toBe('B 1')
    // The next run retries the refused mark: with a working RAUC the same
    // failing trial is recorded bad, the marker is cleared, exit is handled.
    const retry = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeBad })
    expect(retry.status).toBe(3)
    expect(readFileSync(h.raucLog, 'utf8').match(/status mark-bad usr\.1/g)).toHaveLength(2)
    expect(() => readFileSync(path.join(h.dir, 'efi-trial'))).toThrow()
    expect(rebooted(h)).toBe(true)
  })

  it('bounds a persistently refused EFI mark-bad: N failures, then give up handled with the record', () => {
    const h = efi()
    writeFileSync(path.join(h.dir, 'efi-trial'), 'B\n')
    writeFileSync(path.join(h.dir, 'cmdline'), 'root=/dev/x muse.slot=A quiet\n')
    const refusing = fakeExecutable(
      h.bin,
      'rauc-refuses',
      `echo "$@" >> ${posixPath(h.raucLog)}\nexit 1`,
    )
    const refusedEnv = { MUSE_READYZ_PROBE: h.probeOk, MUSE_RAUC_CMD: refusing }
    // Default MUSE_RAUC_BAD_MAX_RETRIES is 3: attempts 1..3 fail, keep the
    // marker with its count, and never request a reboot from the stable
    // slot (the unit's FailureAction owns the reboot).
    for (const marker of ['B 1', 'B 2', 'B 3']) {
      const result = runMarkGood(h, refusedEnv)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('rauc-refused mark=bad slot=usr.1')
      expect(readFileSync(path.join(h.dir, 'efi-trial'), 'utf8').trim()).toBe(marker)
      expect(() => readFileSync(path.join(h.dir, 'efi-trial.unreconciled'))).toThrow()
      expect(rebooted(h)).toBe(false)
    }
    // Attempt 4 gives up: handled (never 1, so FailureAction stops
    // rebooting), marker gone, durable record filed, distinct journal line.
    const gaveUp = runMarkGood(h, refusedEnv)
    expect(gaveUp.status).toBe(3)
    expect(gaveUp.stderr).toContain('rauc-bad-gave-up slot=usr.1')
    expect(gaveUp.stderr).toContain('TRIAL-FAILED-HANDLED rauc-bad-gave-up slot=usr.1')
    expect(() => readFileSync(path.join(h.dir, 'efi-trial'))).toThrow()
    expect(readFileSync(path.join(h.dir, 'efi-trial.unreconciled'), 'utf8').trim()).toBe(
      'trial=B slot=usr.1 refused-mark-bad-attempts=4',
    )
    expect(rebooted(h)).toBe(false)
    // A later ordinary boot leaves the record for the operator ...
    const idle = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk })
    expect(idle.status).toBe(0)
    expect(readFileSync(path.join(h.dir, 'efi-trial.unreconciled'), 'utf8').trim()).toBe(
      'trial=B slot=usr.1 refused-mark-bad-attempts=4',
    )
    // ... while a later successful mark clears it.
    writeFileSync(path.join(h.dir, 'efi-trial'), 'B\n')
    writeFileSync(path.join(h.dir, 'cmdline'), 'root=/dev/x muse.slot=B quiet\n')
    const cleared = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk })
    expect(cleared.status).toBe(0)
    expect(() => readFileSync(path.join(h.dir, 'efi-trial.unreconciled'))).toThrow()
    expect(() => readFileSync(path.join(h.dir, 'efi-trial'))).toThrow()
    expect(rebooted(h)).toBe(false)
  })

  it('counts a probe-failed refusal toward the same bound and gives up from the stable slot', () => {
    const h = efi()
    writeFileSync(path.join(h.dir, 'efi-trial'), 'B\n')
    writeFileSync(path.join(h.dir, 'cmdline'), 'root=/dev/x muse.slot=B quiet\n')
    const refusing = fakeExecutable(
      h.bin,
      'rauc-refuses',
      `echo "$@" >> ${posixPath(h.raucLog)}\nexit 1`,
    )
    const refusedEnv = { MUSE_RAUC_CMD: refusing }
    // Running the failed trial: the refusal keeps the marker (count 1) and
    // fails so FailureAction reboots off the trial.
    const first = runMarkGood(h, { ...refusedEnv, MUSE_READYZ_PROBE: h.probeBad })
    expect(first.status).toBe(1)
    expect(readFileSync(path.join(h.dir, 'efi-trial'), 'utf8').trim()).toBe('B 1')
    // After the reboot the machine runs the stable slot: two more refusals
    // fail, the fourth attempt gives up handled with the record.
    writeFileSync(path.join(h.dir, 'cmdline'), 'root=/dev/x muse.slot=A quiet\n')
    for (const marker of ['B 2', 'B 3']) {
      const result = runMarkGood(h, { ...refusedEnv, MUSE_READYZ_PROBE: h.probeOk })
      expect(result.status).toBe(1)
      expect(readFileSync(path.join(h.dir, 'efi-trial'), 'utf8').trim()).toBe(marker)
      expect(rebooted(h)).toBe(false)
    }
    const gaveUp = runMarkGood(h, { ...refusedEnv, MUSE_READYZ_PROBE: h.probeOk })
    expect(gaveUp.status).toBe(3)
    expect(gaveUp.stderr).toContain('rauc-bad-gave-up slot=usr.1')
    expect(() => readFileSync(path.join(h.dir, 'efi-trial'))).toThrow()
    expect(readFileSync(path.join(h.dir, 'efi-trial.unreconciled'), 'utf8').trim()).toBe(
      'trial=B slot=usr.1 refused-mark-bad-attempts=4',
    )
    expect(rebooted(h)).toBe(false)
  })

  it('drops the retry count when a transient EFI refusal is followed by success', () => {
    const h = efi()
    writeFileSync(path.join(h.dir, 'efi-trial'), 'B\n')
    writeFileSync(path.join(h.dir, 'cmdline'), 'root=/dev/x muse.slot=A quiet\n')
    const refusing = fakeExecutable(
      h.bin,
      'rauc-refuses',
      `echo "$@" >> ${posixPath(h.raucLog)}\nexit 1`,
    )
    const refused = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk, MUSE_RAUC_CMD: refusing })
    expect(refused.status).toBe(1)
    expect(readFileSync(path.join(h.dir, 'efi-trial'), 'utf8').trim()).toBe('B 1')
    // With a working RAUC the retried mark succeeds: handled, marker gone,
    // no unreconciled record, no reboot.
    const retry = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk })
    expect(retry.status).toBe(3)
    expect(retry.stderr).toContain('TRIAL-FAILED-HANDLED fell-back')
    expect(() => readFileSync(path.join(h.dir, 'efi-trial'))).toThrow()
    expect(() => readFileSync(path.join(h.dir, 'efi-trial.unreconciled'))).toThrow()
    expect(rebooted(h)).toBe(false)
  })

  it('fails closed on a corrupt EFI marker or a missing slot stamp', () => {
    const h = efi()
    writeFileSync(path.join(h.dir, 'efi-trial'), 'sometimes\n')
    writeFileSync(path.join(h.dir, 'cmdline'), 'root=/dev/x muse.slot=B quiet\n')
    const corrupt = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk })
    expect(corrupt.status).toBe(1)
    expect(() => readFileSync(h.raucLog, 'utf8')).toThrow()
    writeFileSync(path.join(h.dir, 'efi-trial'), 'B\n')
    writeFileSync(path.join(h.dir, 'cmdline'), 'root=/dev/x quiet\n')
    const unstamped = runMarkGood(h, { MUSE_READYZ_PROBE: h.probeOk })
    expect(unstamped.status).toBe(1)
    expect(() => readFileSync(h.raucLog, 'utf8')).toThrow()
    expect(rebooted(h)).toBe(false)
  })
})

describe('M110-OS2 trial-boot mark-good: unit', () => {
  it('ships a unit that bounds the run, reboots on a hang, and not on a handled fallback', () => {
    const text = readFileSync(path.join(updateDir, 'muse-mark-good.service'), 'utf8')
    expect(text).toContain('Type=oneshot')
    expect(text).toContain('After=muse-node.service')
    expect(text).toContain('ExecStart=/usr/lib/muse-update/mark-good')
    expect(text).toContain('WantedBy=multi-user.target')
    expect(text).toContain('TimeoutStartSec=360')
    expect(text).toMatch(/^FailureAction=reboot$/m)
    // mark-good exits 3 for a handled trial failure (see its header).
    expect(text).toMatch(/^SuccessExitStatus=3$/m)
    expect(readFileSync(markGood, 'utf8')).toContain('    exit 3\n')
  })
})
