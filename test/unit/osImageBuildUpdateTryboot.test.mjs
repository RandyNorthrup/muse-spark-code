import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const backend = fileURLToPath(new URL('../../os/update/pi-tryboot-backend', import.meta.url))

// The backend is POSIX sh. CI runs unit tests on Windows with Git Bash, so
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
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'm110-os2-tryboot-'))
  temporary.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// Post-handoff layout fixture: the controller FAT holds only autoboot.txt
// (label muse-pi-ctl, never a RAUC slot); boot-a/boot-b are separate FATs.
const OS1_INITIAL = '[all]\ntryboot_a_b=1\nboot_partition=1\n[tryboot]\nboot_partition=2\n'

function setup(booted = '1') {
  const dir = directory()
  const bootDir = path.join(dir, 'controller')
  const dt = path.join(dir, 'proc/device-tree/chosen/bootloader')
  mkdirSync(bootDir, { recursive: true })
  mkdirSync(dt, { recursive: true })
  writeFileSync(path.join(bootDir, 'autoboot.txt'), OS1_INITIAL)
  writeFileSync(path.join(dt, 'partition'), `${booted}\n`)
  return { dir, bootDir, dt, lock: path.join(dir, 'pi-tryboot.lock') }
}

function run(h, args, extraEnv = {}) {
  return spawnSync(shell, [posixPath(backend), ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MUSE_PI_BOOT_DIR: posixPath(h.bootDir),
      MUSE_PI_DEVICE_TREE: posixPath(path.join(h.dir, 'proc/device-tree')),
      MUSE_PI_LOCK_FILE: posixPath(h.lock),
      ...extraEnv,
    },
  })
}

