import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'
import * as z from 'zod/mini'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as admission from '../../src/core/resources/admission'
import type { ResourceLease, ResourceProcessLaunch } from '../../src/core/resources/launch'
import { WindowsResourceTreeReader } from '../../src/core/resources/trees/windows'
import { ResourceTreeRegistry } from '../../src/core/resources/trees/registry'
import { modelApiMcpPoolDeps } from '../../src/host/backend/mcpServers'
import { shellJobAssembly } from '../../src/host/backend/shellJob'
import { fixtureJobLifecycle } from './helpers/mcpFixtures'
import { readJobSource, runJobWithoutAutoload } from './helpers/jobSource'
import { fakeMuseCodeManager } from './helpers/museCodeManager'
import { fakeAccountHome } from './helpers/accountHome'
import { fakeInitializeResult } from './helpers/fakeMsp'
import { removeFolder } from './helpers/temporaryFolders'
import { UI_TEXT } from '../../src/shared/constants'
import { runProgram } from '../../src/host/processTree'

vi.mock('../../src/core/resources/admission', { spy: true })

const job = fixtureJobLifecycle()
const state: { folder: string; assembly: string | undefined; parentScript: string } = {
  folder: '',
  assembly: undefined,
  parentScript: '',
}
beforeAll(async () => {
  state.folder = await mkdtemp(path.join(tmpdir(), 'spawn017-'))
  await job.setup()
  if (process.platform !== 'win32') return
  state.assembly = await shellJobAssembly({
    run: runProgram,
    storageDir: state.folder,
    systemRoot: process.env['SystemRoot']!,
    readJobSource,
    log: () => undefined,
  })()
  state.parentScript = path.join(state.folder, 'owner.cjs')
  await build({
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: state.parentScript,
    plugins: [
      {
        name: 'fixture-admission',
        setup(builder) {
          builder.onLoad({ filter: /resources[\\/]admission\.ts$/ }, () => ({
            loader: 'ts',
            contents: `
const lease={register:()=>{},complete:()=>{},background:()=>{}};
export const admitResource=async()=>lease;
export const admitBootstrap=async()=>lease;
export const resourceWindowsJob=async()=>({assemblyPath:process.argv[4],executablePath:process.argv[5]});
export const configureResources=()=>()=>{};
export const inResourceClass=async(_kind,action)=>await action();
export const stopResourceTree=async()=>{throw new Error('Unused fixture stop')};
export const assertResourceWrite=async()=>{};
export const resourceSafePoint=async()=>{};
export const reportResourceTransport=async()=>{};
export const spawnResourceProcess=async()=>{throw new Error('Unused fixture launch')};
export const execResourceFile=async()=>{throw new Error('Unused fixture command')};
`,
          }))
        },
      },
    ],
    stdin: {
      resolveDir: process.cwd(),
      contents: `
import { MuseCodeBackendManager } from './src/host/backend/museCodeBackendManager';
import { configureResources } from './src/core/resources/admission';
import { writeFileSync } from 'node:fs';
const [file, marker, assembly, executable] = process.argv.slice(2);
configureResources({inspect:()=>undefined,onError:()=>{},windowsJob:async()=>({assemblyPath:assembly,executablePath:executable})});
const manager = new MuseCodeBackendManager({accountHome:{provider:'meta',account:'fixture',configHome:undefined,generation:0,signal:new AbortController().signal,assertCurrent:()=>{},observeUsage:()=>{}},beforeWorkspaceHostStart:async()=>{},log:{trace:()=>{},info:()=>{},warn:()=>{},error:()=>{}},extensionVersion:'fixture',getConfiguredBinaryPath:()=>process.execPath,getEnvironmentVariables:()=>[],workspaceRoot:undefined,getShellSandbox:()=>'off',getSandboxNetwork:()=>'default',userProfileDir:undefined,isWorkspaceTrusted:()=>true,getProxySettings:()=>({proxy:'',noProxy:[]}),shellJobAssembly:async()=>assembly});
manager.resolveLaunch=()=>({ok:true,launch:{command:process.execPath,args:[file],serveArgs:[],installDir:'',cliPath:process.execPath}});
manager.credentialFileVerdict=()=> 'absent';
manager.ensureHost().then(()=>writeFileSync(marker,'ready')).catch(()=>process.exit(1));
setInterval(()=>{},1000);
`,
    },
  })
}, 60_000) // Cold compilation and self-test of both shipped native helpers.
afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  await job.dispose()
  await removeFolder(state.folder)
})

