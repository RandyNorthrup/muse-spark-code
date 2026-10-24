import path from 'node:path'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { request as httpsRequest } from 'node:https'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sharedUiText, sharedValidation } from '../../scripts/lib/deferredBundles.mjs'
import { NODE_TLS_CERT_FILE, NODE_TLS_DIRECTORY } from '../../src/shared/constants'
import { nodeModule } from '../../src/runtime/node/bundle'
import { EN } from '../../src/shared/l10n/en'
import { nodeNativeTest, nodeTempRoot, vacantPort } from './helpers/nodeNative'

// The package layout: dist/ beside package.json, as the tarball lays it out.
const built = { folder: '', dist: '' }
beforeAll(async () => {
  built.folder = await nodeTempRoot('m110-node-bundle-')
  built.dist = path.join(built.folder, 'dist')
  await mkdir(built.dist)
  await copyFile('package.json', path.join(built.folder, 'package.json'))
  const options = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'silent',
  } as const
  await build({
    ...options,
    entryPoints: ['src/shared/validationEntry.ts'],
    outfile: path.join(built.dist, 'validation.js'),
  })
  await build({
    ...options,
    entryPoints: ['src/shared/l10n/en.ts'],
    outfile: path.join(built.dist, 'uiText.js'),
  })
  await build({
    ...options,
    entryPoints: ['src/runtime/node/main.ts'],
    outfile: path.join(built.dist, 'node.js'),
    plugins: [sharedUiText, sharedValidation],
  })
  // The two lazy bundles `serve` loads beside node.js.
  await build({
    ...options,
    entryPoints: ['src/runtime/node/serveEntry.ts'],
    outfile: path.join(built.dist, 'nodeServe.js'),
    plugins: [sharedUiText, sharedValidation],
  })
  await build({
    ...options,
    entryPoints: ['src/runtime/node/auth/entry.ts'],
    outfile: path.join(built.dist, 'nodeAuth.js'),
    plugins: [sharedUiText, sharedValidation],
  })
})
afterAll(async () => {
  if (built.folder !== '') await rm(built.folder, { recursive: true, force: true })
})

function command() {
  const lines: string[] = []
  const deps = {
    root: path.join(built.folder, 'state'),
    signal: new AbortController().signal,
    now: () => 0,
    print: (line: string) => {
      lines.push(line)
    },
    readSecret: () => Promise.reject(new Error('test forbids stdin use')),
  }
  return { module: nodeModule(path.join(built.dist, 'node.js')), deps, lines }
}

