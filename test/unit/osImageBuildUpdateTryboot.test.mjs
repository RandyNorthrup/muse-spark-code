import { Buffer } from 'node:buffer'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  OS1_INITIAL,
  PI_PARTITION,
  bootInto,
  dtInt,
  hostLacks,
  noFlockReason,
  piBackend as backend,
  piLayout,
  posixPath,
  shell,
} from './helpers/osPiTryboot.mjs'

const noFlock = hostLacks('flock')
const writes = noFlock ? `writes (${noFlockReason})` : 'writes'

const temporary = []
function directory() {
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'm110-os2-tryboot-'))
  temporary.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// Post-handoff layout fixture: the controller FAT (partition 1, label
// muse-pi-ctl, never a RAUC slot) holds only autoboot.txt; boot A/B are
// partitions 2/3.
function setup(booted = 'A') {
  const dir = directory()
  const layout = piLayout(dir, booted)
  writeFileSync(path.join(layout.bootDir, 'autoboot.txt'), OS1_INITIAL)
  return { dir, ...layout, lock: layout.env.MUSE_PI_LOCK_FILE }
}

function run(h, args, extraEnv = {}) {
  return spawnSync(shell, [posixPath(backend), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...h.env, ...extraEnv },
  })
}

const autoboot = (h) => readFileSync(path.join(h.bootDir, 'autoboot.txt'), 'utf8')

