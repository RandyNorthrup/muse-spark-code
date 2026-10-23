import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdir, rm, stat } from 'node:fs/promises'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sharedUiText, sharedValidation } from '../../scripts/lib/deferredBundles.mjs'
import { nodeModule } from '../../src/runtime/node/bundle'
import { EN } from '../../src/shared/l10n/en'
import { nodeNativeTest, nodeTempRoot } from './helpers/nodeNative'

const built = { folder: '' }
beforeAll(async () => {
  built.folder = await nodeTempRoot('m110-node-bundle-')
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
    outfile: path.join(built.folder, 'validation.js'),
  })
  await build({
    ...options,
    entryPoints: ['src/shared/l10n/en.ts'],
    outfile: path.join(built.folder, 'uiText.js'),
  })
  await build({
    ...options,
    entryPoints: ['src/runtime/node/main.ts'],
    outfile: path.join(built.folder, 'node.js'),
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
  return { module: nodeModule(path.join(built.folder, 'node.js')), deps, lines }
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
    const run = spawnSync(process.execPath, [path.join(built.folder, 'node.js'), '--help'], {
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
      const cli = path.join(built.folder, 'node.js')
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
  nodeNativeTest('the packaged CLI honors the image data-root variable', async () => {
    const root = await nodeTempRoot('m110-node-clienv-')
    const cli = path.join(built.folder, 'node.js')
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