describe('M110-N shipped shared-parser boundary', () => {
  it('loads every node schema through the shared parser and installs caller language before help', async () => {
    const { module, deps, lines } = command()
    const table = { ...EN, nodeLabels: { ...EN.nodeLabels, title: 'Test installed node title' } }
    expect(await module.runNodeArgs(['--help'], deps, table, 'en')).toBe(0)
    expect(lines[0]).toBe('Test installed node title')
  })
  nodeNativeTest(
    'the packaged init validates an explicit private address and creates real state',
    async () => {
      const { module, deps } = command()
      expect(
        await module.runNodeArgs(
          [
            'init',
            '--label',
            'Fixture',
            '--name',
            'fixture.local',
            '--workspace-root',
            built.folder,
            '--listen',
            '192.168.1.9',
          ],
          deps,
          EN,
          'en',
        ),
      ).toBe(0)
      expect(await module.runNodeArgs(['status'], deps, EN, 'en')).toBe(0)
    },
  )
  it('the packaged CLI answers --help as a child process', () => {
    const run = spawnSync(process.execPath, [path.join(built.dist, 'node.js'), '--help'], {
      encoding: 'utf8',
    })
    expect(run.status).toBe(0)
    expect(run.stdout.split('\n', 1)[0]).toBe(EN.nodeLabels.title)
  })
  nodeNativeTest(
    'the packaged CLI runs init, status, serve-refusal and wipe for real',
    async () => {
      const root = await nodeTempRoot('m110-node-cli-')
      const workspace = path.join(root, 'workspaces')
      await mkdir(workspace, { recursive: true })
      const cli = path.join(built.dist, 'node.js')
      const run = (argv: readonly string[]) =>
        spawnSync(process.execPath, [cli, ...argv], { encoding: 'utf8' })
      try {
        const initialized = run([
          'init',
          '--data-root',
          root,
          '--label',
          'Home',
          '--name',
          'home.local',
          '--workspace-root',
          workspace,
        ])
        expect(initialized.status).toBe(0)
        expect(run(['status', '--data-root', root]).status).toBe(0)
        const served = run(['serve', '--data-root', root])
        expect(served.status).toBe(1)
        expect(served.stdout.trim()).toBe(EN.nodeErrors.unavailable)
        expect(run(['wipe', '--confirm-wipe', '--data-root', root]).status).toBe(0)
        await expect(stat(root)).rejects.toThrow()
        await expect(stat(workspace)).rejects.toThrow()
        const after = run(['status', '--data-root', root])
        expect(after.status).toBe(1)
        expect(after.stdout.trim()).toBe(EN.nodeErrors.notFound)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )
  nodeNativeTest(
    'the packaged CLI serves over HTTPS with the printed fingerprint, refuses an unauthenticated route and stops',
    async () => {
      const root = await nodeTempRoot('m110-node-serve-')
      const workspace = path.join(root, 'workspaces')
      await mkdir(workspace, { recursive: true })
      const cli = path.join(built.dist, 'node.js')
      const port = await vacantPort()
      let serving: ChildProcess | undefined
      try {
        const initialized = spawnSync(
          process.execPath,
          [
            cli,
            'init',
            '--data-root',
            root,
            '--label',
            'Home',
            '--name',
            'home.local',
            '--workspace-root',
            workspace,
            '--listen',
            '127.0.0.1',
            '--port',
            String(port),
          ],
          { encoding: 'utf8' },
        )
        expect(initialized.status).toBe(0)
        const child = spawn(process.execPath, [cli, 'serve', '--data-root', root], {
          stdio: ['ignore', 'pipe', 'inherit'],
        })
        serving = child
        const exited = new Promise<number | null>((resolve) => {
          child.once('exit', (code) => {
            resolve(code)
          })
        })
        const fingerprint = await new Promise<string>((resolve, reject) => {
          let text = ''
          child.stdout.setEncoding('utf8')
          child.stdout.on('data', (part: string) => {
            text += part
            const line = text
              .split('\n')
              .find((entry) => entry.startsWith('Certificate fingerprint: '))
            if (line !== undefined) resolve(line)
          })
          void exited.then((code) => {
            reject(new Error(`serve exited early with ${String(code)}`))
          })
        })
        const certificate = await readFile(
          path.join(root, NODE_TLS_DIRECTORY, NODE_TLS_CERT_FILE),
          'utf8',
        )
        expect(fingerprint).toBe(
          `Certificate fingerprint: ${new X509Certificate(certificate).fingerprint256}`,
        )
        const answered = await new Promise<{ status: number; body: string }>((resolve, reject) => {
          const req = httpsRequest(
            {
              host: '127.0.0.1',
              port,
              servername: 'home.local',
              ca: certificate,
              path: '/node/dashboard/read',
              method: 'POST',
              agent: false,
              headers: {
                Host: `home.local:${String(port)}`,
                Origin: `https://home.local:${String(port)}`,
                'Sec-Fetch-Site': 'same-origin',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Dest': 'empty',
                'Content-Type': 'application/json',
              },
            },
            (response) => {
              let body = ''
              response.setEncoding('utf8')
              response.on('data', (part: string) => {
                body += part
              })
              response.on('end', () => {
                resolve({ status: response.statusCode ?? 0, body })
              })
            },
          )
          req.on('error', reject)
          req.end('{}')
        })
        expect(answered).toEqual({ status: 401, body: '{"code":"unauthenticated"}' })
        // Asynchronous: the serving child is ours, so it is reaped only while
        // this process's event loop runs, and stop waits for it to be gone.
        const stopped = await new Promise<number | null>((resolve) => {
          spawn(process.execPath, [cli, 'stop', '--data-root', root], { stdio: 'ignore' }).once(
            'exit',
            (code) => {
              resolve(code)
            },
          )
        })
        expect(stopped).toBe(0)
        expect(await exited).toBe(0)
      } finally {
        serving?.kill('SIGKILL')
        await rm(root, { recursive: true, force: true })
      }
    },
  )
  nodeNativeTest('the packaged CLI honors the image data-root variable', async () => {
    const root = await nodeTempRoot('m110-node-clienv-')
    const cli = path.join(built.dist, 'node.js')
    try {
      const initialized = spawnSync(
        process.execPath,
        [
          cli,
          'init',
          '--label',
          'Home',
          '--name',
          'home.local',
          '--workspace-root',
          path.join(root, 'ws'),
        ],
        { encoding: 'utf8', env: { ...process.env, MUSE_NODE_DATA_ROOT: root } },
      )
      expect(initialized.status).toBe(0)
      const status = spawnSync(process.execPath, [cli, 'status'], {
        encoding: 'utf8',
        env: { ...process.env, MUSE_NODE_DATA_ROOT: root },
      })
      expect(status.status).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
