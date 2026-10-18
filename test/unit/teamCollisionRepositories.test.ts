import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { format } from 'prettier'
import { mergeChangelog } from '../../src/core/team/merge/changelog'
import { formatMergedJsonTable, mergeJsonTable } from '../../src/core/team/merge/jsonTable'

// Ten real Git branches and thirty formatter tables require a bounded integration deadline.
const REAL_COLLISION_REPOSITORY_TIMEOUT_MS = 60_000

const logBase =
  '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Before tasks.\n\n## [1.0.0]\n\n### Fixed\n\n- Already released.\n'
const gitCommands: string[] = []
const fixture: {
  root: string
  template: string
  tables: string[]
  base: string
  branches: string[]
  setupCalls: number
} = {
  root: '',
  template: '',
  tables: [],
  base: '',
  branches: [],
  setupCalls: 0,
}

function tableBase(path: string): string {
  return `{\n  "10": "ten",\n  "2": "two",\n  "nested": { "kept": true, "file": ${JSON.stringify(path)} }\n}\n`
}

function git(root: string, args: readonly string[], input?: string): Promise<string> {
  gitCommands.push(args[0] ?? '')
  return new Promise((resolve, reject) => {
    const child = execFile(
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
      (error, stdout) => {
        if (error === null) resolve(stdout)
        else reject(new Error('git fixture command failed', { cause: error }))
      },
    )
    child.stdin?.end(input)
  })
}

// One `git fast-import` run creates every blob, tree, commit and ref below:
// the 36 git processes per repository this fixture used to start (a
// hash-object batch, an update-index plus write-tree per tree, a
// commit-tree per commit) exceed the 60 s hook deadline on Windows, where
// each process start costs seconds. Commit marks are numbered in order from
// FAST_IMPORT_COMMIT_MARK, so a commit names its parent in the same stream
// with commitMark.
const FAST_IMPORT_COMMIT_MARK = 1_000_001

function commitMark(index: number): string {
  return `:${String(FAST_IMPORT_COMMIT_MARK + index)}`
}

function fastImportStream(
  commits: readonly {
    readonly ref: string
    readonly message: string
    readonly from?: string
    readonly merges?: readonly string[]
    readonly files: ReadonlyMap<string, string>
  }[],
): string {
  const parts: string[] = []
  let blobMark = 0
  for (const [index, commit] of commits.entries()) {
    const entries: string[] = []
    for (const [file, text] of commit.files) {
      blobMark += 1
      parts.push(
        `blob\nmark :${String(blobMark)}\ndata ${String(Buffer.byteLength(text))}\n${text}\n`,
      )
      entries.push(`M 100644 :${String(blobMark)} ${file}`)
    }
    parts.push(
      [
        `commit ${commit.ref}`,
        `mark ${commitMark(index)}`,
        'author Test <test@example.invalid> 0 +0000',
        'committer Test <test@example.invalid> 0 +0000',
        `data ${String(Buffer.byteLength(commit.message))}\n${commit.message}`,
        ...(commit.from === undefined ? [] : [`from ${commit.from}`]),
        ...(commit.merges ?? []).map((parent) => `merge ${parent}`),
        ...entries,
      ].join('\n') + '\n',
    )
  }
  return parts.join('')
}

async function blobs(root: string, requests: readonly string[]): Promise<Map<string, string>> {
  const bytes = Buffer.from(await git(root, ['cat-file', '--batch'], requests.join('\n') + '\n'))
  const result = new Map<string, string>()
  let offset = 0
  for (const request of requests) {
    const end = bytes.indexOf('\n', offset)
    expect(end).toBeGreaterThanOrEqual(offset)
    const header = /^([a-f0-9]+) blob (\d+)$/.exec(bytes.subarray(offset, end).toString())
    expect(header, request).not.toBeNull()
    const length = Number(header![2])
    offset = end + 1
    result.set(request, bytes.subarray(offset, offset + length).toString())
    offset += length
    expect(bytes[offset], request).toBe(10)
    offset++
  }
  expect(offset).toBe(bytes.length)
  return result
}

