import * as childProcess from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as admission from '../../src/core/resources/admission'
import { spawnResourceProcess } from '../../src/core/resources/process'
import { spawnAttestedJob, type JobAttestationLimits } from '../../src/host/backend/mcpJobLaunch'
import { RESOURCE_JOB_RECORD_WAIT_MS } from '../../src/shared/constants'
import { fixtureJobLifecycle } from './helpers/mcpFixtures'
import { fakeResourceLease } from './helpers/resources/fakes'
import { removeFolder } from './helpers/temporaryFolders'

vi.mock('../../src/core/resources/admission', { spy: true })
vi.mock('node:child_process', { spy: true })

const job = fixtureJobLifecycle()
const scratch = { folder: '' }
// Compiling the real launcher once covers compilation and self-test, not test execution.
beforeAll(async () => {
  await job.setup()
  scratch.folder = await mkdtemp(path.join(tmpdir(), 'l-SPAWN017C-attest-'))
}, 60_000)
afterAll(async () => {
  await job.dispose()
  if (scratch.folder !== '') await removeFolder(scratch.folder)
})

const env = { SystemRoot: process.env['SystemRoot'] ?? '' }
const limits: JobAttestationLimits = {
  activeProcessLimit: 16,
  spawnLimit: 16,
  spawnWindowMs: 15_000,
  sampleMs: 50,
  emptyTimeoutMs: 5000,
}
function executable(): string {
  if (job.path === undefined) throw new Error('Launcher fixture missing')
  return job.path
}
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
/** A payload that starts a detached grandchild meant to outlive everything, prints READY, then `then`. */
function grandchildScript(marker: string, then: string): string {
  return String.raw`const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(marker)},String(c.pid));process.stdout.write('READY\n',()=>{${then}})`
}
/** The payload's stdout is the helper's: READY arrives after the marker is written. */
async function ready(child: childProcess.ChildProcess): Promise<void> {
  const [text] = await once(child.stdout ?? child, 'data')
  expect(String(text)).toContain('READY')
}
function end(child: childProcess.ChildProcess): void {
  if (child.exitCode === null && child.signalCode === null) child.kill()
}
function lease() {
  const fake = { ...fakeResourceLease(), failed: vi.fn(), settle: vi.fn() }
  vi.mocked(admission.admitResource).mockResolvedValue(fake)
  vi.mocked(admission.resourceWindowsJob).mockResolvedValue({
    executablePath: executable(),
    assemblyPath: path.join(scratch.folder, 'unused-reader.dll'),
  })
  return fake
}
const marker = (name: string) => path.join(scratch.folder, `${name}-${String(Date.now())}`)

