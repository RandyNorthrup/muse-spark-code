// Shared M110-OS2 Pi tryboot fixtures: the post-handoff controller-first
// geometry, read from the backend's own partition map (the one source of
// truth), device-tree integers as four big-endian bytes, and a controller
// mount the backend's label check accepts.
import { Buffer } from 'node:buffer'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const piBackend = fileURLToPath(
  new URL('../../../os/update/pi-tryboot-backend', import.meta.url),
)

// The scripts are POSIX sh and must stay dash-clean: they run under dash
// wherever it exists (Debian/Ubuntu, the image's /bin/sh), else under the
// host sh. CI runs unit tests on Windows with Git Bash, so resolve a shell
// the way the runner does and hand it forward-slash paths; a missing shell
// fails loudly, never skips.
export function posixPath(p) {
  return process.platform === 'win32' ? p.split(path.sep).join(path.posix.sep) : p
}
function resolveShell() {
  if (process.platform !== 'win32') {
    const dash = spawnSync('dash', ['-c', 'true'])
    return dash.status === 0 ? 'dash' : 'sh'
  }
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
  return found
}
export const shell = resolveShell()

// Host tools the production image always ships (util-linux flock, coreutils
// timeout). A host without one (stock macOS has neither) skips the tests
// that need it under this named reason instead of failing on a missing
// host utility; the production scripts still refuse without them.
export function hostLacks(tool) {
  const probe = spawnSync(shell, ['-c', `command -v ${tool}`], { encoding: 'utf8' })
  return probe.status !== 0
}
export const noFlockReason =
  'skipped: host has no flock(1) (util-linux); the backend refuses writes without it'
export const noTimeoutReason =
  'skipped: host has no timeout(1) (coreutils); mark-good refuses without it'

function mapValue(name) {
  const match = new RegExp(String.raw`^${name}=(\d+)$`, 'm').exec(readFileSync(piBackend, 'utf8'))
  if (match === null) throw new Error(`pi-tryboot-backend has no ${name}`)
  return Number(match[1])
}
export const PI_PARTITION = {
  controller: mapValue('PART_CONTROLLER'),
  A: mapValue('PART_A'),
  B: mapValue('PART_B'),
}

// OS1's initial controller autoboot.txt after the OS2-OS1-CONTROLLER handoff:
// A stable, B standby, no trial.
export const OS1_INITIAL =
  `[all]\ntryboot_a_b=1\nboot_partition=${PI_PARTITION.A}\n` +
  `[tryboot]\nboot_partition=${PI_PARTITION.B}\n`

// A device-tree integer: four bytes, big-endian.
export function dtInt(value) {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32BE(value)
  return bytes
}

// piLayout creates the controller mount, its label device, mountinfo and a
// device tree that reports `booted` (A or B) under dir.
export function piLayout(dir, booted = 'A') {
  const bootDir = path.join(dir, 'controller')
  const dt = path.join(dir, 'proc/device-tree/chosen/bootloader')
  const device = path.join(dir, 'dev-muse-pi-ctl')
  const mountinfo = path.join(dir, 'mountinfo')
  mkdirSync(bootDir, { recursive: true })
  mkdirSync(dt, { recursive: true })
  writeFileSync(device, '')
  writeFileSync(
    mountinfo,
    `36 25 179:1 / ${posixPath(bootDir)} rw,relatime shared:1 - vfat ${posixPath(device)} rw\n`,
  )
  writeFileSync(path.join(dt, 'partition'), dtInt(PI_PARTITION[booted]))
  return {
    bootDir,
    dt,
    device,
    mountinfo,
    env: {
      MUSE_PI_BOOT_DIR: posixPath(bootDir),
      MUSE_PI_DEVICE_TREE: posixPath(path.join(dir, 'proc/device-tree')),
      MUSE_PI_LOCK_FILE: posixPath(path.join(dir, 'pi-tryboot.lock')),
      MUSE_PI_CTL_DEVICE: posixPath(device),
      MUSE_PROC_MOUNTINFO: posixPath(mountinfo),
    },
  }
}

// boot points the fixture device tree at slot A or B.
export function bootInto(layout, slot) {
  writeFileSync(path.join(layout.dt, 'partition'), dtInt(PI_PARTITION[slot]))
}
