import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { EXPECTED_SCHEMA_FINGERPRINT } from '@muse-code/sdk'
import { build } from 'esbuild'
import { vi, beforeAll, afterAll } from 'vitest'
import * as z from 'zod/mini'
import { redactSecrets } from '../../src/shared/redact'
import { MHP_METHODS, type MhpParams } from '../../src/shared/hostApi/methods'
import { fakeModelApi } from '../unit/helpers/fakeModelApi'
import { buildHostBundles, buildModelApiBundle } from '../unit/helpers/modelApiBundle'
import { buildPortableBundle } from '../unit/helpers/portableBundle'
import { removeFolder } from '../unit/helpers/temporaryFolders'
import { installFakeCredential, installFakeMuse } from './fakeMuse'
import { buildLinuxHelper } from '../../scripts/build-linux-helper.mjs'

/** Builds and launches only private, fake-keyring artifacts; no installed agent or real API. */
export async function panelProcessFixture() {
  const root = path.resolve(import.meta.dirname, '..', '..')
  const packageRoot = mkdtempSync(path.join(tmpdir(), 'm104-panel-package-'))
  const dist = path.join(packageRoot, 'dist')
  const workspace = mkdtempSync(path.join(tmpdir(), 'm104-panel-workspace-'))
  const data = mkdtempSync(path.join(tmpdir(), 'm104-panel-data-'))
  const config = installFakeCredential()
  const fake = installFakeMuse()
  const fakeInstalls = [fake.installDir]
  const api = fakeModelApi()
  api.script({ text: 'From the fake panel model.' })
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const value of request) {
        const chunk: unknown = value
        if (!(chunk instanceof Uint8Array)) throw new Error('Invalid fake HTTP chunk')
        chunks.push(Buffer.from(chunk))
      }
      const body = Buffer.concat(chunks).toString()
      const reply = await api.fetch(new URL(request.url ?? '/', 'https://api.example.test'), {
        method: request.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: request.headers.authorization ?? '',
        },
        ...(body !== '' && { body }),
      })
      response.writeHead(reply.status, Object.fromEntries(reply.headers))
      if (reply.body === null) response.end()
      else {
        for await (const chunk of reply.body) response.write(chunk)
        response.end()
      }
    })().catch(() => {
      response.writeHead(500)
      response.end()
    })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fake API not listening')
  const origin = `http://127.0.0.1:${String(address.port)}`
  mkdirSync(dist, { recursive: true })
  const agent = path.join(dist, 'acp.js')
  writeFileSync(
    path.join(packageRoot, 'fakeKeyring.mjs'),
    `export class AsyncEntry {
    static FAKE_ONLY_KEYRING = true;
    getPassword() { return Promise.resolve('LLM|1|secret'); }
    setPassword() { return Promise.reject(new Error('Fake keyring refuses writes')); }
    deletePassword() { return Promise.reject(new Error('Fake keyring refuses deletion')); }
  }`,
  )
  await build({
    entryPoints: [path.join(root, 'src/runtime/main.ts')],
    outfile: agent,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'silent',
    banner: {
      js: `const fakeFetch = globalThis.fetch; globalThis.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url ?? input.href);
      if (url.hostname !== 'api.meta.ai') return Promise.reject(new Error('Fake fixture refuses network'));
      return fakeFetch(${JSON.stringify(origin)} + url.pathname + url.search, init);
    };`,
    },
    alias: { '@napi-rs/keyring': path.join(packageRoot, 'fakeKeyring.mjs') },
  })
  if (!readFileSync(agent, 'utf8').includes('FAKE_ONLY_KEYRING'))
    throw new Error('Unsafe process artifact')
  // 0.17: every governed launch admits through the governor beside acp.js.
  await build({
    entryPoints: [path.join(root, 'src/core/resources/resourceGovernorEntry.ts')],
    outfile: path.join(dist, 'resourceGovernor.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'silent',
  })
  // On Linux the governor confirms created paths through the helper beside dist/.
  buildLinuxHelper(packageRoot)
  await buildHostBundles(dist, {
    runtimePanel: path.join(root, 'src/runtime/panel/panelEntry.ts'),
    runtimePanelPorts: path.join(root, 'src/runtime/panel/runtimeFeaturesEntry.ts'),
    conversation: path.join(root, 'src/host/conversation/conversationEntry.ts'),
    sessionBoard: path.join(root, 'src/host/sessionBoardEntry.ts'),
    runtimeContext: path.join(root, 'src/runtime/panel/contextEntry.ts'),
    planMarkdown: path.join(root, 'src/host/planMarkdownEntry.ts'),
    runtimeEngines: path.join(root, 'src/runtime/panel/engineEntry.ts'),
    runtimeBackendServices: path.join(root, 'src/runtime/panel/backendEntry.ts'),
    runtimePresentation: path.join(root, 'src/host/views/runtimePresentationEntry.ts'),
    checkpointStore: path.join(root, 'src/host/checkpoints/checkpointStoreEntry.ts'),
  })
  await buildModelApiBundle(dist)
  await buildPortableBundle(dist)
  cpSync(path.join(root, 'l10n'), path.join(packageRoot, 'l10n'), { recursive: true })
  writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ version: '0.0.0-fake' }))
  const children: ChildProcessWithoutNullStreams[] = []
  function launch(
    transport: 'stdio' | 'companion',
    backend = 'museCode',
    extra: Record<string, string> = {},
    args?: readonly string[],
  ) {
    if (!readFileSync(agent, 'utf8').includes('FAKE_ONLY_KEYRING'))
      throw new Error('Unsafe process artifact')
    // 0.17 strips unknown child variables; crash injection belongs to the fake CLI itself.
    const launchedFake = extra['MUSE_FAKE_START'] === 'crash' ? installFakeMuse('crash') : fake
    if (launchedFake !== fake) fakeInstalls.push(launchedFake.installDir)
    const child = spawn(
      process.execPath,
      [
        agent,
        'panel',
        `--${transport}`,
        '--backend',
        backend,
        '--muse-binary',
        launchedFake.binaryPath,
        '--shell-sandbox',
        'off',
        ...(args ?? []),
      ],
      {
        cwd: workspace,
        stdio: 'pipe',
        env: {
          PATH: process.env['PATH'],
          NODE_PATH: path.join(root, 'node_modules'),
          XDG_CONFIG_HOME: config,
          XDG_DATA_HOME: data,
          HOME: data,
          LOCALAPPDATA: data,
          MUSE_FAKE_NODE: process.execPath,
          MUSE_FAKE_FINGERPRINT: EXPECTED_SCHEMA_FINGERPRINT,
          LANG: 'C',
          ...extra,
        },
      },
    )
    children.push(child)
    const frames: unknown[] = []
    let stdout = ''
    let stderr = ''
    let pending = ''
    const exited = new Promise<number | null>((resolve) => {
      child.once('exit', resolve)
    })
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      pending += chunk.toString()
      for (;;) {
        const end = pending.indexOf('\n')
        if (end === -1) break
        frames.push(JSON.parse(pending.slice(0, end)))
        pending = pending.slice(end + 1)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    const send = (frame: unknown) => {
      child.stdin.write(`${JSON.stringify(frame)}\n`)
    }
    const wait = async (isMatch: (frame: unknown) => boolean) => {
      await vi.waitFor(
        () => {
          if (child.exitCode !== null)
            throw new Error(`Fake panel exited ${String(child.exitCode)}: ${stderr}`)
          if (frames.every((frame) => !isMatch(frame)))
            throw new Error(
              `Waiting for fake frame: ${redactSecrets(JSON.stringify(frames))}; ${redactSecrets(stderr)}`,
            )
        },
        { timeout: 10_000 },
      )
      return frames.find((frame) => isMatch(frame))
    }
    function sendInitialize(protocolRange?: MhpParams<'initialize'>['protocolRange']) {
      const params = MHP_METHODS.initialize.params.parse({
        host: { id: 'fake', version: '1' },
        locale: 'en',
        theme: { kind: 'dark', tokens: {} },
        trusted: false,
        protocolRange: protocolRange ?? { minimum: 'mhp/1.4.0', maximumExclusive: 'mhp/1.5.0' },
        capabilities: ['lifecycle', 'surfaces', 'ui'],
        folders: [{ uri: pathToFileURL(workspace).href, name: 'fake workspace' }],
      })
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params })
    }
    async function initialize() {
      sendInitialize()
      await wait(
        (frame) =>
          z
            .object({
              id: z.literal(1),
              result: z.object({ protocolVersion: z.literal('mhp/1.4.0') }),
            })
            .safeParse(frame).success,
      )
    }
    return {
      child,
      frames,
      send,
      wait,
      initialize,
      sendInitialize,
      exited,
      output: () => ({ stdout, stderr }),
    }
  }
  return {
    launch,
    api,
    workspace,
    close: async () => {
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await Promise.all(
        children.map(
          (child) =>
            new Promise<void>((resolve) => {
              if (child.exitCode !== null || child.signalCode !== null) resolve()
              else
                child.once('exit', () => {
                  resolve()
                })
            }),
        ),
      )
      server.closeAllConnections()
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
      for (const folder of [packageRoot, workspace, data, config, ...fakeInstalls])
        await removeFolder(folder)
    },
  }
}

/** A shared suite-owned lifetime prevents leaked fake sockets/processes on failed assertions. */
export function panelProcessSuite(): () => Awaited<ReturnType<typeof panelProcessFixture>> {
  const fixtures: Awaited<ReturnType<typeof panelProcessFixture>>[] = []
  beforeAll(async () => {
    fixtures.push(await panelProcessFixture())
  })
  afterAll(async () => {
    for (const fixture of fixtures) await fixture.close()
  })
  return () => {
    const fixture = fixtures[0]
    if (fixture === undefined) throw new Error('Fake panel fixture not initialized')
    return fixture
  }
}
