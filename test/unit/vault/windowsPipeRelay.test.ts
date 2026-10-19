import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import { build } from 'esbuild'
import { windowsVaultPipeName } from '../../../src/runtime/vault/windowsPipeRelay'
import {
  isVaultPipeServerTrusted,
  windowsVaultPipeNameSchema,
  windowsVaultPipeServerResultSchema,
} from '../../../src/core/vault/broker/windowsPipe'

const EXAMPLE_PID = 4242
const STARTED_AT = 1_700_000_000_000
const EXAMPLE_EXE = String.raw`C:\Windows\System32\peer.exe`

describe('Windows pipe relay', () => {
  it('minted pipe names match the contract and never repeat', () => {
    expect(windowsVaultPipeNameSchema.safeParse(windowsVaultPipeName()).success).toBe(true)
    expect(windowsVaultPipeName()).not.toBe(windowsVaultPipeName())
  })

  it('the server trust predicate matches everything the OS reported', () => {
    const ownerSid = 'S-1-5-21-1-2-3-1001'
    const answer = windowsVaultPipeServerResultSchema.parse({
      v: 1,
      id: 1,
      result: 'ok',
      ownerSid,
      server: {
        v: 1,
        processId: EXAMPLE_PID,
        userId: ownerSid,
        startedAt: STARTED_AT,
        executable: EXAMPLE_EXE,
        remote: false,
        ownerOnlyDacl: true,
      },
    })
    expect(isVaultPipeServerTrusted(answer, ownerSid)).toBe(true)
    expect(isVaultPipeServerTrusted(answer, 'S-1-5-21-9-9-9-9999')).toBe(false)
    expect(isVaultPipeServerTrusted({ ...answer, result: 'refused', server: null }, ownerSid)).toBe(
      false,
    )
    expect(
      isVaultPipeServerTrusted({ ...answer, server: { ...answer.server, remote: true } }, ownerSid),
    ).toBe(false)
    expect(
      isVaultPipeServerTrusted(
        { ...answer, server: { ...answer.server, ownerOnlyDacl: false } },
        ownerSid,
      ),
    ).toBe(false)
  })
})

const builtSchema = z.strictObject({
  built: z.literal(true),
  ownerSid: z.string().check(z.minLength(1)),
})
const resultsSchema = z.strictObject({
  results: z.strictObject({
    echo: z.string(),
    serverResult: z.string(),
    serverOwnerSid: z.string(),
    // The helper's whole server answer: the trust predicate runs against
    // what the helper really reported, never a weakened reading of it.
    server: windowsVaultPipeServerResultSchema,
    processResult: z.string(),
    processId: z.union([z.number(), z.null()]),
    processUserId: z.union([z.string(), z.null()]),
  }),
})

// The relay speaks the real MuseSparkVaultPipe helper, which only runs on
// Windows: this suite builds that binary and proves serve, echo, owner-only
// files and identity reads against it on Windows CI, and skips elsewhere
// with this reason (no invented helper stands in for it).
const fixture = { root: '', ownerSid: '' }
const children = new Set<ChildProcess>()
describe.skipIf(process.platform !== 'win32')('Windows pipe relay against the real helper', () => {
  beforeAll(async () => {
    fixture.root = await mkdtemp(path.join(tmpdir(), 'vs-piperelay-'))
    const bundle = path.join(fixture.root, 'pipeRelayChild.cjs')
    // No admission alias: the child bundles the production admission module,
    // so the relay proof runs the same admission the installed broker does.
    await build({
      entryPoints: ['test/unit/helpers/vault/windowsPipeRelayChild.ts'],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'cjs',
    })
    const systemRoot = process.env['SystemRoot']
    if (!systemRoot) throw new Error('SystemRoot names the Windows system root')
    const workDir = path.join(fixture.root, 'work')
    await mkdir(workDir, { recursive: true })
    const child = spawn(
      process.execPath,
      [
        bundle,
        JSON.stringify({
          storageDir: path.join(fixture.root, 'helper'),
          systemRoot,
          slotSource: path.resolve('native/windows/MuseSparkVault.cs'),
          pipeSource: path.resolve('native/windows/MuseSparkVaultPipe.cs'),
          workDir,
          pipe: windowsVaultPipeName(),
        }),
      ],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    )
    children.add(child)
    if (child.stdout === null || child.stderr === null)
      throw new Error('missing fixture diagnostic pipes')
    child.stdout.resume()
    const errors: Buffer[] = []
    child.stderr.on('data', (bytes: Buffer) => {
      errors.push(bytes)
    })
    // The C# compile is slow; the hook budget covers the build, never the
    // test. A child that dies building fails fast with its diagnostics.
    const built = await Promise.race([
      (async () => ({ kind: 'built', message: await once(child, 'message') }) as const)(),
      (async () => {
        await once(child, 'exit')
        return {
          kind: 'exited',
          diagnostics: Buffer.concat(errors).toString('utf8'),
        } as const
      })(),
    ])
    if (built.kind === 'exited')
      throw new Error(`relay fixture exited while building: ${built.diagnostics}`)
    const report = builtSchema.parse(built.message[0])
    fixture.ownerSid = report.ownerSid
  })
  afterAll(async () => {
    for (const child of children) {
      child.kill('SIGKILL')
      if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
    }
    if (!fixture.root) return
    await rm(fixture.root, { recursive: true, force: true })
  })

  it('relays a connection, echoes bytes and answers file and identity queries', async () => {
    const [child] = [...children]
    if (child === undefined) throw new Error('relay fixture is not running')
    if (child.stdout === null || child.stderr === null)
      throw new Error('missing fixture diagnostic pipes')
    const errors: Buffer[] = []
    child.stderr.on('data', (bytes: Buffer) => {
      errors.push(bytes)
    })
    child.send('run')
    const finished = await Promise.race([
      (async () => ({ kind: 'results', message: await once(child, 'message') }) as const)(),
      (async () => {
        await once(child, 'exit')
        return {
          kind: 'exited',
          diagnostics: Buffer.concat(errors).toString('utf8'),
        } as const
      })(),
    ])
    if (finished.kind === 'exited')
      throw new Error(`relay fixture exited during the run: ${finished.diagnostics}`)
    const report = resultsSchema.parse(finished.message[0])
    // Every value below comes from the helper or the OS: the echo round
    // trip, the server's own owner SID against the relay's, the trust
    // predicate against the helper's real server answer (an `ok` with
    // `ownerOnlyDacl: false` fails here, as the dial would refuse it),
    // and the examined process against this fixture child.
    expect(report.results.echo).toBe('hello-relay')
    expect(report.results.serverResult).toBe('ok')
    expect(report.results.serverOwnerSid).toBe(fixture.ownerSid)
    expect(isVaultPipeServerTrusted(report.results.server, fixture.ownerSid)).toBe(true)
    expect(report.results.processResult).toBe('ok')
    expect(report.results.processId).toBe(child.pid)
    expect(report.results.processUserId).toBe(fixture.ownerSid)
    child.send('stop')
    const [code] = await once(child, 'exit')
    children.delete(child)
    expect(code).toBe(0)
  })
})
