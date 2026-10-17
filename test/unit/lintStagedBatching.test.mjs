import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import lintStaged from 'lint-staged'
import { expect, it } from 'vitest'
import { removeFolder } from './helpers/temporaryFolders'

it('batches all 123 merge files below the Windows command-shim limit', async () => {
  const hook = await readFile('.husky/pre-commit', 'utf8')
  const argumentLimit = /--max-arg-length\s+(\d+)/.exec(hook)?.[1]
  expect(argumentLimit).toBeDefined()
  const maximum = Number(argumentLimit)
  expect(maximum).toBeGreaterThan(0)
  expect(maximum).toBeLessThan(8191)
  const root = await mkdtemp(path.join(tmpdir(), 'left017-hook-'))
  try {
    const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
    git(['init', '--quiet'])
    git([
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '--allow-empty',
      '-m',
      'fixture',
    ])
    const folder = `src/${'long-directory-'.repeat(8)}`
    await mkdir(path.join(root, folder), { recursive: true })
    const files = Array.from({ length: 123 }, (_, index) => `${folder}/file-${index}.ts`)
    await Promise.all(files.map((file) => writeFile(path.join(root, file), 'export {}\n')))
    git(['add', '--', ...files])
    const recorder = path.join(root, 'record.cjs')
    await writeFile(
      recorder,
      String.raw`require('node:fs').appendFileSync('.git/batches.jsonl', JSON.stringify(process.argv.slice(2)) + '\n')`,
    )
    expect(
      await lintStaged({
        cwd: root,
        config: { '*.ts': `"${process.execPath}" "${recorder}"` },
        maxArgLength: maximum,
        concurrent: 1,
        quiet: true,
      }),
    ).toBe(true)
    const recorded = await readFile(path.join(root, '.git/batches.jsonl'), 'utf8')
    const batches = recorded
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(batches.length).toBeGreaterThan(1)
    expect(
      batches
        .flat()
        .map((file) => path.relative(root, file).replaceAll('\\', '/'))
        .toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(files.toSorted((left, right) => left.localeCompare(right)))
    for (const batch of batches)
      expect(batch.join(' ').length + recorder.length + process.execPath.length).toBeLessThan(8191)
  } finally {
    await removeFolder(root)
  }
})
