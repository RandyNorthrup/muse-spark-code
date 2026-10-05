import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'
import * as z from 'zod/mini'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { jobSourceReader } from '../../src/host/backend/jobSource'
import { createNativeOrphanDriver, createOrphanRecovery } from '../../src/host/team/orphanRecovery'
import {
  createNativeTeamProcessDriver,
  createTeamProcessLifetime,
  startNativeTeamLifetime,
  startTeamMuseCodeHost,
  type TeamProcessDriver,
} from '../../src/host/team/processLifetime'
import { createTeamJournal } from '../../src/host/team/teamJournal'
import { createWindowAuthority, createWindowIdentity } from '../../src/host/team/windowIdentity'

const directories: string[] = []
const stops: (() => Promise<unknown>)[] = []
const native: { driver: TeamProcessDriver | undefined; directory: string } = {
  driver: undefined,
  directory: '',
}
function windowsOptions() {
  return {
    storageDir: native.directory,
    systemRoot: process.env['SystemRoot'] ?? String.raw`C:\Windows`,
    readJobSource: jobSourceReader(process.cwd()),
    log: () => {
      /* Preparation must succeed. */
    },
  }
}
beforeAll(async () => {
  native.directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'm96-driver-')))
  native.driver = await createNativeTeamProcessDriver({
    killGraceMs: 100,
    windows: windowsOptions(),
  })
})
afterAll(async () => {
  await rm(native.directory, { recursive: true, force: true })
})
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop()
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function fixture() {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'm96-native-')))
  directories.push(directory)
  const driver = native.driver
  if (driver === undefined) throw new Error('native driver not prepared')
  const owner = createWindowIdentity(Date.now())
  const journal = createTeamJournal({
    storageDirectory: directory,
    owner,
    authority: createWindowAuthority(owner, () => Promise.reject(new Error('unexpected takeover'))),
    maxRecordBytes: 1024 * 1024,
    platform: process.platform,
  })
  const lifetime = createTeamProcessLifetime({ journal, driver, isHostBusy: () => false })
  stops.push(() => lifetime.dispose())
  const request = (code: string) => ({
    command: process.execPath,
    args: ['-e', code],
    cwd: directory,
    taskId: 'native-task',
    env: { PATH: process.env['PATH'], SystemRoot: process.env['SystemRoot'] },
    priority: 'belowNormal' as const,
  })
  return { directory, lifetime, journal, request }
}

async function until(isReady: () => Promise<boolean>) {
  const deadline = Date.now() + 4000
  while (!(await isReady())) {
    if (Date.now() >= deadline) throw new Error('native observation deadline')
    await delay(10)
  }
}

async function standaloneOwner(directory: string, code: string, env?: NodeJS.ProcessEnv) {
  const launcher = path.join(directory, 'owner.cjs')
  await build({
    stdin: {
      contents: String.raw`const {createNativeTeamProcessDriver}=require('./src/host/team/processLifetime'); const sources=require('./src/host/backend/jobSource'); (async()=>{ const driver=await createNativeTeamProcessDriver({killGraceMs:100,windows:{storageDir:${JSON.stringify(native.directory)},systemRoot:process.env.SystemRoot,readJobSource:sources.jobSourceReader(process.cwd()),log:()=>{}}});const child=driver.launch({command:process.execPath,args:['-e',${JSON.stringify(code)}],cwd:process.cwd(),taskId:'owner',env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH},priority:'belowNormal'},${JSON.stringify(randomUUID())}); await child.confirmation;process.stdout.write("READY\n");setInterval(()=>{},1000) })().catch(error=>{process.stderr.write(String(error));process.exit(1)})`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    outfile: launcher,
    bundle: true,
    platform: 'node',
    format: 'cjs',
  })
  const parent = spawn(process.execPath, [launcher], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(env !== undefined && { env }),
  })
  const parentExited = new Promise<void>((resolve) =>
    parent.once('exit', () => {
      resolve()
    }),
  )
  const parentClosed = new Promise<void>((resolve) =>
    parent.once('close', () => {
      resolve()
    }),
  )
  stops.push(async () => {
    parent.kill()
    await parentClosed
  })
  // A crash fixture must have a confirmed live owner before the observation
  // clock starts. Preparation still runs within Vitest's unchanged deadline.
  await new Promise<void>((resolve, reject) => {
    let status = ''
    let errors = ''
    parent.stderr.on('data', (chunk: Buffer) => {
      errors += chunk.toString('utf8')
    })
    parent.stdout.on('data', (chunk: Buffer) => {
      status += chunk.toString('utf8')
      if (status === 'READY\n') resolve()
    })
    parent.once('error', reject)
    parent.once('exit', () => {
      reject(new Error(`native owner exited before readiness: ${errors}`))
    })
  })
  return { parent, parentExited }
}

