import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { format } from 'prettier'
import { mergeChangelog } from '../../src/core/team/merge/changelog'
import { formatMergedJsonTable, mergeJsonTable } from '../../src/core/team/merge/jsonTable'

const run = promisify(execFile)
const tableBase = '{\n  "10": "ten",\n  "2": "two",\n  "nested": { "kept": true }\n}\n'
const logBase =
  '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Before tasks.\n\n## [1.0.0]\n\n### Fixed\n\n- Already released.\n'

describe('team collisions in real Git repositories', () => {
  it('lands ten committed branches across thirty tables and an intervening changelog release, testing the final formatter blobs', async () => {
    const root = await mkdtemp(nodePath.join(tmpdir(), 'm96cc-repository-'))
    const formattedByText = new Map<string, Promise<string>>()
    const formatter = (text: string): Promise<string> => {
      let result = formattedByText.get(text)
      if (result === undefined) {
        result = format(text, { parser: 'json' })
        formattedByText.set(text, result)
      }
      return result
    }
    const git = async (...args: string[]): Promise<string> => {
      const result = await run(
        'git',
        [
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.invalid',
          '-c',
          'core.autocrlf=false',
          ...args,
        ],
        { cwd: root },
      )
      return args[0] === 'show' ? result.stdout : result.stdout.trim()
    }
    try {
      const languages = await readdir(nodePath.join(process.cwd(), 'l10n'))
      const translated = languages
        .filter((name) => /^ui\..+\.json$/.test(name))
        .map((name) => `l10n/${name}`)
      const rootFiles = await readdir(process.cwd())
      const manifest = rootFiles.filter((name) => /^package\.nls(?:\..+)?\.json$/.test(name))
      // The plan's thirty-table fixture includes an English JSON table. The
      // product itself uses en.ts, whose plain-text integration is Q's.
      const tables = [...translated, 'l10n/ui.en.json', ...manifest]
      expect(tables).toHaveLength(30)
      await Promise.all(
        tables.map(async (path) => {
          await mkdir(nodePath.dirname(nodePath.join(root, path)), { recursive: true })
          await writeFile(nodePath.join(root, path), tableBase)
        }),
      )
      await writeFile(nodePath.join(root, 'CHANGELOG.md'), logBase)
      await git('init', '-q')
      await git('add', '--', ...tables, 'CHANGELOG.md')
      await git('commit', '-qm', 'base')
      const base = await git('rev-parse', 'HEAD')
      const branches: string[] = []
      for (let task = 0; task < 10; task++) {
        await git('checkout', '-qb', `task-${String(task)}`, base)
        const text = tableBase
          .replace('"10": "ten",', () => `"10": "ten",\n  "task${String(task)}": ${String(task)},`)
          .replace('"kept": true', () => `"kept": true, "child${String(task)}": ${String(task)}`)
        await Promise.all(tables.map((path) => writeFile(nodePath.join(root, path), text)))
        await writeFile(
          nodePath.join(root, 'CHANGELOG.md'),
          logBase.replace('- Before tasks.', () => `- Before tasks.\n\n- Task ${String(task)}.`),
        )
        await git('add', '--', ...tables, 'CHANGELOG.md')
        await git('commit', '-qm', `task ${String(task)}`)
        branches.push(await git('rev-parse', 'HEAD'))
      }
      await git('checkout', '-qb', 'integration', base)
      for (const [task, branch] of branches.entries()) {
        if (task === 5) {
          const text = await readFile(nodePath.join(root, 'CHANGELOG.md'), 'utf8')
          await writeFile(
            nodePath.join(root, 'CHANGELOG.md'),
            text.replace('## [Unreleased]', '## [Unreleased]\n\n## [1.2.0]'),
          )
        }
        const branchTable = await git('show', `${branch}:${tables[0] ?? ''}`)
        const branchFiles = await git('ls-tree', '-r', '--name-only', branch)
        expect(branchFiles.split('\n')).toHaveLength(31)
        await Promise.all(
          tables.map(async (path) => {
            const ours = await readFile(nodePath.join(root, path), 'utf8')
            const theirs = branchTable
            const merged = mergeJsonTable(tableBase, ours, theirs)
            expect(merged.kind).toBe('merged')
            if (merged.kind !== 'merged') throw new Error(JSON.stringify(merged))
            const formatted = await formatMergedJsonTable(
              { path: nodePath.join(root, path), base: tableBase, ours, theirs, text: merged.text },
              (_path, text) => formatter(text),
            )
            expect(formatted.kind).toBe('merged')
            if (formatted.kind !== 'merged') throw new Error(JSON.stringify(formatted))
            const testedHash = createHash('sha256').update(formatted.text).digest('hex')
            await writeFile(nodePath.join(root, path), formatted.text)
            expect(
              createHash('sha256')
                .update(await readFile(nodePath.join(root, path)))
                .digest('hex'),
            ).toBe(testedHash)
          }),
        )
        const ours = await readFile(nodePath.join(root, 'CHANGELOG.md'), 'utf8')
        const theirs = await git('show', `${branch}:CHANGELOG.md`)
        const merged = mergeChangelog(logBase, ours, theirs)
        expect(merged.kind).toBe('merged')
        if (merged.kind !== 'merged') throw new Error(JSON.stringify(merged))
        await writeFile(nodePath.join(root, 'CHANGELOG.md'), merged.text)
        await git('add', '--', ...tables, 'CHANGELOG.md')
        await git('commit', '-qm', `land ${String(task)}`)
      }
      await Promise.all(
        tables.map(async (path) => {
          const text = await readFile(nodePath.join(root, path), 'utf8')
          expect(text).toBe(await formatter(text))
          for (let task = 0; task < 10; task++)
            expect(text.match(new RegExp(`"task${String(task)}"`, 'g'))).toHaveLength(1)
        }),
      )
      const changelog = await readFile(nodePath.join(root, 'CHANGELOG.md'), 'utf8')
      const [unreleased, released] = changelog.split('## [1.2.0]', 2)
      for (let task = 0; task < 10; task++)
        expect(task < 5 ? released : unreleased).toContain(`- Task ${String(task)}.`)
      expect(changelog).toContain('- Already released.')
      expect(await git('status', '--porcelain')).toBe('')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