beforeAll(async () => {
  fixture.root = await mkdtemp(nodePath.join(tmpdir(), 'm96cc-repositories-'))
  const template = nodePath.join(fixture.root, 'template')
  fixture.template = template
  await mkdir(template)
  const [languages, rootFiles] = await Promise.all([
    readdir(nodePath.join(process.cwd(), 'l10n')),
    readdir(process.cwd()),
  ])
  const tables = [
    ...languages.filter((name) => /^ui\..+\.json$/.test(name)).map((name) => `l10n/${name}`),
    'l10n/ui.en.json',
    ...rootFiles.filter((name) => /^package\.nls(?:\..+)?\.json$/.test(name)),
  ]
  fixture.tables = tables
  // English is JSON only in this fixture; the product's en.ts remains text.
  expect(tables).toHaveLength(30)
  await git(template, ['init', '-q', '-b', 'integration'])
  const baseFiles = new Map([
    ...tables.map((path) => [path, tableBase(path)] as const),
    ['CHANGELOG.md', logBase],
  ])
  const versions = [
    baseFiles,
    ...Array.from(
      { length: 10 },
      (_, task) =>
        new Map(
          [...baseFiles].map(([path, text]) => [
            path,
            path === 'CHANGELOG.md'
              ? text.replace('- Before tasks.', () => `- Before tasks.\n\n- Task ${String(task)}.`)
              : text
                  .replace(
                    '"10": "ten",',
                    () => `"10": "ten",\n  "task${String(task)}": ${String(task)},`,
                  )
                  .replace(
                    '"kept": true',
                    () => `"kept": true, "child${String(task)}": ${String(task)}`,
                  ),
          ]),
        ),
    ),
  ]
  await git(
    template,
    ['fast-import', '--quiet'],
    fastImportStream([
      { ref: 'refs/heads/integration', message: 'base', files: versions[0]! },
      ...versions.slice(1).map((files, task) => ({
        ref: `refs/heads/task-${String(task)}`,
        message: `task ${String(task)}`,
        from: commitMark(0),
        files,
      })),
    ]),
  )
  const revParse = await git(template, [
    'rev-parse',
    'refs/heads/integration',
    ...versions.slice(1).map((_, task) => `refs/heads/task-${String(task)}`),
  ])
  const refs = revParse.trim().split('\n')
  const base = refs[0]!
  fixture.base = base
  fixture.branches = refs.slice(1)
  await Promise.all(
    [...baseFiles].map(async ([path, text]) => {
      await mkdir(nodePath.dirname(nodePath.join(template, path)), { recursive: true })
      await writeFile(nodePath.join(template, path), text)
    }),
  )
  fixture.setupCalls = gitCommands.length
}, REAL_COLLISION_REPOSITORY_TIMEOUT_MS)

afterAll(async () => {
  if (fixture.root !== '') await rm(fixture.root, { recursive: true, force: true })
}, REAL_COLLISION_REPOSITORY_TIMEOUT_MS)