describe('M96 K real native lifetime', () => {
  it('starts a separate journalled team Muse Code host over real fake-CLI pipes', async () => {
    const f = await fixture()
    const host = await startTeamMuseCodeHost({
      lifetime: f.lifetime,
      request: {
        ...f.request(''),
        args: [path.join(process.cwd(), 'test/e2e/fake-muse/serve.mjs'), 'serve'],
      },
      extensionVersion: 'test',
      log: {
        trace: () => {
          /* Synthetic protocol trace is not model traffic. */
        },
        info: () => {
          /* Fake host diagnostics are not credentials or model traffic. */
        },
        warn: () => {
          /* Assertions cover host creation. */
        },
        error: () => {
          /* Assertions cover host creation. */
        },
      },
    })
    expect(host.info.kind).toBe('museCode')
    const records = await f.lifetime.recoveryRecords(f.journal)
    expect(records).toHaveLength(1)
    expect(records[0]?.confirmation).toBeDefined()
    await host.close()
  })
  it('preserves the real command exit code through its native container', async () => {
    const f = await fixture()
    const launched = await f.lifetime.launch(f.request('setTimeout(()=>process.exit(7),700)'))
    const exit =
      launched.child.exitCode ??
      (await Promise.race([
        new Promise<number | null>((resolve) => {
          launched.child.once('exit', resolve)
        }),
        delay(2000, null),
      ]))
    expect(exit).toBe(7)
    const end = await launched.ended
    if (process.platform !== 'win32') {
      return
    }

    expect(end).toEqual({ childExited: true, descendants: 'proved' })
    expect(await f.lifetime.recoveryRecords(f.journal)).toEqual([])
  })
  it('reconciles foreign journals before startup returns and preserves all foreign bytes', async () => {
    const f = await fixture()
    const child = await f.lifetime.launch(f.request('setTimeout(()=>{},20000)'))
    const record = path.join(
      f.directory,
      'team',
      'journal',
      f.journal.owner.instanceId,
      `launch-${child.launchId}.json`,
    )
    const original = await readFile(record)
    const broken = path.join(path.dirname(record), 'damaged.json')
    await writeFile(broken, '{broken')
    const owner = createWindowIdentity(Date.now())
    const journal = createTeamJournal({
      storageDirectory: f.directory,
      owner,
      authority: createWindowAuthority(owner, () =>
        Promise.reject(new Error('unexpected takeover')),
      ),
      maxRecordBytes: 1024 * 1024,
      platform: process.platform,
    })
    const started = await startNativeTeamLifetime({
      journal,
      isHostBusy: () => false,
      killGraceMs: 100,
      windows: windowsOptions(),
    })
    stops.push(() => started.lifetime.dispose())
    expect(started.records.map((row) => row.id)).toEqual([child.launchId])
    expect(started.unreadable).toEqual([broken])
    if (process.platform !== 'win32')
      expect(started.orphans.map((row) => row.launchId)).toContain(child.launchId)
    expect(await readFile(record)).toEqual(original)
    expect(await readFile(broken, 'utf8')).toBe('{broken')
  })
  it('runs marked child at below-normal priority with intent and OS confirmation on disk', async () => {
    const f = await fixture()
    const output = path.join(f.directory, 'observed.json')
    const code = `require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({marker:process.env.MUSE_SPARK_LAUNCH_ID, priority:require('node:os').getPriority()})); setTimeout(()=>{}, 20000)`
    const child = await f.lifetime.launch(f.request(code))
    await until(async () => {
      try {
        JSON.parse(await readFile(output, 'utf8'))
        return true
      } catch {
        return false
      }
    })
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual({
      marker: child.launchId,
      priority: os.constants.priority.PRIORITY_BELOW_NORMAL,
    })
    const records = await f.lifetime.recoveryRecords(f.journal)
    expect(records).toHaveLength(1)
    expect(records[0]?.confirmation?.pid).toBeGreaterThan(1)
    expect(records[0]?.confirmation?.startTime).not.toBe('')
    expect(records[0]?.confirmation?.container).toEqual(
      process.platform === 'win32'
        ? 'windowsJob'
        : expect.stringMatching(/linuxScope|processGroup/),
    )
    const outcome = await child.retire()
    if (process.platform === 'win32') expect(child.child.exitCode).not.toBeNull()
    expect(outcome.childExited).toBe(true)
    if (process.platform === 'win32') expect(outcome.descendants).toBe('proved')
  })

  if (process.platform !== 'win32') {
    it('scans real marked descendants and stops only after click and second identity check', async () => {
      const f = await fixture()
      const output = path.join(f.directory, 'descendant.json')
      const descendant = `require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({pid:process.pid}));setTimeout(()=>{},20000)`
      const code = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{detached:true,stdio:'ignore'}).unref();setTimeout(()=>{},500)`
      const child = await f.lifetime.launch(f.request(code))
      await until(async () => {
        try {
          JSON.parse(await readFile(output, 'utf8'))
          return true
        } catch {
          return false
        }
      })
      const recovery = createOrphanRecovery(createNativeOrphanDriver())
      const records = await f.lifetime.recoveryRecords(f.journal)
      const pid: unknown = z
        .strictObject({ pid: z.number() })
        .parse(JSON.parse(await readFile(output, 'utf8'))).pid
      const observations = await recovery.find(records)
      const found = observations.find((row) => row.pid === pid)
      expect(found?.match).toBe('matched')
      if (found === undefined) throw new Error('marked descendant absent')
      expect(await recovery.stop(found, false)).toBe('kept')
      expect(await createNativeOrphanDriver().observe(found.pid)).toBeDefined()
      expect(await recovery.stop({ ...found, startTime: 'changed' }, true)).toBe('changed')
      expect(await recovery.stop(found, true)).toBe('stopped')
      await child.retire()
      await until(async () => (await createNativeOrphanDriver().observe(found.pid)) === undefined)
    })

    it('retains no-scope detached descendants as uncertain after direct child exit', async () => {
      const f = await fixture()
      const output = path.join(f.directory, 'detached.json')
      const code = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(output)}, String(process.pid));setTimeout(()=>{},20000)`)}],{detached:true,stdio:'ignore'}).unref();setTimeout(()=>{},500)`
      const child = await f.lifetime.launch(f.request(code))
      const confirmation = await child.confirmation
      const end = await child.ended
      if (confirmation.container === 'processGroup') expect(end.descendants).toBe('uncertain')
      const records = await f.lifetime.recoveryRecords(f.journal)
      const recovery = createOrphanRecovery(createNativeOrphanDriver())
      const found = await recovery.find(records)
      expect(found.length).toBeGreaterThan(0)
      for (const orphan of found) await recovery.stop(orphan, true)
      await child.retire()
    })
  }

  if (process.platform === 'win32') {
    describe('prepared Windows owner', () => {
      let owner: Awaited<ReturnType<typeof standaloneOwner>> | undefined
      let output = ''
      beforeEach(async () => {
        const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'm96-owner-')))
        directories.push(directory)
        output = path.join(directory, 'descendant.json')
        const descendant = `require('node:fs').writeFileSync(${JSON.stringify(output)},JSON.stringify({pid:process.pid}));setTimeout(()=>{},20000)`
        const code = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{detached:true,stdio:'ignore'});setTimeout(()=>{},20000)`
        owner = await standaloneOwner(directory, code)
      })
      it('hard host death closes jobs and ends detached grandchildren', async () => {
        if (owner === undefined) throw new Error('native owner not prepared')
        const { parent, parentExited } = owner
        await until(async () => {
          try {
            JSON.parse(await readFile(output, 'utf8'))
            return true
          } catch {
            return false
          }
        })
        const pid: unknown = z
          .strictObject({ pid: z.number() })
          .parse(JSON.parse(await readFile(output, 'utf8'))).pid
        if (typeof pid !== 'number') throw new Error('missing descendant pid')
        expect(() => process.kill(pid, 0)).not.toThrow()
        parent.kill()
        await parentExited
        await until(() => {
          try {
            process.kill(pid, 0)
            return Promise.resolve(false)
          } catch {
            return Promise.resolve(true)
          }
        })
      })
    })
  } else if (process.platform === 'linux') {
    it('hard parent death kills the real direct child under setpriv without a user scope', async () => {
      const f = await fixture()
      const bin = path.join(f.directory, 'bin')
      await mkdir(bin)
      for (const name of ['setpriv', 'nice', 'true'])
        await symlink(`/usr/bin/${name}`, path.join(bin, name))
      const output = path.join(f.directory, 'direct.json')
      const code = `require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({pid:process.pid}));setTimeout(()=>{},20000)`
      const { parent, parentExited } = await standaloneOwner(f.directory, code, { PATH: bin })
      await until(async () => {
        try {
          JSON.parse(await readFile(output, 'utf8'))
          return true
        } catch {
          return false
        }
      })
      const { pid } = z
        .strictObject({ pid: z.number() })
        .parse(JSON.parse(await readFile(output, 'utf8')))
      expect(await createNativeOrphanDriver().observe(pid)).toBeDefined()
      parent.kill('SIGKILL')
      await parentExited
      await until(async () => (await createNativeOrphanDriver().observe(pid)) === undefined)
    })
  }
})