describe('M110-OS2 Pi tryboot backend: reads', () => {
  it('refuses a boot dir whose path contains whitespace, never matching it', () => {
    // The backend documents this fail-closed refusal: a mount point with
    // whitespace never matches, so such a path cannot select a slot FAT.
    const dir = path.join(directory(), 'with space')
    mkdirSync(dir, { recursive: true })
    const layout = piLayout(dir, 'A')
    writeFileSync(path.join(layout.bootDir, 'autoboot.txt'), OS1_INITIAL)
    const h = { dir, ...layout, lock: layout.env.MUSE_PI_LOCK_FILE }
    const out = run(h, ['get-primary'])
    expect(out.status).toBe(3)
    expect(out.stderr).toContain('NOT_CONTROLLER')
  })
  it('uses the documented controller-first geometry: controller 1, A 2, B 3', () => {
    // Raspberry Pi's autoboot.txt A/B example: partition 1 holds only
    // autoboot.txt, the boot slots are 2 and 3.
    expect(PI_PARTITION).toEqual({ controller: 1, A: 2, B: 3 })
  })

  it('accepts the OS1 initial file: primary A, no trial, A good', () => {
    const h = setup()
    expect(run(h, ['get-primary']).stdout.trim()).toBe('A')
    expect(run(h, ['get-trial']).stdout.trim()).toBe('none')
    expect(run(h, ['get-state', 'A']).stdout.trim()).toBe('good')
    expect(run(h, ['get-state', 'B']).stdout.trim()).toBe('bad')
    expect(run(h, ['get-current']).stdout.trim()).toBe('A')
  })

  it('accepts B stable on partition 3 and refuses the controller as a selection', () => {
    const h = setup()
    writeFileSync(
      path.join(h.bootDir, 'autoboot.txt'),
      '[all]\ntryboot_a_b=1\nboot_partition=3\n[tryboot]\nboot_partition=2\n',
    )
    expect(run(h, ['get-primary']).stdout.trim()).toBe('B')
    // The pre-handoff 1/2 numbering selects the controller FAT: refused.
    writeFileSync(
      path.join(h.bootDir, 'autoboot.txt'),
      '[all]\ntryboot_a_b=1\nboot_partition=1\n[tryboot]\nboot_partition=2\n',
    )
    const controller = run(h, ['get-primary'])
    expect(controller.status).toBe(3)
    expect(controller.stdout.trim()).toBe('')
    expect(controller.stderr).toContain('PI_TRYBOOT_MALFORMED boot_partition=1 controller')
  })

  it.each([
    [
      'unknown key',
      '[all]\ntryboot_a_b=1\nboot_partition=2\nevil=1\n[tryboot]\nboot_partition=3\n',
    ],
    ['unknown section', '[all]\ntryboot_a_b=1\nboot_partition=2\n[evil]\nboot_partition=3\n'],
    ['comment', '[all]\ntryboot_a_b=1\n# comment\nboot_partition=2\n[tryboot]\nboot_partition=3\n'],
    ['disabled tryboot', '[all]\ntryboot_a_b=0\nboot_partition=2\n[tryboot]\nboot_partition=3\n'],
    ['bad partition', '[all]\ntryboot_a_b=1\nboot_partition=4\n[tryboot]\nboot_partition=3\n'],
    [
      'bad tryboot partition',
      '[all]\ntryboot_a_b=1\nboot_partition=2\n[tryboot]\nboot_partition=9\n',
    ],
    [
      'duplicate key',
      '[all]\ntryboot_a_b=1\nboot_partition=2\nboot_partition=3\n[tryboot]\nboot_partition=3\n',
    ],
    ['missing section', '[all]\ntryboot_a_b=1\nboot_partition=2\n'],
    [
      'carriage return',
      '[all]\r\ntryboot_a_b=1\r\nboot_partition=2\r\n[tryboot]\r\nboot_partition=3\r\n',
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

  it('reads the booted slot from binary device-tree integers, never from a mount', () => {
    const h = setup('B')
    // A findmnt that screams if consulted proves the production path never
    // asks for a mount: the answer must still come from the device tree.
    const bin = path.join(h.dir, 'bin')
    mkdirSync(bin, { recursive: true })
    const scream = path.join(bin, 'findmnt')
    writeFileSync(scream, '#!/bin/sh\necho FINDMNT-CONSULTED >&2\nexit 9\n')
    chmodSync(scream, 0o755)
    const pathEnv = { PATH: `${bin}${path.delimiter}${process.env.PATH}` }
    writeFileSync(path.join(h.dt, 'partition'), Buffer.from([0, 0, 0, 3]))
    const b = run(h, ['get-current'], pathEnv)
    expect(b.stdout.trim()).toBe('B')
    expect(b.stderr).not.toContain('FINDMNT-CONSULTED')
    writeFileSync(path.join(h.dt, 'partition'), Buffer.from([0, 0, 0, 2]))
    expect(run(h, ['get-current'], pathEnv).stdout.trim()).toBe('A')
  })

  it.each([
    ['ASCII digit', Buffer.from('2\n')],
    ['bare ASCII digit', Buffer.from('3')],
    ['three bytes', Buffer.from([0, 0, 2])],
    ['five bytes', Buffer.from([0, 0, 0, 0, 2])],
    ['empty', Buffer.alloc(0)],
    ['the controller partition', dtInt(1)],
    ['an unmapped partition', dtInt(4)],
    ['a little-endian 2', Buffer.from([2, 0, 0, 0])],
  ])('refuses a partition record that is %s', (_label, bytes) => {
    const h = setup()
    writeFileSync(path.join(h.dt, 'partition'), bytes)
    const result = run(h, ['get-current'])
    expect(result.status).toBe(3)
    expect(result.stdout.trim()).toBe('')
    expect(result.stderr).toContain('PI_TRYBOOT_NO_CURRENT')
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

  it('validates the binary tryboot flag when present and ignores its absence', () => {
    const h = setup()
    writeFileSync(path.join(h.dt, 'tryboot'), dtInt(1))
    expect(run(h, ['get-current']).stdout.trim()).toBe('A')
    writeFileSync(path.join(h.dt, 'tryboot'), dtInt(0))
    expect(run(h, ['get-current']).stdout.trim()).toBe('A')
    for (const bytes of [Buffer.from('1\n'), dtInt(2), Buffer.from([0, 1])]) {
      writeFileSync(path.join(h.dt, 'tryboot'), bytes)
      const bad = run(h, ['get-current'])
      expect(bad.status).toBe(3)
      expect(bad.stdout.trim()).toBe('')
      expect(bad.stderr).toContain('PI_TRYBOOT_MALFORMED')
    }
  })

  it('refuses every command unless the controller label is mounted at the boot dir', () => {
    const h = setup()
    const slotFat = path.join(h.dir, 'dev-muse-pi-boot-a')
    writeFileSync(slotFat, '')
    for (const mountinfo of [
      // A boot slot FAT mounted where the controller belongs.
      `36 25 179:2 / ${posixPath(h.bootDir)} rw - vfat ${posixPath(slotFat)} rw\n`,
      // Nothing mounted there at all.
      `36 25 179:5 / / rw - ext4 /dev/root rw\n`,
      '',
    ]) {
      writeFileSync(h.mountinfo, mountinfo)
      for (const args of [['get-primary'], ['get-current'], ['set-primary', 'B']]) {
        const result = run(h, args)
        expect(result.status).toBe(3)
        expect(result.stdout.trim()).toBe('')
        expect(result.stderr).toContain('PI_TRYBOOT_NOT_CONTROLLER')
      }
    }
    expect(autoboot(h)).toBe(OS1_INITIAL)
    rmSync(h.device)
    writeFileSync(
      h.mountinfo,
      `36 25 179:1 / ${posixPath(h.bootDir)} rw - vfat ${posixPath(h.device)} rw\n`,
    )
    expect(run(h, ['get-primary']).stderr).toContain('PI_TRYBOOT_NOT_CONTROLLER device=')
  })
})

describe.skipIf(noFlock)(`M110-OS2 Pi tryboot backend: ${writes}`, () => {
  it('set-primary arms a one-shot trial and never changes the stable slot', () => {
    const h = setup()
    // RAUC install.c calls set-primary B after writing B: B must become the
    // trial while A stays the stable fallback.
    expect(run(h, ['set-primary', 'B']).status).toBe(0)
    expect(run(h, ['get-primary']).stdout.trim()).toBe('A')
    expect(run(h, ['get-trial']).stdout.trim()).toBe('B')
    expect(run(h, ['get-state', 'A']).stdout.trim()).toBe('good')
    // Physical numbers on disk: [all] stays on A (2), [tryboot] selects B (3).
    expect(autoboot(h)).toBe(
      '[all]\ntryboot_a_b=1\nboot_partition=2\nmuse_trial=B\nmuse_state_a=good\nmuse_state_b=bad\n' +
        '[tryboot]\nboot_partition=3\n',
    )
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
    // The firmware booted partition 3 on the trial.
    bootInto(h, 'B')
    expect(run(h, ['set-state', 'B', 'good']).status).toBe(0)
    expect(run(h, ['get-primary']).stdout.trim()).toBe('B')
    expect(run(h, ['get-trial']).stdout.trim()).toBe('none')
    expect(autoboot(h)).toContain('[all]\ntryboot_a_b=1\nboot_partition=3\n')
    expect(autoboot(h)).toContain('[tryboot]\nboot_partition=2\n')
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

  it('removes only its own temp file and reports another stray', () => {
    const h = setup()
    const stray = path.join(h.bootDir, 'autoboot.txt.muse-tmp-OTHER1')
    writeFileSync(stray, 'another writer\n')
    const result = run(h, ['set-primary', 'B'])
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('PI_TRYBOOT_STRAY left=')
    expect(readFileSync(stray, 'utf8')).toBe('another writer\n')
    expect(run(h, ['get-trial']).stdout.trim()).toBe('B')
    // This writer's own temp file is gone: only the foreign stray remains.
    const own = ['set-primary', 'A']
    expect(run(h, own).status).toBe(0)
    const left = spawnSync(shell, ['-c', `ls ${posixPath(h.bootDir)}`], { encoding: 'utf8' })
    expect(
      left.stdout
        .trim()
        .split('\n')
        .toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(['autoboot.txt', 'autoboot.txt.muse-tmp-OTHER1'])
    expect(existsSync(stray)).toBe(true)
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
      env: { ...process.env, ...h.env },
    })
    // A writer whose temp file was deleted by the other writer would fail
    // its rename: any nonzero status here is the P2-9 race.
    expect(result.status).toBe(0)
    expect(run(h, ['get-primary']).status).toBe(0)
    // Arming B leaves trial B; naming stable A clears it: both are valid
    // serialised outcomes.
    expect(['B', 'none']).toContain(run(h, ['get-trial']).stdout.trim())
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
        env: { ...process.env, ...h.env },
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
