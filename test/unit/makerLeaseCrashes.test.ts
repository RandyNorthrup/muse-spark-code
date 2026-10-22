import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterEach, describe, expect, it } from 'vitest'
import { claimHardwareLease, stopHardwareLease } from '../../src/core/maker/lease'
import { makerLeaseDeps, makerProcessDeps } from './helpers/makerSerial'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

const childScript = String.raw`
const fs = require('node:fs/promises');
const phase = process.argv[2];
const waiting = new Promise(() => {});
const pause = () => { process.stdout.write('barrier\n'); return waiting; };
const originalOpen = fs.open;
fs.open = async (...args) => {
  const handle = await originalOpen(...args);
  if (String(args[0]).endsWith('.json')) {
    if (phase === 'partial-write') {
      const write = handle.writeFile.bind(handle);
      handle.writeFile = async () => { await write('{'); await pause(); };
    }
    if (phase === 'after-sync') {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => { await sync(); await pause(); };
    }
  }
  return handle;
};
const originalLink = fs.link;
fs.link = async (source, target) => {
  if (String(target).endsWith('head.claim') && phase === 'before-publish') await pause();
  await originalLink(source, target);
  if (String(target).endsWith('head.claim') && phase === 'after-publish') await pause();
};
require('node:readline').createInterface({ input: process.stdin }).once('line', async line => {
  try {
    const configuration = JSON.parse(line);
    const { claimHardwareLease } = require(process.argv[1]);
    const result = await claimHardwareLease({
      directory: configuration.directory,
      platform: configuration.platform, timeoutMs: 2000, maxRecordBytes: 4096,
      isOwnerDirectory: () => Promise.resolve(true),
      processStartTime: async () => {
        if (phase === 'before-create') await pause();
        return configuration.startedAt;
      },
      listenOwnerPipe: () => Promise.resolve(() => Promise.resolve()),
      exclusive: () => Promise.reject(new Error('mutex must never run')),
    }, configuration.resource, 'crash-child', () => Promise.resolve());
    if (result.status !== 'acquired') throw new Error('child busy');
    await pause();
  } catch { process.stderr.write('test-child-failed\n'); process.exit(1); }
});
`

describe('real process death across atomic lease publication', () => {
  it.each([
    'before-create',
    'partial-write',
    'after-sync',
    'before-publish',
    'after-publish',
    'claimed',
  ])('recovers and stops the current holder after process death at %s', async (phase) => {
    const directory = await mkdtemp(
      path.join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'm103-crash-'),
    )
    directories.push(directory)
    const deps = await makerLeaseDeps(directory)
    const bundle = path.join(directory, 'lease.cjs')
    await build({
      entryPoints: [path.resolve('src/core/maker/lease.ts')],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
    })
    const child = spawn(process.execPath, ['-e', childScript, bundle, phase], {
      env: makerProcessDeps().env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: 'pipe',
    })
    const started = Date.now()
    const ended = new Promise<void>((resolve) =>
      child.once('close', () => {
        resolve()
      }),
    )
    const barrier = new Promise<void>((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => {
        reject(new Error('test-child-barrier-timeout'))
      }, 20_000)
      child.once('error', reject)
      child.once('close', () => {
        clearTimeout(timer)
        reject(new Error('test-child-ended-before-barrier'))
      })
      child.stdout.on('data', (bytes: Buffer) => {
        output += bytes.toString('utf8')
        if (output !== 'barrier\n') {
          return
        }

        clearTimeout(timer)
        resolve()
      })
    })
    child.stdin.on('error', () => child.stdin.destroy())
    const resource = `port:crash-${phase}`
    try {
      if (child.pid === undefined) throw new Error('test-child-pid')
      const startedAt = await deps.processStartTime(child.pid)
      expect(startedAt).toBeDefined()
      child.stdin.write(
        `${JSON.stringify({ directory, startedAt, resource, platform: process.platform })}\n`,
      )
      await barrier
      const whileAlive = await claimHardwareLease(deps, resource, 'parent', () => Promise.resolve())
      if (phase === 'after-publish' || phase === 'claimed') {
        expect(whileAlive.status).toBe('busy')
        if (whileAlive.status === 'busy') expect(whileAlive.holder?.pid).toBe(child.pid)
      } else {
        expect(whileAlive.status).toBe('acquired')
        if (whileAlive.status === 'acquired') await whileAlive.release()
      }
      await makerProcessDeps().kill(child, started)
      await ended
      let stops = 0
      const stop = () => {
        stops += 1
        return Promise.resolve()
      }
      const recovered = await claimHardwareLease(deps, resource, 'recovery', stop)
      expect(recovered.status).toBe('acquired')
      if (recovered.status === 'acquired') {
        try {
          const result = await stopHardwareLease(deps, resource)
          expect(stops).toBe(1)
          expect(result).toMatchObject({
            stopped: true,
            sessions: [{ record: recovered.record, party: 'holder', status: 'stopped' }],
          })
          expect(result.sessions).toHaveLength(1)
        } finally {
          await recovered.release()
        }
      }
    } finally {
      await makerProcessDeps().kill(child, started)
      await ended
      try {
        await barrier
      } catch {
        /* The child may be stopped before reaching the barrier. */
      }
    }
  })
})