function governedLease() {
  const { assembly } = state
  if (assembly === undefined || job.path === undefined) throw new Error('Native helper missing')
  const reader = new WindowsResourceTreeReader({
    assemblyPath: assembly,
    systemRoot: process.env['SystemRoot']!,
    run: runJobWithoutAutoload,
  })
  const registry = new ResourceTreeRegistry(reader)
  let registered: ResourceProcessLaunch | undefined
  const lease: ResourceLease = {
    register: (launch) => {
      registered = launch
    },
    complete: vi.fn(),
    background: vi.fn(),
    kill: async () => {
      const name = registered?.job?.name
      if (name === undefined) return false
      const root = await reader.rootOfJob(name)
      if (root === null) return await reader.jobGone(name)
      const ticket = {
        id: 'spawn017',
        root,
        scope: { type: 'job', name } as const,
        kind: 'museServe' as const,
        class: 'foreground' as const,
        sessionId: null,
      }
      await registry.register(ticket)
      const result = await registry.kill(ticket)
      return result.status === 'done'
    },
    isTreeGone: async () =>
      registered?.job !== undefined && (await reader.jobGone(registered.job.name)),
  }
  vi.spyOn(admission, 'admitResource').mockResolvedValue(lease)
  vi.spyOn(admission, 'resourceWindowsJob').mockResolvedValue({
    assemblyPath: assembly,
    executablePath: job.path,
  })
  return { lease, reader, launch: () => registered }
}

