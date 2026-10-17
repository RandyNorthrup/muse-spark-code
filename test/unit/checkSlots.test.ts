import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  captureCheckSnapshot,
  CheckSlots,
  type CheckProcess,
  type CheckSlotDeps,
} from '../../src/host/team/checkSlots'
import { runnerTestProcess as processRun, runnerTestGit as git } from './helpers/runnerProcesses'
import type { CheckJob } from '../../src/core/runners/routing'

const folders: string[] = []
const template = { folder: '', user: '' }
beforeAll(async () => {
  const base = path.join(process.cwd(), 'temp')
  await mkdir(base, { recursive: true })
  template.folder = await mkdtemp(path.join(base, 'm96-slot-seed-'))
  template.user = path.join(template.folder, 'user')
  await mkdir(template.user)
  await git(template.user, 'init')
  await writeFile(path.join(template.user, 'package-lock.json'), 'lock-1\n')
  await writeFile(path.join(template.user, 'tracked.txt'), 'base')
  await git(template.user, 'add', '.')
  await git(
    template.user,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@localhost',
    'commit',
    '-m',
    'base',
  )
})
afterAll(async () => {
  if (template.folder !== '') await rm(template.folder, { recursive: true, force: true })
})
async function fixture(
  count = 1,
): Promise<{ deps: CheckSlotDeps; job: CheckJob; folder: string; worker: string }> {
  const base = path.join(process.cwd(), 'temp')
  await mkdir(base, { recursive: true })
  const folder = await mkdtemp(path.join(base, 'm96-slot-'))
  folders.push(folder)
  const user = path.join(folder, 'user')
  const worker = path.join(folder, 'worker')
  // Each case gets fresh native repositories; only immutable seed objects
  // are shared, avoiding repeated init/add/commit process startup on Windows.
  await git(folder, 'clone', '--shared', template.user, user)
  await git(folder, 'clone', '--shared', user, worker)
  await writeFile(path.join(worker, 'tracked.txt'), 'working-edit')
  await writeFile(path.join(worker, 'untracked.txt'), 'untracked')
  const deps: CheckSlotDeps = {
    root: path.join(folder, 'slots'),
    repositoryRoot: user,
    platform: process.platform,
    count,
    file: 'git',
    run: processRun,
    env: { ...process.env, VENDOR_API_KEY: 'fixture-only' },
    setupCommand: `const fs=require('node:fs');fs.mkdirSync('node_modules',{recursive:true});fs.writeFileSync('node_modules/value','seed');fs.appendFileSync(${JSON.stringify(path.join(folder, 'installs'))},'x')`,
    cacheKey: 'npm',
    installPaths: ['node_modules'],
    shell: process.execPath,
    shellArgs: (command) => ['-e', command],
    isTrusted: () => true,
    isHostBusy: () => false,
  }
  const job: CheckJob = {
    runId: 'run-1',
    cwd: worker,
    command:
      "console.log(require('node:fs').readFileSync('tracked.txt','utf8')+' '+require('node:fs').readFileSync('untracked.txt','utf8'))",
    commandClass: 'tests',
    timeoutMs: 10_000,
    labels: [],
    preferredRunners: [],
    lockfiles: ['package-lock.json'],
    signal: new AbortController().signal,
    onOutput: vi.fn(),
  }
  return { deps, job, folder, worker }
}
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})
describe('persistent check slots', () => {
  it('scrubs broad credential names from every Git, setup and check child', async () => {
    const { deps, job } = await fixture()
    const names = ['NPM_TOKEN', 'AZURE_KEY', 'DATABASE_PASSWORD', 'X_SECRET']
    const run = vi.fn(deps.run)
    const slots = new CheckSlots({
      ...deps,
      run,
      env: { ...deps.env, ...Object.fromEntries(names.map((name) => [name, 'fixture-only'])) },
    })
    const result = await slots.run(job)
    expect(result.exitCode).toBe(0)
    expect(run.mock.calls.some(([request]) => request.file === deps.file)).toBe(true)
    expect(run.mock.calls.filter(([request]) => request.file === deps.shell)).toHaveLength(2)
    for (const [request] of run.mock.calls)
      for (const name of names) expect(request.env).not.toHaveProperty(name)
  })
  it('snapshots working edits and untracked files without touching the real index or refs', async () => {
    const { deps, worker, folder } = await fixture()
    const index = await readFile(path.join(worker, '.git', 'index'))
    const refs = await git(worker, 'show-ref')
    const snapshot = await captureCheckSnapshot(
      worker,
      path.join(folder, 'scratch'),
      deps,
      () => undefined,
    )
    expect(await git(worker, 'show', `${snapshot}:tracked.txt`)).toBe('working-edit')
    expect(await git(worker, 'show', `${snapshot}:untracked.txt`)).toBe('untracked')
    expect(await readFile(path.join(worker, '.git', 'index'))).toEqual(index)
    expect(await git(worker, 'show-ref')).toBe(refs)
  })
  it('resets source and installs once per exact lockfile hash in each slot', async () => {
    const { deps, job, folder, worker } = await fixture()
    const slots = new CheckSlots(deps)
    const first = await slots.run(job)
    expect(first.output).toBe('working-edit untracked\n')
    await slots.run({
      ...job,
      command:
        "const fs=require('node:fs');fs.writeFileSync('stale','bad');fs.writeFileSync('node_modules/value','mutated')",
    })
    const fresh = await slots.run({
      ...job,
      command:
        "const fs=require('node:fs');console.log(fs.existsSync('stale'),fs.readFileSync('node_modules/value','utf8'))",
    })
    expect(fresh.output).toBe('false seed\n')
    expect(await readFile(path.join(folder, 'installs'), 'utf8')).toBe('x')
    await writeFile(path.join(worker, 'package-lock.json'), 'lock-1\n\n')
    await slots.run(job)
    expect(await readFile(path.join(folder, 'installs'), 'utf8')).toBe('xx')
    expect(slots.states()).toEqual([{ id: 0, busy: false, uncertain: false }])
  })
  it('owns persistent objects after the first task copy is removed', async () => {
    const { deps, job, worker, folder } = await fixture()
    const slots = new CheckSlots(deps)
    expect(await slots.run(job)).toMatchObject({ exitCode: 0 })
    await rm(worker, { recursive: true })
    const next = path.join(folder, 'next-worker')
    await git(folder, 'clone', deps.repositoryRoot, next)
    await writeFile(path.join(next, 'tracked.txt'), 'next-edit')
    await writeFile(path.join(next, 'untracked.txt'), 'next-untracked')
    expect(await slots.run({ ...job, cwd: next, runId: 'next-task' })).toMatchObject({
      exitCode: 0,
      output: 'next-edit next-untracked\n',
    })
    await expect(
      readFile(path.join(deps.root, '0', 'copy', '.git', 'objects', 'info', 'alternates')),
    ).rejects.toThrow()
  })
  it('releases snapshot ownership on cancellation and Git failures with proven retirement', async () => {
    for (const phase of ['cancel', 'trust', 'gitFailure']) {
      const { deps, job } = await fixture()
      const controller = new AbortController()
      let isTrusted = true
      const run = vi.fn<CheckProcess>(async (request) => {
        const result = await processRun(request)
        if (phase === 'cancel') controller.abort()
        else if (phase === 'trust') isTrusted = false
        return { ...result, exitCode: phase === 'gitFailure' ? 1 : result.exitCode }
      })
      const slots = new CheckSlots({ ...deps, run, isTrusted: () => isTrusted })
      await expect(slots.run({ ...job, signal: controller.signal })).rejects.toThrow()
      expect(run).toHaveBeenCalledTimes(1)
      expect(slots.states()).toEqual([{ id: 0, busy: false, uncertain: false }])
    }
  })
  it('hashes binary lockfiles without collapsing distinct invalid UTF-8 bytes', async () => {
    const { deps, job, worker, folder } = await fixture()
    const slots = new CheckSlots(deps)
    await writeFile(path.join(worker, 'package-lock.json'), Buffer.from([255]))
    await slots.run(job)
    await writeFile(path.join(worker, 'package-lock.json'), Buffer.from([254]))
    await slots.run(job)
    expect(await readFile(path.join(folder, 'installs'), 'utf8')).toBe('xx')
  })
  it('isolates installs between concurrent slots and never shares mutable cache files', async () => {
    const { deps, job, folder } = await fixture(2)
    const slots = new CheckSlots(deps)
    const first = slots.run({
      ...job,
      command: "require('node:fs').writeFileSync('node_modules/value','one')",
    })
    const second = slots.run({
      ...job,
      runId: 'run-2',
      command: "console.log(require('node:fs').readFileSync('node_modules/value','utf8'))",
    })
    const results = await Promise.all([first, second])
    expect(results[1].output).toBe('seed\n')
    expect(await readFile(path.join(folder, 'installs'), 'utf8')).toBe('xx')
  })
  it('copies the install per working copy and keeps the slot cache pristine', async () => {
    const { deps, job, worker } = await fixture()
    const slots = new CheckSlots(deps)
    await slots.installInCopy(job)
    await writeFile(path.join(worker, 'node_modules', 'value'), 'copy-edit')
    const result = await slots.run({
      ...job,
      command: "console.log(require('node:fs').readFileSync('node_modules/value','utf8'))",
    })
    expect(result.output).toBe('seed\n')
    expect(await readFile(path.join(worker, 'node_modules', 'value'), 'utf8')).toBe('copy-edit')
  })
  it.each(
    ['command', 'snapshot', 'copyGit'].flatMap((phase) =>
      [false, true].map((shouldReject) => ({ phase, shouldReject })),
    ),
  )(
    'keeps slots occupied for uncertain descendants or transport failure: %j',
    async ({ phase, shouldReject }) => {
      const { deps, job } = await fixture()
      const slots = new CheckSlots({
        ...deps,
        run: async (request) => {
          if (
            (phase === 'command' && request.file === process.execPath) ||
            (phase === 'snapshot' && request.args.includes('config')) ||
            (phase === 'copyGit' && request.args.includes('clone'))
          ) {
            if (shouldReject) throw new Error('connection lost')
            const result = await processRun(request)
            return { ...result, descendantsEnded: false }
          }
          return await processRun(request)
        },
      })
      await expect(slots.run(job)).rejects.toThrow()
      expect(slots.states()).toEqual([{ id: 0, busy: true, uncertain: true }])
      await expect(slots.run(job)).rejects.toThrow()
    },
  )
  it('refuses the user checkout, host pressure, untrusted work, escaped installs and missing lockfiles', async () => {
    const { deps, job } = await fixture()
    const run = vi.fn(processRun)
    await expect(
      new CheckSlots({ ...deps, run }).run({ ...job, cwd: deps.repositoryRoot }),
    ).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
    await expect(
      new CheckSlots({ ...deps, run, isHostBusy: () => true }).run(job),
    ).rejects.toThrow()
    await expect(
      new CheckSlots({ ...deps, run, isTrusted: () => false }).run(job),
    ).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
    expect(() => new CheckSlots({ ...deps, installPaths: ['../outside'] })).toThrow()
    expect(() => new CheckSlots({ ...deps, installPaths: ['.git'] })).toThrow()
    expect(() => new CheckSlots({ ...deps, platform: 'win32', installPaths: ['.GiT'] })).toThrow()
    expect(() => new CheckSlots({ ...deps, count: 0 })).toThrow()
    await expect(
      new CheckSlots(deps).run({ ...job, lockfiles: ['missing.lock'] }),
    ).rejects.toThrow()
    await expect(new CheckSlots(deps).run({ ...job, lockfiles: ['../outside'] })).rejects.toThrow()
    await mkdir(deps.root, { recursive: true })
    await symlink(deps.repositoryRoot, path.join(deps.root, 'user-link'), 'dir')
    await expect(
      new CheckSlots({ ...deps, run }).run({ ...job, cwd: path.join(deps.root, 'user-link') }),
    ).rejects.toThrow()
    await expect(
      new CheckSlots({ ...deps, run, root: path.join(deps.repositoryRoot, '..cache') }).run(job),
    ).rejects.toThrow()
  })
  it('refuses late trust loss and cancellation before starting another child', async () => {
    const { deps, job } = await fixture()
    let isTrusted = true
    const run = vi.fn<CheckProcess>(async (request) => {
      const result = await processRun(request)
      isTrusted = false
      return result
    })
    await expect(
      new CheckSlots({ ...deps, run, isTrusted: () => isTrusted }).run(job),
    ).rejects.toThrow()
    expect(run).toHaveBeenCalledTimes(1)
    const canceled = new AbortController()
    canceled.abort()
    const unused = vi.fn(processRun)
    await expect(
      new CheckSlots({ ...deps, run: unused }).run({ ...job, signal: canceled.signal }),
    ).rejects.toThrow()
    expect(unused).not.toHaveBeenCalled()
  })
  it('does not run checks after a failed install and strips credentials from every child', async () => {
    const { deps, job } = await fixture()
    const run = vi.fn(processRun)
    const slots = new CheckSlots({
      ...deps,
      run,
      setupCommand: "console.log('setup diagnostic');process.exit(7)",
    })
    expect(await slots.run(job)).toMatchObject({ exitCode: 7, output: 'setup diagnostic\n' })
    expect(run.mock.calls.some(([request]) => request.args.includes(job.command))).toBe(false)
    for (const [request] of run.mock.calls) expect(request.env).not.toHaveProperty('VENDOR_API_KEY')
    expect(slots.states()[0]?.busy).toBe(false)
  })
})