describe.runIf(process.platform === 'win32')('attested Windows job (SPAWN017C)', () => {
  it('ends a grandchild that tries to outlive its root, before the helper exits', async () => {
    const fake = lease()
    const spawn = vi.mocked(childProcess.spawn)
    spawn.mockClear()
    const file = marker('grandchild')
    const { child } = await spawnResourceProcess(
      'contained',
      process.execPath,
      ['-e', grandchildScript(file, 'process.exit(0)')],
      { env },
    )
    child.stdin.end()
    child.stdout.resume()
    await once(child, 'exit')
    const grandchild = Number(await readFile(file, 'utf8'))
    // The helper drained the job to zero active processes before it exited.
    expect(isAlive(grandchild)).toBe(false)
    await vi.waitFor(() => {
      expect(fake.complete).toHaveBeenCalledWith(true)
    })
    expect(fake.register).toHaveBeenCalledWith(
      expect.objectContaining({ attested: true, profile: 'contained' }),
    )
    expect(fake.settle).toHaveBeenCalledWith({
      root: { pid: expect.any(Number), startTime: expect.stringMatching(/^\d+$/u) },
      scope: expect.stringMatching(/^attested-\d+-\d+$/u),
      usage: { cpuSeconds: expect.any(Number), residentBytes: expect.any(Number) },
    })
    expect(fake.failed).not.toHaveBeenCalled()
    // One launcher process; no reader process (PowerShell) for this launch.
    expect(spawn.mock.calls.map((call) => call[0])).toEqual([executable()])
  })

  it('lets the kernel end the tree when the helper itself is killed; usage is uncertain', async () => {
    const fake = lease()
    const file = marker('killed')
    const { child, pid } = await spawnResourceProcess(
      'contained',
      process.execPath,
      ['-e', grandchildScript(file, 'setInterval(()=>{},1000)')],
      { env },
    )
    try {
      child.stdin.end()
      await ready(child)
      expect(await pid()).toEqual(expect.any(Number))
      const grandchild = Number(await readFile(file, 'utf8'))
      const exited = once(child, 'exit')
      child.kill()
      await exited
      // Closing the helper's only job handle ends the job (termination is asynchronous).
      await vi.waitFor(() => {
        expect(isAlive(grandchild)).toBe(false)
      })
    } finally {
      end(child)
    }
    // Without a record, settling waits for the record bound, then reports usage uncertain.
    await vi.waitFor(
      () => {
        expect(fake.complete).toHaveBeenCalledWith(true)
      },
      { timeout: RESOURCE_JOB_RECORD_WAIT_MS * 2 },
    )
    // No record: settled with usage null (uncertain), never refused.
    expect(fake.settle).toHaveBeenCalledWith(expect.objectContaining({ usage: null }))
  })

  it('stops the whole job on STOP and reports it as stopped', async () => {
    const file = marker('stop')
    const { child, control } = spawnAttestedJob({
      executablePath: executable(),
      file: process.execPath,
      args: ['-e', grandchildScript(file, 'setInterval(()=>{},1000)')],
      cwd: process.cwd(),
      env,
      isVerbatim: false,
      log: () => undefined,
      attestation: limits,
    })
    try {
      child.stdin.end()
      await ready(child)
      expect(await control.root).toEqual({
        pid: expect.any(Number),
        startTime: expect.any(String),
      })
      const grandchild = Number(await readFile(file, 'utf8'))
      const exited = once(child, 'exit')
      control.stop()
      const [code] = await exited
      expect(code).toBe(5)
      expect(isAlive(grandchild)).toBe(false)
      expect(await control.record).toMatchObject({
        ending: 'stopped',
        emptied: true,
        exitCode: 5,
      })
    } finally {
      end(child)
    }
  })

  it('enforces the process cap through the job object, not by polling', async () => {
    const file = marker('cap')
    // Root plus one child fill a cap of two; the third process is refused by the kernel.
    const script = `const cp=require('node:child_process');const a=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});a.once('spawn',()=>{const w=(t)=>{require('node:fs').writeFileSync(${JSON.stringify(file)},t);process.exit(0)};try{const b=cp.spawn(process.execPath,['-e','0'],{stdio:'ignore'});b.once('error',(e)=>w('refused:'+e.code));b.once('spawn',()=>w('started'))}catch(e){w('refused:'+e.code)}})`
    const { child, control } = spawnAttestedJob({
      executablePath: executable(),
      file: process.execPath,
      args: ['-e', script],
      cwd: process.cwd(),
      env,
      isVerbatim: false,
      log: () => undefined,
      attestation: { ...limits, activeProcessLimit: 2 },
    })
    child.stdin.end()
    await once(child, 'exit')
    expect(await readFile(file, 'utf8')).toMatch(/^refused:/u)
    expect(await control.record).toMatchObject({
      ending: 'exit',
      emptied: true,
      activeProcessLimit: 2,
    })
  })

  it('ends a job whose spawn rate exceeds its limit and says so in the record', async () => {
    const script = `const cp=require('node:child_process');for(let i=0;i<5;i++)cp.spawn(process.execPath,['-e','0'],{stdio:'ignore'});setInterval(()=>{},1000)`
    const { child, control } = spawnAttestedJob({
      executablePath: executable(),
      file: process.execPath,
      args: ['-e', script],
      cwd: process.cwd(),
      env,
      isVerbatim: false,
      log: () => undefined,
      attestation: { ...limits, spawnLimit: 3 },
    })
    child.stdin.end()
    const [code] = await once(child, 'exit')
    expect(code).toBe(6)
    const record = await control.record
    expect(record).toMatchObject({ ending: 'spawnRate', emptied: true })
    expect(record?.totalProcesses).toBeGreaterThan(3)
    expect(record?.cpuMs).toBeGreaterThanOrEqual(0)
  })
})