describe('team collisions in real Git repositories', () => {
  it(
    'lands ten committed branches across thirty tables and an intervening changelog release, testing the final formatter blobs',
    async () => {
      const { root: fixtureRoot, template, tables, base, branches } = fixture
      const commandStart = gitCommands.length
      const root = nodePath.join(await mkdtemp(nodePath.join(fixtureRoot, 'case-')), 'repo')
      await cp(template, root, { recursive: true })
      const formattedByText = new Map<string, Promise<string>>()
      const formatter = (text: string): Promise<string> => {
        let result = formattedByText.get(text)
        if (result === undefined) {
          result = format(text, { parser: 'json' })
          formattedByText.set(text, result)
        }
        return result
      }
      const paths = [...tables, 'CHANGELOG.md']
      const requests = [base, ...branches].flatMap((commit) =>
        paths.map((path) => `${commit}:${path}`),
      )
      const committed = await blobs(root, requests)
      const versions: Map<string, string>[] = []
      const testedHashes = new Map<string, string>()
      for (const [task, branch] of branches.entries()) {
        if (task === 5) {
          const text = await readFile(nodePath.join(root, 'CHANGELOG.md'), 'utf8')
          await writeFile(
            nodePath.join(root, 'CHANGELOG.md'),
            text.replace('## [Unreleased]', '## [Unreleased]\n\n## [1.2.0]'),
          )
        }
        const files = new Map<string, string>()
        await Promise.all(
          tables.map(async (path) => {
            const ours = await readFile(nodePath.join(root, path), 'utf8')
            const original = committed.get(`${base}:${path}`)!
            const theirs = committed.get(`${branch}:${path}`)!
            expect(original).toBe(tableBase(path))
            expect(theirs).toContain(JSON.stringify(path))
            const merged = mergeJsonTable(original, ours, theirs)
            expect(merged.kind).toBe('merged')
            if (merged.kind !== 'merged') throw new Error(JSON.stringify(merged))
            const formatted = await formatMergedJsonTable(
              { path: nodePath.join(root, path), base: original, ours, theirs, text: merged.text },
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
            files.set(path, formatted.text)
            testedHashes.set(path, testedHash)
          }),
        )
        const ours = await readFile(nodePath.join(root, 'CHANGELOG.md'), 'utf8')
        const theirs = committed.get(`${branch}:CHANGELOG.md`)!
        const merged = mergeChangelog(committed.get(`${base}:CHANGELOG.md`)!, ours, theirs)
        expect(merged.kind).toBe('merged')
        if (merged.kind !== 'merged') throw new Error(JSON.stringify(merged))
        await writeFile(nodePath.join(root, 'CHANGELOG.md'), merged.text)
        files.set('CHANGELOG.md', merged.text)
        versions.push(files)
      }
      await git(
        root,
        ['fast-import', '--quiet'],
        fastImportStream(
          versions.map((files, task) => ({
            ref: 'refs/heads/integration',
            message: `land ${String(task)}`,
            from: task === 0 ? base : commitMark(task - 1),
            merges: [`refs/heads/task-${String(task)}`],
            files,
          })),
        ),
      )
      const integration = 'integration'
      await git(root, ['checkout', '-q', '-f', 'integration'])
      const final = await blobs(
        root,
        paths.map((path) => `${integration}:${path}`),
      )
      await Promise.all(
        tables.map(async (path) => {
          const text = await readFile(nodePath.join(root, path), 'utf8')
          expect(text).toBe(final.get(`${integration}:${path}`))
          expect(text).toBe(await formatter(text))
          expect(createHash('sha256').update(text).digest('hex')).toBe(testedHashes.get(path))
          expect(text).toContain(`"file": ${JSON.stringify(path)}`)
          expect(text.indexOf('"10"')).toBeLessThan(text.indexOf('"2"'))
          for (let task = 0; task < 10; task++) {
            expect(text.match(new RegExp(`"task${String(task)}"`, 'g'))).toHaveLength(1)
            expect(text).toContain(`"task${String(task)}": ${String(task)}`)
            expect(text).toContain(`"child${String(task)}": ${String(task)}`)
            expect(text.indexOf(`"task${String(task)}"`)).toBeGreaterThan(text.indexOf('"10"'))
            expect(text.indexOf(`"task${String(task)}"`)).toBeLessThan(text.indexOf('"2"'))
          }
        }),
      )
      const changelog = await readFile(nodePath.join(root, 'CHANGELOG.md'), 'utf8')
      expect(changelog).toBe(final.get(`${integration}:CHANGELOG.md`))
      const [unreleased, released] = changelog.split('## [1.2.0]', 2)
      for (let task = 0; task < 10; task++) {
        expect(changelog.match(new RegExp(String.raw`Task ${String(task)}\.`, 'g'))).toHaveLength(1)
        expect(task < 5 ? released : unreleased).toContain(`- Task ${String(task)}.`)
      }
      expect(changelog).toContain('- Already released.')
      expect(await git(root, ['status', '--porcelain'])).toBe('')
      expect(
        fixture.setupCalls + gitCommands.length - commandStart,
        'plumbing template launch budget',
      ).toBeLessThan(80)
      expect(gitCommands).not.toContain('commit')
    },
    REAL_COLLISION_REPOSITORY_TIMEOUT_MS,
  )
})
