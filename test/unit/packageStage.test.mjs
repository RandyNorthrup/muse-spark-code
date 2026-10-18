import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  removePackageStage,
  stageFiles,
  writeStageReceipt,
} from '../../scripts/lib/packageStage.mjs'
import { readAcpStageReceipt } from '../../scripts/release-sbom.mjs'

const roots = []
const cwd = process.cwd()
afterEach(async () => {
  process.chdir(cwd)
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function stagedTree() {
  const root = await mkdtemp(path.join(tmpdir(), 'rel0190-package-stage-'))
  roots.push(root)
  const stage = path.join(root, 'dist', 'acp-package')
  for (const file of [
    'dist/acp.js',
    'dist/webview/shared.js',
    'schemas/exec-result-v1.schema.json',
  ]) {
    const target = path.join(stage, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, 'staged\n')
  }
  return stage
}

it('lists the staged files as sorted forward-slash paths', async () => {
  const stage = await stagedTree()
  expect(stageFiles(stage)).toEqual([
    'dist/acp.js',
    'dist/webview/shared.js',
    'schemas/exec-result-v1.schema.json',
  ])
})

it('writes the receipt the release SBOM reads after the stage is gone', async () => {
  const stage = await stagedTree()
  const receipt = path.join(path.dirname(path.dirname(stage)), 'acp-stage-files.json')
  writeStageReceipt(stage, receipt)
  const parsed = JSON.parse(await readFile(receipt, 'utf8'))
  expect(parsed).toEqual([
    'dist/acp.js',
    'dist/webview/shared.js',
    'schemas/exec-result-v1.schema.json',
  ])
  removePackageStage(stage)
  expect(existsSync(stage)).toBe(false)
  expect(JSON.parse(await readFile(receipt, 'utf8'))).toEqual(parsed)
})

it('removes the stage and tolerates its absence', async () => {
  const stage = await stagedTree()
  removePackageStage(stage)
  expect(existsSync(stage)).toBe(false)
  expect(() => removePackageStage(stage)).not.toThrow()
})

it('lets the release SBOM read the receipt after the stage is gone', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rel0190-package-stage-'))
  roots.push(root)
  process.chdir(root)
  const stage = path.join(root, 'stage')
  await mkdir(path.join(stage, 'dist'), { recursive: true })
  await writeFile(path.join(stage, 'dist', 'acp.js'), 'staged\n')
  await mkdir(path.join(root, 'dist'), { recursive: true })
  writeStageReceipt(stage, path.join('dist', 'acp-stage-files.json'))
  removePackageStage(stage)
  expect(readAcpStageReceipt().has('dist/acp.js')).toBe(true)
})

it('refuses the SBOM membership check without a packager receipt', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rel0190-package-stage-'))
  roots.push(root)
  process.chdir(root)
  expect(() => readAcpStageReceipt()).toThrow('run scripts/package-acp.mjs first')
  await mkdir(path.join(root, 'dist'), { recursive: true })
  await writeFile(path.join(root, 'dist', 'acp-stage-files.json'), '{"staged": true}\n')
  expect(() => readAcpStageReceipt()).toThrow('run scripts/package-acp.mjs again')
})
