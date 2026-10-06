import { gunzipSync } from 'node:zlib'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import * as z from 'zod/mini'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { fill } from '../../src/shared/l10n/text'
import { isMissingPath } from '../../src/host/canonicalPath'
import { SshRunner, runnerSshArgs, type SshRunnerDeps } from '../../src/host/runners/sshRunner'
import { runnerTestProcess as runProcess, runnerTestGit as git } from './helpers/runnerProcesses'
import { fixtureGitEnvironment } from './helpers/fixtureGit'
import type { CheckProcess } from '../../src/host/team/checkSlots'
import type { Runner } from '../../src/shared/team'
import type { CheckJob } from '../../src/core/runners/routing'
import {
  GIT_PATH_MAX_DEFAULT,
  TEAM_SCHED_ID_MAX_CHARS,
  GIT_OUTPUT_MAX_BYTES,
  RUNNER_CONNECT_TIMEOUT_MS,
  RUNNER_SELFTEST_TIMEOUT_MS,
  UI_TEXT,
} from '../../src/shared/constants'

const execute = promisify(execFile)
const folders: string[] = []
const unprovedTransport: CheckProcess = (request) =>
  Promise.resolve({
    exitCode: 0,
    output: (request.args.at(-1) ?? '').includes("'health'")
      ? '{"cores":1,"load":0,"freeSlots":1,"inputReady":true}'
      : '',
    descendantsEnded: !request.args.includes('-v'),
  })
