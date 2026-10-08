import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { noticePackageDir } from '../../scripts/lib/noticesInput.mjs'

const roots = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function noticeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'rel0160-notices-'))
  roots.push(root)
  async function write(file, text) {
    const target = path.join(root, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, text)
  }
  // Retain the captured legacy inventory so its omission fails on the shared
  // chunk's notice, rather than on an unrelated missing fixture metafile.
  for (const name of ['acp', 'headless', 'exec', 'acpQuestions', 'runtimeQuestions'])
    await write(`dist/meta-acp/${name}.json`, JSON.stringify({ outputs: {} }))
  for (const name of [
    'runtimeEngine',
    'runtimeAccounting',
    'providerPolicy',
    'modelApiHooks',
    'modelApiMcp',
    'questionNotes',
    'mcpPool',
    'modelApiCodeIntel',
    'structuredSchema',
    'reference',
    'imageResizeWorker',
    'modelApi',
    'resourceGovernor',
    'resourceAdmission',
    'providers',
    'usageService',
    'usageCompanion',
    'usageWebview',
    'validation',
    'wire',
    'legalScan',
    'reviewer',
    'team',
    'teamRunners',
    'teamScheduler',
    'foreignHooks',
    'hookRuntime',
    'recorder',
    'searchWorker',
    'pageWorker',
  ])
    await write(`dist/meta/${name}.json`, JSON.stringify({ outputs: {} }))
  await write(
    'dist/meta/webview.json',
    JSON.stringify({
      outputs: {
        'dist\\webview\\shared.js': {
          inputs: { 'node_modules/micromark/index.js': { bytesInOutput: 1 } },
        },
        'dist/webview/main.js': {
          inputs: { 'node_modules/extension-only/index.js': { bytesInOutput: 1 } },
        },
      },
    }),
  )
  for (const name of ['micromark', 'extension-only']) {
    await write(
      `node_modules/${name}/package.json`,
      JSON.stringify({ name, version: '1.0.0', license: 'MIT' }),
    )
    await write(`node_modules/${name}/LICENSE`, 'Fixture licence text\n')
  }
  await write('native/openssl-NOTICE.txt', 'Fixture native attribution\n')
  await write('src/core/legal/data/NOTICE.md', 'Fixture dataset attribution\n')
  return { root, write }
}

function generate(root) {
  return spawnSync(
    process.execPath,
    [path.resolve('scripts/third-party-notices.mjs'), '--acp', 'NOTICES.txt'],
    {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: root },
    },
  )
}

it('notices physically staged shared-chunk dependencies and excludes extension-only outputs', async () => {
  const { root, write } = await noticeFixture()
  await write('dist/acp-package/dist/acp.js', '')
  await write('dist/acp-package/dist/webview/shared.js', '')
  const result = generate(root)
  expect(result.status, result.stderr).toBe(0)
  const text = await readFile(path.join(root, 'NOTICES.txt'), 'utf8')
  expect(text).toContain('micromark (MIT)')
  expect(text).not.toContain('extension-only (MIT)')
  expect(text).toContain('Fixture licence text')
})

it('refuses ACP notice generation without its bundle stage', async () => {
  const { root } = await noticeFixture()
  const result = generate(root)
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('ACP bundle stage is missing')
})

it('includes deferred validation licences using their real POSIX and Windows package paths', () => {
  expect(noticePackageDir('resource-validation:/repo/node_modules/zod/v4/mini/index.js')).toBe(
    '/repo/node_modules/zod',
  )
  expect(
    noticePackageDir(String.raw`resource-validation:C:\repo\node_modules\zod\v4\mini\index.js`),
  ).toBe('C:/repo/node_modules/zod')
  expect(noticePackageDir('node_modules/@muse-code/sdk/dist/index.js')).toBe(
    'node_modules/@muse-code/sdk',
  )
  expect(noticePackageDir('node_modules/a/node_modules/b/index.js')).toBe(
    'node_modules/a/node_modules/b',
  )
  expect(noticePackageDir('src/shared/resources.ts')).toBeUndefined()
})
