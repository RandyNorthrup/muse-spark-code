import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { setTimeout as delay } from 'node:timers/promises'
import { isTestProcessAlive } from './helpers/makerSerial'
import { z } from 'zod'
import { buildMakerLeaseWorker, readMakerLeaseFrame } from '../e2e/helpers/makerEmulatorLease'

const exec = promisify(execFile)
const directories: string[] = []
const processes: number[] = []
afterEach(async () => {
  for (const pid of processes.splice(0)) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* Already reaped by the supervisor. */
    }
  }
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})
async function until(isReady: () => Promise<boolean>) {
  const deadline = Date.now() + 5000
  while (!(await isReady())) {
    if (Date.now() > deadline) throw new Error('cleanup deadline')
    await delay(20)
  }
}
const supervisor = path.resolve('scripts/emulators/supervisor.py')
async function control(action: string, directory: string, command: string[] = []) {
  return await exec('/usr/bin/python3', [supervisor, action, 'test', directory, ...command], {
    env: { PATH: process.env['PATH'] },
    timeout: 20_000,
  })
}

describe.skipIf(process.platform !== 'linux')('emulator process ownership', () => {
  it('parses the live lease worker without emulator assets or a device open', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mx-frame-'))
    directories.push(directory)
    const resource = path.join(directory, 'ordinary-file')
    await writeFile(resource, '')
    const worker = path.join(directory, 'lease-worker.cjs')
    await buildMakerLeaseWorker(worker)
    const child = spawn(process.execPath, [worker, path.join(directory, 'leases'), resource], {
      env: { PATH: process.env['PATH'] },
      stdio: 'pipe',
    })
    if (child.pid !== undefined) processes.push(child.pid)
    const exited = new Promise<number | null>((resolve) => {
      child.once('exit', resolve)
    })
    let capture = ''
    child.stdout.on('data', (bytes: Buffer) => {
      capture += bytes.toString('utf8')
    })
    try {
      expect(await readMakerLeaseFrame(child)).toMatchObject({
        status: 'claimed',
        record: { version: 2, generation: expect.any(String) },
      })
    } finally {
      child.stdin.end()
      await writeFile(path.resolve('temp/m103-int-lease-frame.json'), capture)
      expect(await exited).toBe(0)
    }
  })
  it('starts once, strips inherited environment, and Stop removes both PTYs and all children', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mx-life-'))
    directories.push(directory)
    const command = [
      '/usr/bin/python3',
      '-c',
      'import os,time; print(os.environ.get("MUSE_EMULATOR_PROBE","absent"),flush=True); time.sleep(30)',
    ]
    const { stdout } = await exec(
      '/usr/bin/python3',
      [supervisor, 'start', 'test', directory, ...command],
      {
        env: { PATH: process.env['PATH'], MUSE_EMULATOR_PROBE: 'must-not-reach-child' },
        timeout: 20_000,
      },
    )
    const run = z
      .object({ pid: z.number(), children: z.array(z.number()), port: z.string() })
      .parse(JSON.parse(stdout))
    processes.push(run.pid, ...run.children)
    expect(await control('start', directory, command)).toMatchObject({ stdout })
    expect(await readFile(path.join(directory, 'emulator.log'), 'utf8')).toBe('absent\n')
    const sample = await stat(run.port)
    expect(sample.isCharacterDevice()).toBe(true)
    await control('stop', directory)
    await control('stop', directory)
    for (const pid of [run.pid, ...run.children])
      await until(async () => !(await isTestProcessAlive(pid)))
    await expect(stat(run.port)).rejects.toThrow()
    await expect(stat(path.join(directory, 'uart'))).rejects.toThrow()
    await expect(stat(path.join(directory, 'run.json'))).rejects.toThrow()
  })
  it('refuses a shared state directory and cleans failed startup', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mx-fail-'))
    directories.push(directory)
    await expect(control('start', directory, ['/no-such-emulator-command'])).rejects.toThrow()
    await until(async () => {
      const result = await control('status', directory)
      return result.stdout.includes('stopped')
    })
    await expect(stat(path.join(directory, 'ttyEMU-test-0'))).rejects.toThrow()
    await expect(control('status', '/tmp')).rejects.toThrow()
  })
  it('does not control a process whose birth stamp differs from the recorded owner', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mx-stamp-'))
    directories.push(directory)
    const { stdout } = await control('start', directory, ['/bin/sleep', '30'])
    const run = z
      .object({ pid: z.number(), children: z.array(z.number()) })
      .parse(JSON.parse(stdout))
    processes.push(run.pid, ...run.children)
    const file = path.join(directory, 'run.json')
    const original = await readFile(file)
    try {
      const record = z
        .looseObject({ stamp: z.string() })
        .parse(JSON.parse(original.toString('utf8')))
      await writeFile(file, JSON.stringify({ ...record, stamp: 'wrong-process-birth' }))
      const status = await control('status', directory)
      expect(status.stdout).toContain('stopped')
      await control('stop', directory)
      expect(await isTestProcessAlive(run.pid)).toBe(true)
    } finally {
      await writeFile(file, original)
      await control('stop', directory)
    }
  })
  it('refuses start without an emulator command', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mx-command-'))
    directories.push(directory)
    await expect(control('start', directory)).rejects.toThrow()
  })
  it('refuses any flash target outside private emulator PTYs before reading approved bytes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mx-port-'))
    directories.push(directory)
    await symlink('/dev/null', path.join(directory, 'ttyEMU-esp32-0'))
    await expect(
      exec(
        '/usr/bin/python3',
        [path.resolve('test/fixtures/maker-emulators/flash.py'), 'esp32', directory, '1'],
        {
          env: { PATH: process.env['PATH'] },
          timeout: 2000,
        },
      ),
    ).rejects.toMatchObject({ code: 2 })
    await expect(stat(path.join(directory, 'approved-image'))).rejects.toThrow()
  })
})
