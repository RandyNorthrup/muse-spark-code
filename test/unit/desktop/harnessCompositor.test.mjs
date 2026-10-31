import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { DEFAULT_OUTPUTS, hyprlandConfig } from '../../../test/desktop/harness/lib/compositor.mjs'
import { parseHarnessArgs } from '../../../test/desktop/harness/lib/harnessCli.mjs'
import { runCapture, stopProcessGroup } from '../../../test/desktop/harness/lib/proc.mjs'
import {
  findExecutable,
  findKmsDevices,
  probeTools,
} from '../../../test/desktop/harness/lib/tools.mjs'
import { spawn } from 'node:child_process'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const scratch = []

afterAll(async () => {
  for (const dir of scratch) await rm(dir, { recursive: true, force: true })
})

describe('the generated harness config', () => {
  it('pins the two headless outputs, disables the rest, and turns effects off', () => {
    const config = hyprlandConfig(DEFAULT_OUTPUTS)
    expect(config).toContain('output = "HEADLESS-1", mode = "1920x1080@60"')
    expect(config).toContain('output = "HEADLESS-2", mode = "1280x800@60"')
    expect(config).toContain('hl.monitor({ output = "", disabled = true })')
    expect(config).toContain('animations = { enabled = false }')
    expect(config).toContain('disable_hyprland_logo = true')
    expect(config).toContain('not the product config')
  })
})

describe('tool and KMS probing on real directories', () => {
  it('finds this machine node and reports an absent tool without a path', async () => {
    const tools = await probeTools()
    const node = tools.find((tool) => tool.name === 'node')
    expect(node.path).toBeDefined()
    expect(node.version).toMatch(/^v\d+\./)
    expect(await findExecutable('definitely-not-a-real-binary-xyz')).toBeUndefined()
  })

  it('reads card and render nodes, and nothing from an empty directory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muse-kms-'))
    scratch.push(dir)
    expect(await findKmsDevices(dir)).toEqual([])
    await writeFile(path.join(dir, 'card1'), '')
    await writeFile(path.join(dir, 'renderD128'), '')
    await writeFile(path.join(dir, 'controlD64'), '')
    expect(await findKmsDevices(dir)).toEqual(['card1', 'renderD128'])
    expect(await findKmsDevices(path.join(dir, 'missing'))).toEqual([])
  })
})

describe('process helpers', () => {
  it('captures a real command and its exit code', async () => {
    const result = await runCapture(process.execPath, ['--version'], { timeoutMs: 5000 })
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/^v\d+\./)
    const refused = await runCapture('/nonexistent/binary-xyz', [], { timeoutMs: 5000 })
    expect(refused.code).toBeNull()
  })

  // POSIX process groups; Windows job control is a different mechanism.
  it.skipIf(process.platform === 'win32')('stops a whole detached process group', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      detached: true,
      stdio: 'ignore',
    })
    const closed = new Promise((resolve) => {
      child.once('close', () => resolve(true))
    })
    await stopProcessGroup(child, { graceMs: 200 })
    await expect(closed).resolves.toBe(true)
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  })
})

describe('harness arguments', () => {
  it('parses a session with outputs and a client command', () => {
    const parsed = parseHarnessArgs([
      'session',
      '--out',
      'temp/x',
      '--outputs',
      'HEADLESS-1:1920x1080',
      '--',
      'foot',
      'sh',
    ])
    expect(parsed).toMatchObject({
      command: 'session',
      out: 'temp/x',
      outputs: [{ name: 'HEADLESS-1', width: 1920, height: 1080 }],
      client: ['foot', 'sh'],
    })
  })

  it('rejects unknown options and malformed outputs with usage', () => {
    expect(() => parseHarnessArgs(['check', '--bogus'])).toThrow('unknown option')
    expect(() => parseHarnessArgs(['session', '--outputs', 'wide'])).toThrow('NAME:WIDTHxHEIGHT')
    expect(() => parseHarnessArgs(['session', '--out'])).toThrow('needs a value')
  })
})

describe('the harness script as a child process', () => {
  it('lists scenes as JSON and refuses an unknown command', () => {
    const scenes = spawnSync(
      process.execPath,
      ['scripts/desktop-harness.mjs', 'scenes', '--json'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
    expect(scenes.status).toBe(0)
    const parsed = JSON.parse(scenes.stdout)
    expect(parsed.scenes.map((scene) => scene.id)).toContain('greeter')
    const bogus = spawnSync(process.execPath, ['scripts/desktop-harness.mjs', 'bogus'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(bogus.status).toBe(1)
    expect(bogus.stderr).toContain('unknown command')
  })
})