describe('M110-OS2 Pi tryboot backend', () => {
  it('accepts the OS1 initial file: primary A, no trial, A good', () => {
    const h = setup()
    expect(run(h, ['get-primary']).stdout.trim()).toBe('A')
    expect(run(h, ['get-trial']).stdout.trim()).toBe('none')
    expect(run(h, ['get-state', 'A']).stdout.trim()).toBe('good')
    expect(run(h, ['get-state', 'B']).stdout.trim()).toBe('bad')
    expect(run(h, ['get-current']).stdout.trim()).toBe('A')
  })

  it('set-primary arms a one-shot trial and never changes the stable slot', () => {
    const h = setup()
    // RAUC install.c calls set-primary B after writing B: B must become the
    // trial while A stays the stable fallback.
    expect(run(h, ['set-primary', 'B']).status).toBe(0)
    expect(run(h, ['get-primary']).stdout.trim()).toBe('A')
    expect(run(h, ['get-trial']).stdout.trim()).toBe('B')
    expect(run(h, ['get-state', 'A']).stdout.trim()).toBe('good')
  })

  it('set-primary on the stable slot clears any trial instead', () => {
    const h = setup()
    run(h, ['set-primary', 'B'])
    expect(run(h, ['set-primary', 'A']).status).toBe(0)
    expect(run(h, ['get-primary']).stdout.trim()).toBe('A')
    expect(run(h, ['get-trial']).stdout.trim()).toBe('none')
  })

  it('runs a one-shot trial: arm B, keep A stable, promote on good', () => {
    const h = setup()
    run(h, ['set-primary', 'B'])
    expect(run(h, ['get-primary']).stdout.trim()).toBe('A')
    expect(run(h, ['get-trial']).stdout.trim()).toBe('B')
    // A crash or reset falls back to A by itself: the stable selection is kept.
    writeFileSync(path.join(h.dt, 'partition'), '2\n')
    expect(run(h, ['set-state', 'B', 'good']).status).toBe(0)
    expect(run(h, ['get-primary']).stdout.trim()).toBe('B')
    expect(run(h, ['get-trial']).stdout.trim()).toBe('none')
  })

  it('never promotes a good marking made outside the trial slot', () => {
    const h = setup()
    run(h, ['set-primary', 'B'])
    // Install-time marking while still running A: records only.
    expect(run(h, ['set-state', 'B', 'good']).status).toBe(0)
    expect(run(h, ['get-primary']).stdout.trim()).toBe('A')
    expect(run(h, ['get-trial']).stdout.trim()).toBe('B')
  })

  it('disarms a bad trial and keeps the stable selection', () => {
    const h = setup()
    run(h, ['set-primary', 'B'])
    expect(run(h, ['set-state', 'B', 'bad']).status).toBe(0)
    expect(run(h, ['get-primary']).stdout.trim()).toBe('A')
    expect(run(h, ['get-trial']).stdout.trim()).toBe('none')
    expect(run(h, ['get-state', 'B']).stdout.trim()).toBe('bad')
  })

  it('refuses the retired active verb: RAUC only sends set-primary', () => {
    const h = setup()
    const armed = run(h, ['set-state', 'B', 'active'])
    expect(armed.status).toBe(2)
    expect(armed.stderr).toContain('PI_TRYBOOT_BAD_STATE')
    expect(run(h, ['get-trial']).stdout.trim()).toBe('none')
  })

  it.each([
    [
      'unknown key',
      '[all]\ntryboot_a_b=1\nboot_partition=1\nevil=1\n[tryboot]\nboot_partition=2\n',
    ],
    ['unknown section', '[all]\ntryboot_a_b=1\nboot_partition=1\n[evil]\nboot_partition=2\n'],
    ['comment', '[all]\ntryboot_a_b=1\n# comment\nboot_partition=1\n[tryboot]\nboot_partition=2\n'],
    ['disabled tryboot', '[all]\ntryboot_a_b=0\nboot_partition=1\n[tryboot]\nboot_partition=2\n'],
    ['bad partition', '[all]\ntryboot_a_b=1\nboot_partition=3\n[tryboot]\nboot_partition=2\n'],
    [
      'duplicate key',
      '[all]\ntryboot_a_b=1\nboot_partition=1\nboot_partition=2\n[tryboot]\nboot_partition=2\n',
    ],
    ['missing section', '[all]\ntryboot_a_b=1\nboot_partition=1\n'],
    [
      'carriage return',
      '[all]\r\ntryboot_a_b=1\r\nboot_partition=1\r\n[tryboot]\r\nboot_partition=2\r\n',
    ],
  ])('refuses malformed content (%s), never guesses', (_label, content) => {
    const h = setup()
    writeFileSync(path.join(h.bootDir, 'autoboot.txt'), content)
    const result = run(h, ['get-primary'])
    expect(result.status).toBe(3)
    expect(result.stdout.trim()).toBe('')
    expect(result.stderr).toContain('PI_TRYBOOT_')
  })

  it('rejects unknown slots and commands', () => {
    const h = setup()
    expect(run(h, ['get-state', 'C']).status).toBe(2)
    expect(run(h, ['set-state', 'A', 'maybe']).status).toBe(2)
    expect(run(h, ['frobnicate']).status).toBe(2)
  })

  it('reads the booted slot from the device tree, never from a mount', () => {
    const h = setup('2')
    // A findmnt that screams if consulted proves the production path never
    // asks for a mount: the answer must still come from the device tree.
    const bin = path.join(h.dir, 'bin')
    mkdirSync(bin, { recursive: true })
    const scream = path.join(bin, 'findmnt')
    writeFileSync(scream, '#!/bin/sh\necho FINDMNT-CONSULTED >&2\nexit 9\n')
    chmodSync(scream, 0o755)
    const result = run(h, ['get-current'], { PATH: `${bin}${path.delimiter}${process.env.PATH}` })
    expect(result.stdout.trim()).toBe('B')
    expect(result.stderr).not.toContain('FINDMNT-CONSULTED')
  })

  it('refuses get-current when the device tree is missing or unreadable', () => {
    const h = setup()
    rmSync(path.join(h.dir, 'proc'), { recursive: true, force: true })
    const missing = run(h, ['get-current'])
    expect(missing.status).not.toBe(0)
    expect(missing.stderr).toContain('PI_TRYBOOT_NO_CURRENT')
    const h2 = setup()
    rmSync(path.join(h2.dt, 'partition'))
    mkdirSync(path.join(h2.dt, 'partition'), { recursive: true })
    const unreadable = run(h2, ['get-current'])
    expect(unreadable.status).not.toBe(0)
    expect(unreadable.stderr).toContain('PI_TRYBOOT_NO_CURRENT')
  })

  it('validates the tryboot flag when present and ignores its absence', () => {
    const h = setup()
    writeFileSync(path.join(h.dt, 'tryboot'), '1\n')
    expect(run(h, ['get-current']).stdout.trim()).toBe('A')
    writeFileSync(path.join(h.dt, 'tryboot'), 'sometimes\n')
    const bad = run(h, ['get-current'])
    expect(bad.status).not.toBe(0)
    expect(bad.stderr).toContain('PI_TRYBOOT_MALFORMED')
  })

  it('serialises concurrent writers: every writer succeeds, state stays valid', () => {
    const h = setup()
    const driver = path.join(h.dir, 'race.sh')
    writeFileSync(
      driver,
      `#!/bin/sh\npids=""\nfor i in $(seq 1 20); do\n` +
        `  ${posixPath(backend)} set-primary A & pids="$pids $!"\n` +
        `  ${posixPath(backend)} set-primary B & pids="$pids $!"\n` +
        `done\nstatus=0\nfor p in $pids; do wait "$p" || status=1; done\nexit "$status"\n`,
    )
    chmodSync(driver, 0o755)
    const result = spawnSync(shell, [posixPath(driver)], {
      encoding: 'utf8',
      env: {
        ...process.env,
        MUSE_PI_BOOT_DIR: posixPath(h.bootDir),
        MUSE_PI_DEVICE_TREE: posixPath(path.join(h.dir, 'proc/device-tree')),
        MUSE_PI_LOCK_FILE: posixPath(h.lock),
      },
    })
    // A writer whose temp file was deleted by the other writer would fail
    // its rename: any nonzero status here is the P2-9 race.
    expect(result.status).toBe(0)
    expect(run(h, ['get-primary']).status).toBe(0)
    expect(run(h, ['get-trial']).status).toBe(0)
    // Arming B leaves trial B; naming stable A clears it: both are valid
    // serialised outcomes.
    expect(['A', 'B', 'none']).toContain(run(h, ['get-trial']).stdout.trim())
  })

  it('blocks a writer while another holder owns the lock', async () => {
    const h = setup()
    // A foreign holder sleeps under the same lock file while the writer runs.
    // A writer that takes the lock blocks until the spawnSync timeout kills
    // it (status null); a writer with no lock would finish in milliseconds
    // with status 0, which fails this test.
    const holder = spawn('flock', [h.lock, 'sleep', '30'], { stdio: 'ignore' })
    holder.unref()
    await new Promise((resolve) => globalThis.setTimeout(resolve, 500))
    try {
      const blocked = spawnSync(shell, [posixPath(backend), 'set-primary', 'B'], {
        encoding: 'utf8',
        timeout: 2000,
        env: {
          ...process.env,
          MUSE_PI_BOOT_DIR: posixPath(h.bootDir),
          MUSE_PI_DEVICE_TREE: posixPath(path.join(h.dir, 'proc/device-tree')),
          MUSE_PI_LOCK_FILE: posixPath(h.lock),
        },
      })
      expect(blocked.status).toBe(null)
      expect(run(h, ['get-trial']).stdout.trim()).toBe('none')
    } finally {
      holder.kill('SIGKILL')
    }
  })

  it('refuses a write when the lock directory is missing', () => {
    const h = setup()
    const result = run(h, ['set-primary', 'B'], {
      MUSE_PI_LOCK_FILE: posixPath(path.join(h.dir, 'no-such-dir', 'lock')),
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('PI_TRYBOOT_NO_LOCK')
  })
})
