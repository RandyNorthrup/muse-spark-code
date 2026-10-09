import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const backend = fileURLToPath(new URL('../../os/update/pi-tryboot-backend', import.meta.url))
const temporary = []
function directory() {
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'm110-os2-tryboot-'))
  temporary.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const OS1_INITIAL = '[all]\ntryboot_a_b=1\nboot_partition=1\n[tryboot]\nboot_partition=2\n'

function run(dir, args, extraEnv = {}) {
  return spawnSync('sh', [backend, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MUSE_PI_BOOT_DIR: dir,
      MUSE_PI_CURRENT_SLOT: 'A',
      ...extraEnv,
    },
  })
}

function setup(content = OS1_INITIAL) {
  const dir = directory()
  writeFileSync(path.join(dir, 'autoboot.txt'), content)
  return dir
}

describe('M110-OS2 Pi tryboot backend', () => {
  it('accepts the OS1 initial file: primary A, no trial, A good', () => {
    const dir = setup()
    expect(run(dir, ['get-primary']).stdout.trim()).toBe('A')
    expect(run(dir, ['get-trial']).stdout.trim()).toBe('none')
    expect(run(dir, ['get-state', 'A']).stdout.trim()).toBe('good')
    expect(run(dir, ['get-state', 'B']).stdout.trim()).toBe('bad')
    expect(run(dir, ['get-current']).stdout.trim()).toBe('A')
  })

  it('runs a one-shot trial: arm B, keep A stable, promote on good', () => {
    const dir = setup()
    expect(run(dir, ['set-state', 'B', 'active']).status).toBe(0)
    expect(run(dir, ['get-primary']).stdout.trim()).toBe('A')
    expect(run(dir, ['get-trial']).stdout.trim()).toBe('B')
    // A crash or reset falls back to A by itself: the stable selection is kept.
    expect(run(dir, ['set-state', 'B', 'good'], { MUSE_PI_CURRENT_SLOT: 'B' }).status).toBe(0)
    expect(run(dir, ['get-primary']).stdout.trim()).toBe('B')
    expect(run(dir, ['get-trial']).stdout.trim()).toBe('none')
  })

  it('never promotes a good marking made outside the trial slot', () => {
    const dir = setup()
    run(dir, ['set-state', 'B', 'active'])
    // Install-time marking while still running A: records only.
    expect(run(dir, ['set-state', 'B', 'good']).status).toBe(0)
    expect(run(dir, ['get-primary']).stdout.trim()).toBe('A')
    expect(run(dir, ['get-trial']).stdout.trim()).toBe('B')
  })

  it('disarms a bad trial and keeps the stable selection', () => {
    const dir = setup()
    run(dir, ['set-state', 'B', 'active'])
    expect(run(dir, ['set-state', 'B', 'bad']).status).toBe(0)
    expect(run(dir, ['get-primary']).stdout.trim()).toBe('A')
    expect(run(dir, ['get-trial']).stdout.trim()).toBe('none')
    expect(run(dir, ['get-state', 'B']).stdout.trim()).toBe('bad')
  })

  it('switches stably with set-primary and refuses a trial on the primary', () => {
    const dir = setup()
    expect(run(dir, ['set-primary', 'B']).status).toBe(0)
    expect(run(dir, ['get-primary']).stdout.trim()).toBe('B')
    const armed = run(dir, ['set-state', 'B', 'active'])
    expect(armed.status).toBe(3)
    expect(armed.stderr).toContain('PI_TRYBOOT_NOT_STANDBY')
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
    const dir = setup(content)
    const result = run(dir, ['get-primary'])
    expect(result.status).toBe(3)
    expect(result.stdout.trim()).toBe('')
    expect(result.stderr).toContain('PI_TRYBOOT_')
  })

  it('rejects unknown slots and commands', () => {
    const dir = setup()
    expect(run(dir, ['get-state', 'C']).status).toBe(2)
    expect(run(dir, ['set-state', 'A', 'maybe']).status).toBe(2)
    expect(run(dir, ['frobnicate']).status).toBe(2)
  })
})