function outputTransport(gitFile: string, runId: string, frames: readonly Buffer[]): CheckProcess {
  let polls = 0
  return (request) => {
    const command = request.args.at(-1) ?? ''
    let text = request.file === gitFile ? 'a'.repeat(40) : ''
    if (command.includes("'start'")) text = JSON.stringify({ runId, state: 'running' })
    else if (command.includes("'status'"))
      text = JSON.stringify({
        runId,
        state: polls === frames.length - 1 ? 'ended' : 'running',
        ...(polls === frames.length - 1 && { exitCode: 0 }),
      })
    else if (command.includes("'output'")) {
      const frame = frames[polls]
      if (frame === undefined) throw new Error('unexpected output poll')
      text = JSON.stringify({ bytes: frame.toString('base64') })
      polls += 1
    }
    return Promise.resolve({ exitCode: 0, output: text, descendantsEnded: true })
  }
}
async function fixture(): Promise<{
  deps: SshRunnerDeps
  runner: Runner
  job: CheckJob
  folder: string
}> {
  await mkdir(path.join(process.cwd(), 'temp'), { recursive: true })
  const folder = await mkdtemp(path.join(process.cwd(), 'temp', 'm96-ssh-'))
  folders.push(folder)
  const worker = path.join(folder, 'copy')
  await mkdir(worker)
  await git(worker, 'init')
  await writeFile(path.join(worker, 'tracked.txt'), 'base')
  await writeFile(path.join(worker, 'package-lock.json'), 'lock-1')
  await git(worker, 'add', '.')
  await git(
    worker,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@localhost',
    'commit',
    '-m',
    'base',
  )
  await writeFile(path.join(worker, 'tracked.txt'), 'working-edit')
  await writeFile(path.join(worker, 'untracked.txt'), 'untracked')
  // Fake SSH cannot connect anywhere; this rewrite would change its recorded destination.
  await git(worker, 'config', 'url.ssh://unwanted.invalid/.insteadOf', 'fake-rig:')
  const ssh = path.join(folder, 'fake-ssh.mjs')
  await writeFile(
    ssh,
    String.raw`#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const args=process.argv.slice(2);
appendFileSync(${JSON.stringify(path.join(folder, 'ssh-args'))},JSON.stringify({args,environmentNames:Object.keys(process.env)})+'\n');
if(args.includes('-G')) process.exit(0);
const command=args.at(-1);
if(command.includes("'status'") && command.includes("'drop-run'")) process.exit(255);
const child=spawn('/bin/bash',['-c',command],{stdio:'inherit',env:{...process.env,VENDOR_API_KEY:'remote-fixture-only',GH_TOKEN:'remote-fixture-only',mIxEd_ApI_kEy:'remote-fixture-only',gH_tOkEn:'remote-fixture-only'}});
child.on('exit',code=>process.exit(code??1));
`,
  )
  await chmod(ssh, 0o700)
  const runner: Runner = {
    id: 'fake',
    destination: 'fake-rig',
    os: 'darwin',
    workFolder: path.join(folder, 'remote'),
    maxJobs: 1,
    labels: [],
    commandClasses: ['tests'],
    setupCommand: `mkdir -p node_modules; printf seed > node_modules/value; printf x >> '${folder}/setups'`,
    cacheKey: 'npm',
    environmentNames: ['BUILD_MODE'],
  }
  const deps: SshRunnerDeps = {
    ssh,
    file: 'git',
    run: runProcess,
    env: fixtureGitEnvironment({
      ...process.env,
      VENDOR_API_KEY: 'fixture-only',
      GH_TOKEN: 'fixture-only',
      BUILD_MODE: 'fast',
    }),
    helperFolder: path.join(process.cwd(), 'native', 'runner'),
    scratch: path.join(folder, 'scratch'),
    isTrusted: () => true,
    assertWorkingCopy: () => Promise.resolve(),
    now: Date.now,
    wait: () => delay(20),
  }
  const job: CheckJob = {
    runId: 'first-run',
    cwd: worker,
    command: String.raw`printf '  '; cat tracked.txt; printf ' '; cat untracked.txt; printf '\n'; printf '%s' "$BUILD_MODE"`,
    commandClass: 'tests',
    timeoutMs: 10_000,
    labels: [],
    preferredRunners: [],
    lockfiles: ['package-lock.json'],
    signal: new AbortController().signal,
    onOutput: vi.fn(),
  }
  return { deps, runner, job, folder }
}
async function helper(runner: Runner): Promise<string> {
  const files = await readdir(runner.workFolder)
  const name = files.find((file) => file.startsWith('helper-') && file.endsWith('.sh'))
  if (name === undefined) throw new Error('missing helper')
  return path.join(runner.workFolder, name)
}
function windowsRunner(runner: Runner): Runner {
  return { ...runner, os: 'win32', workFolder: String.raw`C:\rig` }
}
function windowsScript(request: Parameters<CheckProcess>[0]): string {
  const encoded = /-EncodedCommand ([A-Za-z0-9+/=]+)/u.exec(request.args.at(-1) ?? '')?.[1]
  return encoded === undefined ? '' : Buffer.from(encoded, 'base64').toString('utf16le')
}
async function awaitFixtureExit(marker: string, deadline: number): Promise<void> {
  for (;;) {
    try {
      await readFile(marker)
      return
    } catch (error: unknown) {
      if (!isMissingPath(error)) throw error
      if (Date.now() >= deadline)
        throw new Error('Fixture job did not retire; preserving its folder', { cause: error })
      await delay(100)
    }
  }
}
async function cleanupFolders(owned: readonly string[]) {
  for (const folder of owned) {
    const runs = path.join(folder, 'remote', 'runs')
    let names: string[]
    try {
      names = await readdir(runs)
    } catch (error: unknown) {
      if (!isMissingPath(error)) throw error
      names = []
    }
    // A deliberately broken assertion must still release this fixture's barrier job.
    for (const name of names) await writeFile(path.join(runs, name, 'release'), '')
    const deadline = Date.now() + 10_000
    for (const name of names) await awaitFixtureExit(path.join(runs, name, 'exit.json'), deadline)
    await rm(folder, { recursive: true, force: true })
  }
}
afterEach(() => cleanupFolders(folders.splice(0)))
describe('SSH runner over a fake transport and local repositories', () => {
  it('pins every SSH option, including ports, and closes Windows command stdin', () => {
    const runner: Runner = {
      id: 'win',
      destination: 'user@host',
      os: 'win32',
      workFolder: String.raw`C:\rig`,
      maxJobs: 1,
      labels: [],
      commandClasses: ['tests'],
      setupCommand: 'npm ci',
      cacheKey: 'npm',
      environmentNames: [],
      port: 2222,
    }
    expect(runnerSshArgs(runner)).toEqual([
      '-n',
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'ForwardAgent=no',
      '-o',
      `ConnectTimeout=${String(RUNNER_CONNECT_TIMEOUT_MS / 1000)}`,
      '-p',
      '2222',
      'user@host',
    ])
  })
  describe('one remote cache lifecycle (PLAN.md M96 round 3d)', { concurrent: false }, () => {
    let context: Awaited<ReturnType<typeof fixture>>
    let run: SshRunner
    beforeAll(async () => {
      context = await fixture()
      folders.splice(folders.indexOf(context.folder), 1)
      run = new SshRunner(context.deps)
    })
    afterAll(() => cleanupFolders([context.folder]))

    it('pushes working edits and untracked files, streams exact output and reuses setup', async () => {
      const { runner, job, folder } = context
      const health = await run.sample(runner)
      expect(health).toMatchObject({ freeSlots: 1, inputReady: true })
      const first = await run.run(runner, {
        ...job,
        command:
          job.command +
          '\ntest -z "${VENDOR_API_KEY+x}" || exit 9; test -z "${GH_TOKEN+x}" || exit 9; test -z "${mIxEd_ApI_kEy+x}" || exit 9; test -z "${gH_tOkEn+x}" || exit 9; printf mutated > node_modules/value; printf bad > stale',
      })
      expect(first.kind).toBe('finished')
      if (first.kind !== 'finished') throw new Error('run failed')
      expect(first.result.exitCode).toBe(0)
      expect(first.result.output).toContain('  working-edit untracked\nfast')
      expect(
        vi
          .mocked(job.onOutput)
          .mock.calls.map(([text]) => text)
          .join(''),
      ).toBe(first.result.output)
      const second = await run.run(runner, {
        ...job,
        runId: 'second-run',
        command: 'test ! -e stale; test "$(cat node_modules/value)" = seed',
      })
      expect(second.kind).toBe('finished')
      expect(await readFile(path.join(folder, 'setups'), 'utf8')).toBe('x')
    })

    it('changes the cache when the text lockfile changes', async () => {
      const { runner, job, folder } = context
      await writeFile(path.join(job.cwd, 'package-lock.json'), 'lock-1\n')
      expect(await run.run(runner, { ...job, runId: 'third-run' })).toMatchObject({
        kind: 'finished',
      })
      expect(await readFile(path.join(folder, 'setups'), 'utf8')).toBe('xx')
    })

    it('distinguishes raw binary lockfiles and installs only by rename', async () => {
      const { runner, job, folder } = context
      await writeFile(path.join(job.cwd, 'package-lock.json'), Buffer.from([255]))
      expect(await run.run(runner, { ...job, runId: 'binary-first' })).toMatchObject({
        kind: 'finished',
      })
      await writeFile(path.join(job.cwd, 'package-lock.json'), Buffer.from([254]))
      expect(await run.run(runner, { ...job, runId: 'binary-second' })).toMatchObject({
        kind: 'finished',
      })
      expect(await readFile(path.join(folder, 'setups'), 'utf8')).toBe('xxxx')

      const callText = await readFile(path.join(folder, 'ssh-args'), 'utf8')
      const calls = callText
        .split('\n')
        .filter(Boolean)
        .map((line) =>
          z
            .strictObject({ args: z.array(z.string()), environmentNames: z.array(z.string()) })
            .parse(JSON.parse(line)),
        )
      for (const call of calls) {
        expect(call.args).toContain('StrictHostKeyChecking=yes')
        expect(call.args.join(' ')).not.toContain('unwanted.invalid')
        expect(call.environmentNames).not.toContain('VENDOR_API_KEY')
        expect(call.environmentNames).not.toContain('GH_TOKEN')
      }
      expect(calls.some((call) => call.args.at(-1)?.includes(' && mv -f '))).toBe(true)
      expect(
        calls
          .filter(
            (call) =>
              call.args.at(-1)?.includes('helper-') && call.args.at(-1)?.includes("printf '%s'"),
          )
          .every((call) => (call.args.at(-1) ?? '').includes(".new' && mv -f")),
      ).toBe(true)
      expect(
        await git(
          path.join(runner.workFolder, 'repository.git'),
          'show-ref',
          'refs/muse-spark/runs/first-run',
        ),
      ).toMatch(/^[a-f0-9]+ refs/u)
    })
  })
  it('keeps the remote slot after disconnect until an exit marker, rejects late run ids and respects maxJobs across windows', async () => {
    const { deps, runner, job } = await fixture()
    const firstWindow = new SshRunner(deps)
    const started = await firstWindow.run(runner, {
      ...job,
      runId: 'drop-run',
      command: 'while [ ! -f ../release ]; do sleep 0.1; done; printf late',
      timeoutMs: 30_000,
    })
    expect(started).toEqual({ kind: 'uncertain' })
    const secondWindow = new SshRunner(deps)
    expect(await secondWindow.sample(runner)).toMatchObject({ freeSlots: 0 })
    expect(await secondWindow.run(runner, { ...job, runId: 'other-run' })).toEqual({ kind: 'busy' })
    await writeFile(path.join(runner.workFolder, 'runs', 'drop-run', 'release'), '')
    const file = await helper(runner)
    let marker = ''
    for (let index = 0; index < 30; index += 1) {
      const answer = await execute('/bin/bash', [file, 'status', runner.workFolder, 'drop-run'], {
        encoding: 'utf8',
      })
      marker = answer.stdout
      if (marker.includes('ended')) break
      await delay(100)
    }
    expect(JSON.parse(marker)).toMatchObject({ state: 'ended', runId: 'drop-run' })
    expect(await secondWindow.sample(runner)).toMatchObject({ freeSlots: 1 })
    const stale = new SshRunner({
      ...deps,
      run: (request) =>
        request.file === deps.ssh && request.args.at(-1)?.includes("'status'")
          ? Promise.resolve({
              exitCode: 0,
              output: JSON.stringify({ runId: 'old-run', state: 'ended', exitCode: 0 }),
              descendantsEnded: true,
            })
          : runProcess(request),
    })
    await expect(stale.end(runner, file, 'drop-run')).rejects.toThrow()
  })
  it('falls back on a cache creator without hiding a check exit code of 75', async () => {
    const { deps, runner, job } = await fixture()
    const run = new SshRunner(deps)
    await run.sample(runner)
    const hash = createHash('sha256')
      .update(runner.cacheKey)
      .update('\0')
      .update(runner.setupCommand)
      .digest('hex')
    const lock = path.join(runner.workFolder, 'cache', `${hash}.creating`)
    await mkdir(lock)
    expect(await run.run(runner, { ...job, lockfiles: [] })).toEqual({ kind: 'busy' })
    await rm(lock, { recursive: true })
    expect(
      await run.run(runner, { ...job, runId: 'exit-75', lockfiles: [], command: 'exit 75' }),
    ).toMatchObject({ kind: 'finished', result: { exitCode: 75 } })
  })
  it('releases the owned cache creation lease after a setup timeout and permits retry', async () => {
    const { deps, runner, job, folder } = await fixture()
    const slow: Runner = {
      ...runner,
      setupCommand: `if [ ! -f '${folder}/setup-retry' ]; then touch '${folder}/setup-retry'; sleep 3; fi; mkdir -p node_modules; printf seed > node_modules/value`,
    }
    const owners: string[] = []
    const run: CheckProcess = async (request) => {
      const result = await runProcess(request)
      if ((request.args.at(-1) ?? '').includes("'status'")) {
        const names = await readdir(path.join(runner.workFolder, 'cache'))
        for (const name of names) {
          if (!name.endsWith('.creating')) continue
          try {
            owners.push(
              await readFile(path.join(runner.workFolder, 'cache', name, 'owner'), 'utf8'),
            )
          } catch (error: unknown) {
            if (!isMissingPath(error)) throw error
          }
        }
      }
      return result
    }
    const host = new SshRunner({ ...deps, run })
    expect(await host.run(slow, { ...job, timeoutMs: 1000 })).toMatchObject({
      kind: 'finished',
      result: { exitCode: 124 },
    })
    expect(owners.some((owner) => new RegExp(`^${job.runId} [0-9]+$`, 'u').test(owner))).toBe(true)
    const remaining = await readdir(path.join(runner.workFolder, 'cache'))
    expect(remaining.some((name) => name.endsWith('.creating'))).toBe(false)
    expect(await host.run(slow, { ...job, runId: 'retry-setup' })).toMatchObject({
      kind: 'finished',
      result: { exitCode: 0 },
    })
  })
  it('retains a cache lease whose recorded owner differs from the retired job', async () => {
    const { deps, runner, job } = await fixture()
    const setupCommand =
      runner.setupCommand +
      `; for owner in '${runner.workFolder}'/cache/*.creating/owner; do printf 'another-run 9999999999' > "$owner"; done`
    expect(await new SshRunner(deps).run({ ...runner, setupCommand }, job)).toMatchObject({
      kind: 'finished',
      result: { exitCode: 0 },
    })
    const caches = await readdir(path.join(runner.workFolder, 'cache'))
    const name = caches.find((entry) => entry.endsWith('.creating'))
    expect(name).toBeDefined()
    if (name === undefined) throw new Error('foreign lease was removed')
    expect(await readFile(path.join(runner.workFolder, 'cache', name, 'owner'), 'utf8')).toBe(
      'another-run 9999999999',
    )
  })
  it('rejects raw output rewrites even when the decoded text stays identical', async () => {
    const { deps, runner, job } = await fixture()
    const output = vi.fn<(text: string) => void>()
    const run = outputTransport(deps.file, job.runId, [Buffer.from([255]), Buffer.from([254])])
    expect(
      await new SshRunner({ ...deps, run, wait: () => Promise.resolve() }).run(runner, {
        ...job,
        onOutput: output,
      }),
    ).toEqual({ kind: 'uncertain' })
    expect(output).toHaveBeenCalledExactlyOnceWith('�')
  })
  it('preserves a UTF-8 BOM and flushes incomplete final bytes only on retirement', async () => {
    const { deps, runner, job } = await fixture()
    const output = vi.fn<(text: string) => void>()
    const run = outputTransport(deps.file, job.runId, [
      Buffer.from([239, 187]),
      Buffer.from([239, 187, 191, 195]),
    ])
    expect(
      await new SshRunner({ ...deps, run, wait: () => Promise.resolve() }).run(runner, {
        ...job,
        onOutput: output,
      }),
    ).toMatchObject({ kind: 'finished', result: { output: '\u{FEFF}�', exitCode: 0 } })
    expect(output).toHaveBeenCalledExactlyOnceWith('\u{FEFF}�')
  })
  it('checks raw output prefixes and decodes split UTF-8 exactly once', async () => {
    const { deps, runner, job } = await fixture()
    let hasPartial = false
    const run: CheckProcess = async (request) => {
      const result = await runProcess(request)
      if ((request.args.at(-1) ?? '').includes("'output'")) {
        const value: unknown = JSON.parse(result.output)
        const bytes = Buffer.from(
          z.strictObject({ bytes: z.string() }).parse(value).bytes,
          'base64',
        )
        if (bytes.at(-1) === 195) hasPartial = true
      }
      return result
    }
    const streamed = vi.fn<(text: string) => void>()
    const answer = await new SshRunner({ ...deps, run }).run(runner, {
      ...job,
      command: String.raw`printf '\303'; sleep 1; printf '\251'; printf '\360'; sleep 1; printf '\237\230\200'`,
      onOutput: streamed,
    })
    expect(hasPartial).toBe(true)
    expect(answer).toMatchObject({ kind: 'finished', result: { exitCode: 0 } })
    if (answer.kind !== 'finished') throw new Error('split output did not finish')
    expect(answer.result.output).toMatch(/é😀$/u)
    expect(streamed.mock.calls.map(([value]) => value).join('')).toBe(answer.result.output)
    expect(answer.result.output).not.toContain('�')
  })
  it('ends the remote process group at timeout and writes the marker only afterwards', async () => {
    const { deps, runner, job } = await fixture()
    const answer = await new SshRunner(deps).run(runner, {
      ...job,
      command: 'sleep 2; printf escaped > canary',
      timeoutMs: 1000,
    })
    expect(answer).toMatchObject({ kind: 'finished', result: { exitCode: 124 } })
    await delay(1200)
    const copy = path.join(runner.workFolder, 'runs', job.runId, 'copy')
    await expect(readFile(path.join(copy, 'canary'))).rejects.toThrow()
  })
  it('refuses duplicate active run ids before another dispatch', async () => {
    const { deps, runner, job } = await fixture()
    const waiting = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    let isFirst = true
    const run: CheckProcess = async () => {
      if (isFirst) {
        isFirst = false
        entered.resolve(undefined)
        await waiting.promise
      }
      throw new Error('fake offline')
    }
    const host = new SshRunner({ ...deps, run })
    const first = host.run(runner, job)
    await entered.promise
    try {
      await expect(host.run(runner, job)).rejects.toThrow()
    } finally {
      waiting.resolve(undefined)
    }
    expect(await first).toEqual({ kind: 'offline' })
  })
  it('refuses unsafe runner config, trust loss and working-copy admission, and reports offline instead of hanging', async () => {
    const { deps, runner, job } = await fixture()
    const dispatch = vi.fn(runProcess)
    await expect(
      new SshRunner({ ...deps, run: dispatch, isTrusted: () => false }).run(runner, job),
    ).rejects.toThrow()
    await expect(
      new SshRunner({
        ...deps,
        run: dispatch,
        assertWorkingCopy: () => Promise.reject(new Error('user checkout')),
      }).run(runner, job),
    ).rejects.toThrow()
    expect(dispatch).not.toHaveBeenCalled()
    expect(
      await new SshRunner({ ...deps, run: () => Promise.reject(new Error('offline')) }).run(
        runner,
        job,
      ),
    ).toEqual({ kind: 'offline' })
    await expect(
      new SshRunner(deps).run({ ...runner, destination: '-oProxyCommand=evil' }, job),
    ).rejects.toThrow()
    await expect(new SshRunner(deps).run(runner, { ...job, runId: '../escape' })).rejects.toThrow()
    await expect(
      new SshRunner(deps).run(runner, { ...job, runId: 'a'.repeat(TEAM_SCHED_ID_MAX_CHARS + 1) }),
    ).rejects.toThrow()
  })
  it('rejects uncertain local children and malformed, late or regressed remote streams', async () => {
    const { deps, runner, job } = await fixture()
    for (const mode of [
      'oversized',
      'regressed',
      'late',
      'extra',
      'missing',
      'lateStart',
      'transportProof',
      'cloneProof',
      'pushProof',
      'blobProof',
    ]) {
      let outputReads = 0
      let time = 0
      const output = vi.fn()
      const run: CheckProcess = (request) => {
        const command = request.args.at(-1) ?? ''
        let text = ''
        if (request.file === deps.file) text = 'a'.repeat(40)
        else if (command.includes("'start'"))
          text = JSON.stringify({
            runId: mode === 'lateStart' ? 'old' : job.runId,
            state: 'running',
          })
        else if (command.includes("'status'")) {
          const ordinary = mode === 'regressed' ? 'running' : 'ended'
          const state = mode === 'missing' ? 'missing' : ordinary
          text = JSON.stringify({
            runId: mode === 'late' ? 'old' : job.runId,
            state,
            ...(!(mode === 'regressed' || mode === 'missing') && { exitCode: 0 }),
            ...(mode === 'extra' && { unknown: true }),
          })
        } else if (command.includes("'output'")) {
          outputReads += 1
          const ordinary = outputReads === 1 ? 'first' : 'different'
          text = JSON.stringify({
            bytes: Buffer.from(
              mode === 'oversized' ? 'x'.repeat(GIT_OUTPUT_MAX_BYTES + 1) : ordinary,
            ).toString('base64'),
          })
        }
        const hasProof =
          !(mode === 'transportProof' && request.file === deps.ssh) &&
          !(mode === 'cloneProof' && request.args.includes('clone')) &&
          !(mode === 'pushProof' && request.args.includes('push')) &&
          !(
            mode === 'blobProof' &&
            request.args.includes('rev-parse') &&
            (request.args.at(-1) ?? '').includes(':')
          )
        return Promise.resolve({ exitCode: 0, output: text, descendantsEnded: hasProof })
      }
      const answer = await new SshRunner({
        ...deps,
        run,
        now: () => time,
        wait: () => {
          time += 1000
          return Promise.resolve()
        },
      }).run(runner, { ...job, onOutput: output })
      expect(answer).toEqual({ kind: mode.endsWith('Proof') ? 'offline' : 'uncertain' })
      if (mode === 'regressed') expect(output).toHaveBeenCalledExactlyOnceWith('first')
      else if (mode !== 'missing') expect(output).not.toHaveBeenCalled()
    }
  })
  it('shows only the public host fingerprint and rejects a Windows shell waiting on input', async () => {
    const { deps, runner } = await fixture()
    const fingerprint = 'SHA256:fixturePublicHash'
    const failed = new SshRunner({
      ...deps,
      run: () =>
        Promise.resolve({
          exitCode: 255,
          output: '',
          stderr: `host key ${fingerprint}; private-profile-path`,
          descendantsEnded: true,
        }),
    })
    expect(await failed.test(runner)).toEqual({
      ok: false,
      fingerprint,
      notice: fill(UI_TEXT.teamRunners.hostKeyNotice, { fingerprint }),
    })
    expect(await new SshRunner({ ...deps, run: unprovedTransport }).test(runner)).toEqual({
      ok: false,
      notice: UI_TEXT.teamRunners.testFailed,
    })
    const run = vi.fn<CheckProcess>(() => Promise.reject(new Error('input timeout')))
    expect(await new SshRunner({ ...deps, run }).test(windowsRunner(runner))).toEqual({
      ok: false,
      notice: UI_TEXT.teamRunners.inputHangNotice,
    })
    const request = run.mock.calls[0]?.[0]
    expect(request).toMatchObject({ timeoutMs: RUNNER_SELFTEST_TIMEOUT_MS })
    expect(request?.args.at(-1)).toContain('-NonInteractive -InputFormat None -EncodedCommand')
    expect(request?.args.at(-1)).toContain('< NUL')
    expect(request?.args).toContain('-n')
  })
  it('tests the actual detached Windows launcher and rejects an input-hung self-test', async () => {
    const { deps, runner } = await fixture()
    const run = vi.fn<CheckProcess>((request) => {
      const script = windowsScript(request)
      const health = script.includes("'health'")
        ? '{"cores":1,"load":0,"freeSlots":1,"inputReady":true}'
        : ''
      const output = script.includes("'selftest'") ? '{"inputReady":false}' : health
      return Promise.resolve({ exitCode: 0, output, descendantsEnded: true })
    })
    expect(
      await new SshRunner({ ...deps, run }).test({
        ...windowsRunner(runner),
        workFolder: ('C:/' + 'runner/'.repeat(GIT_PATH_MAX_DEFAULT)).slice(0, GIT_PATH_MAX_DEFAULT),
      }),
    ).toEqual({
      ok: false,
      notice: UI_TEXT.teamRunners.inputHangNotice,
    })
    expect(
      run.mock.calls.some(([request]) => {
        return windowsScript(request).includes("'selftest'")
      }),
    ).toBe(true)
    // Win32's immutable CreateProcess command-line limit.
    for (const [request] of run.mock.calls) expect(request.args.at(-1)?.length).toBeLessThan(32_767)
    const upload = run.mock.calls
      .map(([request]) => windowsScript(request))
      .find((script) => script.includes('GZipStream'))
    if (upload === undefined) throw new Error('missing compressed helper upload')
    const payload = /FromBase64String\('([A-Za-z0-9+/=]+)'\)/u.exec(upload)?.[1]
    if (payload === undefined) throw new Error('missing compressed helper bytes')
    expect(gunzipSync(Buffer.from(payload, 'base64'))).toEqual(
      await readFile(path.join(deps.helperFolder, 'runner-helper.ps1')),
    )
  })
  it('refuses oversized accepted Windows starts with a translated reason before dispatch', async () => {
    const { deps, runner, job } = await fixture()
    const run = vi.fn<CheckProcess>((request) => {
      const script = windowsScript(request)
      let output = request.file === deps.file ? 'a'.repeat(40) : ''
      if (script.includes("'start'"))
        output = JSON.stringify({ runId: job.runId, state: 'running' })
      if (script.includes("'status'"))
        output = JSON.stringify({ runId: job.runId, state: 'ended', exitCode: 0 })
      if (script.includes("'output'")) output = JSON.stringify({ bytes: '' })
      return Promise.resolve({ exitCode: 0, output, descendantsEnded: true })
    })
    const long = {
      ...windowsRunner(runner),
      workFolder: 'C:/' + 'r'.repeat(176),
      setupCommand: 's'.repeat(8000),
      environmentNames: [],
    }
    await expect(
      new SshRunner({ ...deps, run }).run(long, { ...job, command: 'c'.repeat(1000) }),
    ).rejects.toThrow(UI_TEXT.teamRunners.commandTooLong)
    expect(run.mock.calls.some(([request]) => windowsScript(request).includes("'start'"))).toBe(
      false,
    )
    for (const [request] of run.mock.calls)
      if (request.file === deps.ssh) expect(request.args.at(-1)?.length).toBeLessThan(32_767)
    run.mockClear()
    expect(await new SshRunner({ ...deps, run }).run(windowsRunner(runner), job)).toMatchObject({
      kind: 'finished',
    })
    expect(run.mock.calls.some(([request]) => windowsScript(request).includes("'start'"))).toBe(
      true,
    )
  })
  it('includes the local Windows SSH executable and quoted arguments in the launch bound', async () => {
    const { deps, runner, job } = await fixture()
    const run = vi.fn<CheckProcess>(() =>
      Promise.resolve({ exitCode: 0, output: '', descendantsEnded: true }),
    )
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    try {
      await expect(
        new SshRunner({ ...deps, run, ssh: 's'.repeat(32_767) }).run(windowsRunner(runner), job),
      ).rejects.toThrow(UI_TEXT.teamRunners.commandTooLong)
      expect(run).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('translates a native Windows command-length refusal without treating it as retirement', async () => {
    const { deps, runner, job } = await fixture()
    const run: CheckProcess = (request) => {
      let output = ''
      if (request.file === deps.file) output = 'a'.repeat(40)
      else if (windowsScript(request).includes("'start'"))
        output = JSON.stringify({ runId: job.runId, state: 'refused', reason: 'commandTooLong' })
      return Promise.resolve({ exitCode: 0, descendantsEnded: true, output })
    }
    await expect(new SshRunner({ ...deps, run }).run(windowsRunner(runner), job)).rejects.toThrow(
      UI_TEXT.teamRunners.commandTooLong,
    )
  })
  it('separates Windows job initialization from the execute arguments assignment', async () => {
    const text = await readFile(
      path.join(process.cwd(), 'native', 'runner', 'runner-helper.ps1'),
      'utf8',
    )
    expect(text).toMatch(/Initialize-RunnerJob\r?\n\s+\$arguments=@\('execute'/u)
  })
  it('keeps the Windows helper slot, job and exit-marker guards explicit for Windows certification', async () => {
    const text = await readFile(
      path.join(process.cwd(), 'native', 'runner', 'runner-helper.ps1'),
      'utf8',
    )
    expect(text).toContain('try { $owner = [IO.File]::Open($allocation, [IO.FileMode]::CreateNew')
    expect(text).toContain('$claim = [IO.File]::Open($file, [IO.FileMode]::CreateNew')
    expect(text).toContain(
      "$creation=[IO.File]::Open(($cache+'.creating'),[IO.FileMode]::CreateNew",
    )
    expect(text).toContain('Remove-CacheLock (Join-Path (Join-Path $Root')
    expect(text).toContain("$RunId+' '+$expires")
    expect(text).toContain('[IO.FileShare]::ReadWrite')
    expect(text).toContain(".StartsWith($Id+' ')")
    expect(text.match(/command.Length>=32767/gu)).toHaveLength(2)
    expect(text).toContain(
      "if ($line.Length -ge 32767) { Write-Protocol @{runId=$RunId;state='refused';reason='commandTooLong'}; break }",
    )
    expect(text).toContain('0x01000000|0x8|0x200|0x4000')
    expect(text).toContain('start.input=Inherit(input)')
    expect(text).toContain('UpdateProcThreadAttribute(attributes,0,new IntPtr(0x20002),handles')
    expect(text).toContain('|0x80000')
    expect(text).toContain('ref extended,out child')
    expect(text).toContain('[Text.UTF8Encoding]::new($true)')
    expect(text).toContain('0x4|0x4000')
    expect(text).toContain('limits.basic.flags=0x2000')
    expect(text).toContain('AssignProcessToJobObject(job,child.process)')
    expect(text).toContain('if(count.active==0) break')
    expect(text).toContain("Move-Item -LiteralPath (Join-Path $run 'exit.new')")
  })
})