async function processScript(name: string, isMsp: boolean) {
  const { folder } = state
  const marker = path.join(folder, `${name}.json`)
  const file = path.join(folder, `${name}.cjs`)
  await writeFile(
    file,
    `const {spawn}=require('child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});require('fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify([process.pid,child.pid]));${isMsp ? String.raw`require('readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.method==='initialize')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:${JSON.stringify(fakeInitializeResult)}})+'\n')});` : ''}${name === 'owner-account' ? '' : "process.stdin.on('end',()=>process.exit(0));"}process.stdin.resume();setInterval(()=>{},1000)`,
  )
  return { file, marker }
}

async function proveMembers(h: ReturnType<typeof governedLease>, marker: string) {
  const pids = await vi.waitFor(
    async () => z.array(z.number()).parse(JSON.parse(await readFile(marker, 'utf8'))),
    { timeout: 5000 },
  )
  const name = h.launch()?.job?.name
  expect(name, 'payload must have native job registration, not only PID registration').toBeDefined()
  if (name === undefined) throw new Error('Native job not registered')
  for (const pid of pids) {
    const identity = await h.reader.identity(pid)
    expect(identity).not.toBeNull()
    if (identity === null) throw new Error('Fixture exited early')
    const root = await h.reader.rootOfJob(name)
    if (root === null) throw new Error('Job root unavailable')
    expect(
      await h.reader.contains(
        {
          id: 'membership',
          root,
          scope: { type: 'job', name },
          kind: 'museServe',
          class: 'foreground',
          sessionId: null,
        },
        identity,
      ),
    ).toBe(true)
  }
  return name
}

describe('SPAWN017 production governance', () => {
  it.runIf(process.platform === 'win32')(
    'contains and retires the shared media and vault helper launch boundary',
    async () => {
      const h = governedLease()
      const script = await processScript('shared-helper', false)
      const { spawnResourceProcess } = await import('../../src/core/resources/process')
      const payload = await spawnResourceProcess(process.execPath, [script.file], {
        env: { SystemRoot: process.env['SystemRoot'] },
      })
      let failure = ''
      payload.child.stderr.on('data', (bytes: Buffer) => {
        failure += bytes.toString('utf8')
      })
      try {
        let name: string
        try {
          name = await proveMembers(h, script.marker)
        } catch {
          throw new Error(`Fixture launch exit ${String(payload.child.exitCode)}: ${failure}`)
        }
        expect(admission.admitResource).toHaveBeenCalledWith('other', undefined)
        const pids = z.array(z.number()).parse(JSON.parse(await readFile(script.marker, 'utf8')))
        expect(await payload.pid()).toBe(pids[0])
        await payload.stop()
        expect(await h.reader.jobGone(name)).toBe(true)
        expect(h.lease.complete).toHaveBeenCalledWith(false)
      } finally {
        await payload.stop()
      }
    },
  )
  it.runIf(process.platform === 'win32')(
    'kills the complete account MSP job when its owning host dies',
    async () => {
      const h = governedLease()
      const script = await processScript('owner-account', true)
      const ready = path.join(state.folder, 'owner-ready')
      if (state.assembly === undefined || job.path === undefined) throw new Error('Helper missing')
      const parent = spawn(
        process.execPath,
        [state.parentScript, script.file, ready, state.assembly, job.path],
        { env: { SystemRoot: process.env['SystemRoot'] }, stdio: 'ignore', windowsHide: true },
      )
      let pids: number[] = []
      try {
        await vi.waitFor(
          async () => {
            expect(await readFile(ready, 'utf8')).toBe('ready')
          },
          { timeout: 5000 },
        )
        pids = z.array(z.number()).parse(JSON.parse(await readFile(script.marker, 'utf8')))
        const identities = await Promise.all(pids.map((pid) => h.reader.identity(pid)))
        expect(identities.every((identity) => identity !== null)).toBe(true)
        parent.kill()
        await vi.waitFor(
          async () => {
            for (const identity of identities) {
              if (identity === null) throw new Error('Missing process identity')
              const current = await h.reader.identity(identity.pid)
              expect(current?.startTime).not.toBe(identity.startTime)
            }
          },
          { timeout: 5000 },
        )
      } finally {
        parent.kill()
        for (const pid of pids) {
          try {
            process.kill(pid)
          } catch {
            /* Fixture already ended. */
          }
        }
      }
    },
  )
  it.runIf(process.platform === 'win32')(
    'contains an account MSP tree and proves whole-tree exit before retirement',
    async () => {
      const { folder, assembly } = state
      const h = governedLease()
      const script = await processScript('account', true)
      const manager = fakeMuseCodeManager({
        accountHome: fakeAccountHome(),
        shellJobAssembly: () => Promise.resolve(assembly),
      })
      vi.spyOn(manager, 'resolveLaunch').mockReturnValue({
        ok: true,
        launch: {
          command: process.execPath,
          args: [script.file],
          serveArgs: [],
          installDir: folder,
          cliPath: process.execPath,
        },
      })
      vi.spyOn(manager, 'credentialFileVerdict').mockReturnValue('absent')
      try {
        await manager.ensureHost()
        expect(admission.admitResource).toHaveBeenCalledWith('museServe', expect.any(AbortSignal))
        const name = await proveMembers(h, script.marker)
        await manager.dispose()
        expect(await h.reader.jobGone(name)).toBe(true)
        expect(h.lease.complete).toHaveBeenCalledWith(false)
        expect(h.lease.complete).not.toHaveBeenCalledWith(true)
      } finally {
        await manager.dispose()
        await h.lease.kill?.()
      }
    },
  )

  it.runIf(process.platform === 'win32')(
    'builds vault stdio through MCP admission and native containment',
    async () => {
      const { folder, assembly } = state
      const h = governedLease()
      const script = await processScript('vault', false)
      const value = Buffer.from('fixture-vault-value')
      const close = vi.fn(() => Promise.resolve())
      const deps = modelApiMcpPoolDeps({
        vaultBroker: {
          redeem: () =>
            Promise.resolve([
              {
                value,
                username: null,
                revoked: new AbortController().signal,
                expiresAt: Date.now() + 60_000,
                close,
              },
            ]),
          remote: () => Promise.reject(new Error('No network')),
        },
        beforeWorkspaceProcessStart: () => Promise.resolve(),
        workspaceRoot: folder,
        settingsPath: () => path.join(folder, 'settings.json'),
        isWorkspaceTrusted: () => true,
        clientVersion: 'test',
        platform: process.platform,
        jobExecutablePath: job.path,
        shellJobAssembly: () => Promise.resolve(assembly),
        env: () => ({ SystemRoot: process.env['SystemRoot'] }),
        fetch: () => Promise.reject(new Error('No network')),
        log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      })
      expect(deps.vault, 'production broker must build the guarded route').toBeDefined()
      const child = await deps.vault!.startStdio(
        'fixture',
        {
          transport: 'stdio',
          command: process.execPath,
          args: [script.file],
          env: { TOKEN: '${secret:fixture}' },
          cwd: undefined,
          framing: 'auto',
        },
        folder,
        () => false,
      )
      try {
        expect(admission.admitResource).toHaveBeenCalledWith('mcpServer', expect.any(AbortSignal))
        const name = await proveMembers(h, script.marker)
        await child.kill()
        expect(await h.reader.jobGone(name)).toBe(true)
        expect(h.lease.complete).toHaveBeenCalledWith(false)
        expect(value.every((byte) => byte === 0)).toBe(true)
        expect(close).toHaveBeenCalledOnce()
      } finally {
        await child.kill()
      }
    },
  )

  it('keeps unbound vault credentials refused before starting a server', async () => {
    const { folder } = state
    const deps = modelApiMcpPoolDeps({
      beforeWorkspaceProcessStart: () => Promise.resolve(),
      workspaceRoot: folder,
      settingsPath: () => '',
      isWorkspaceTrusted: () => true,
      clientVersion: 'test',
      platform: process.platform,
      env: () => ({}),
      fetch: () => Promise.reject(new Error('No network')),
      log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })
    expect(deps.vault).toBeUndefined()
    await expect(
      deps.spawn(
        {
          transport: 'stdio',
          command: process.execPath,
          args: [],
          env: { TOKEN: '${secret:fixture}' },
          cwd: undefined,
          framing: 'auto',
        },
        folder,
      ),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
  })
})
