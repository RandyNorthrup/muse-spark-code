import { EN } from '../../src/shared/l10n/en'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as childProcess from 'node:child_process'
import * as z from 'zod/mini'
import { buildFixtureRepository } from './helpers/reporting/repository'
import {
  availableSource,
  buildSourceSnapshot,
  reportOptions,
  REPORT_FIXTURE_AS_OF,
} from './helpers/reporting/snapshot'
import { changeSelections } from './helpers/reporting/collect'
import {
  renderAllFormats,
  reportTestCollector,
  testSelections,
  threeIndexOrders,
} from './helpers/reporting/render'
import { gitSource, type ReportGitIo } from '../../src/core/reporting/sources/git'
import { REPORT_GIT_MAX_COMMITS } from '../../src/shared/constants'
import { redactSecrets } from '../../src/core/redact'
import { createRuntimeReportSources } from '../../src/runtime/reporting/sources'

vi.mock(import('node:child_process'), { spy: true })
// Git metadata is a governed probe; the direct bounded execFile here still
// reaches node:child_process, whose calls this suite inspects.
vi.mock('../../src/core/resources/launcher', async (original) => {
  const { withFixtureCommand } = await import('./helpers/resources/fixtureLaunch')
  return withFixtureCommand(await original())
})

const context = () => ({
  reportText: EN,
  asOf: REPORT_FIXTURE_AS_OF,
  workspaceKey: 'fixture',
  options: reportOptions(),
  signal: new AbortController().signal,
})
function permutedGitIo(
  idsInOrder: readonly string[],
  rows: {
    log: (id: string) => string
    worktree: (id: string) => string
    tag: (id: string) => string
    merged: string
    branches: string
  },
): ReportGitIo {
  return {
    run: (args) => {
      let stdout = ''
      if (args.includes('--verify')) stdout = 'a'.repeat(40)
      else if (args.includes('log')) stdout = idsInOrder.map((id) => rows.log(id)).join('')
      else if (args.includes('worktree'))
        stdout = idsInOrder.map((id) => rows.worktree(id)).join('')
      else if (args.includes('refs/tags/')) stdout = idsInOrder.map((id) => rows.tag(id)).join('')
      else if (args.some((arg) => arg.startsWith('--merged='))) stdout = rows.merged
      else if (args.includes('for-each-ref')) stdout = rows.branches
      return Promise.resolve({ stdout, code: args.includes('symbolic-ref') ? 1 : 0 })
    },
  }
}
function gitRecordAt(id: string): string {
  return new Date(Date.parse(REPORT_FIXTURE_AS_OF) + (id.codePointAt(0) ?? 0)).toISOString()
}
describe('local Git report source', () => {
  let root: string
  let repo: Awaited<ReturnType<typeof buildFixtureRepository>>
  let io: ReportGitIo
  beforeAll(async () => {
    // Fixture paths are captured canonical: git reports canonical worktree
    // paths, so an aliased temporary root would otherwise never match.
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'm113-git-')))
    repo = await buildFixtureRepository(path.join(root, 'repository'))
    repo.git(['branch', 'm12/s'])
    repo.git(['tag', '-a', 'v0.14.3', '-m', 'Fixture annotated tag'])
    repo.git(['worktree', 'add', path.join(root, 'sibling'), 'm12/s'])
    io = {
      run: vi.fn<ReportGitIo['run']>((args) => {
        try {
          return Promise.resolve({ stdout: repo.git(args), code: 0 })
        } catch {
          return Promise.resolve({ stdout: '', code: 1 })
        }
      }),
    }
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })
  it('reads commits, files, peeled tags, merged branches and worktrees', async () => {
    const result = await gitSource(io, (text) =>
      text.replaceAll(root.replaceAll('\\', '/'), '~'),
    ).read(context())
    expect(result.record.status).toBe('ok')
    expect(result.data?.head).toBe(repo.head)
    expect(result.data?.defaultBranch).toBe('main')
    expect(result.data?.commits).toHaveLength(2)
    expect(result.data?.commits.find((row) => row.sha === repo.head)?.files).toEqual(['README.md'])
    expect(result.data?.tags.find((row) => row.name === 'v0.14.3')?.commit).toBe(repo.head)
    expect(result.data?.branches.find((row) => row.name === 'm12/0')?.merged).toBe(true)
    expect(result.data?.worktrees.map((row) => row.path)).toEqual(['~/repository', '~/sibling'])
  })
  it('keeps credentials and Git routing overrides out of every metadata child environment', async () => {
    const exec = vi.mocked(childProcess.execFile)
    exec.mockClear()
    const env = {
      PATH: process.env['PATH'],
      SystemRoot: process.env['SystemRoot'],
      TEMP: process.env['TEMP'],
      TMP: process.env['TMP'],
      META_API_KEY: 'synthetic-environment-marker',
      OTHER_API_KEY: 'synthetic-environment-marker',
      GIT_DIR: 'synthetic-route',
      GIT_WORK_TREE: 'synthetic-route',
      GIT_CONFIG_COUNT: '1',
    }
    const sources = createRuntimeReportSources({
      workspaceRoot: repo.root,
      homeDir: root,
      platform: process.platform,
      env,
      scrub: redactSecrets,
      enabledAgents: [],
      agentFiles: [],
    })
    const result = await sources.sources.git.read(context())
    expect(result.record.status).toBe('ok')
    expect(exec).toHaveBeenCalled()
    for (const call of exec.mock.calls) {
      const options: unknown = call[2]
      const parsed = z.object({ env: z.record(z.string(), z.optional(z.string())) }).parse(options)
      expect(Object.keys(parsed.env)).not.toContain('META_API_KEY')
      expect(Object.keys(parsed.env)).not.toContain('OTHER_API_KEY')
      expect(Object.keys(parsed.env)).not.toContain('GIT_DIR')
      expect(Object.keys(parsed.env)).not.toContain('GIT_WORK_TREE')
      expect(Object.keys(parsed.env)).not.toContain('GIT_CONFIG_COUNT')
      expect(parsed.env['GIT_OPTIONAL_LOCKS']).toBe('0')
      expect(parsed.env['GIT_TERMINAL_PROMPT']).toBe('0')
    }
  })
  it('is deterministic and scrubs commit subjects before returning facts', async () => {
    const canary = 'private-fixture-subject'
    const fake: ReportGitIo = {
      run: async (args, signal) => {
        const result = await io.run(args, signal)
        return {
          ...result,
          stdout: args.includes('log')
            ? result.stdout.replace('M110a0: fixture runtime', () => canary)
            : result.stdout,
        }
      },
    }
    const port = gitSource(fake, (text) =>
      redactSecrets(text, [canary]).replaceAll(root.replaceAll('\\', '/'), '~'),
    )
    const first = await port.read(context())
    expect(JSON.stringify(first)).not.toContain(canary)
    expect(first).toEqual(await port.read(context()))
  })
  it('produces byte-identical Git facts when shuffled records have tied scrubbed identities and paths', async () => {
    const ids = ['a', 'b', 'c']
    let expected: string | undefined
    for (const order of [ids, ids.toReversed(), [...ids.slice(1), ids[0] ?? '']]) {
      const fake = permutedGitIo(order, {
        log: (id) => `\0${id.repeat(40)}\0${REPORT_FIXTURE_AS_OF}\0Subject ${id}\0\n${id}.ts\0`,
        worktree: (id) =>
          `worktree /fixture/private-${id}\0HEAD ${id.repeat(40)}\0branch refs/heads/${id}\0\0`,
        tag: (id) =>
          `private-${id}\0${id.repeat(40)}\0\0${new Date(Date.parse(REPORT_FIXTURE_AS_OF) + (id.codePointAt(0) ?? 0)).toISOString()}\n`,
        merged: 'refs/heads/main\nrefs/heads/private-a\n',
        branches:
          `refs/heads/main\0${'a'.repeat(40)}\n` +
          order.map((id) => `refs/heads/private-${id}\0${id.repeat(40)}\n`).join(''),
      })
      const result = await gitSource(fake, (text) =>
        text.replaceAll(/private-[abc]|^[abc]{40}$/gu, '[redacted]'),
      ).read(context())
      expect(result.record.status).toBe('ok')
      expect(result.data?.commits).toHaveLength(ids.length)
      expect(result.data?.tags).toHaveLength(ids.length)
      expect(result.data?.branches).toHaveLength(ids.length + 1)
      expect(result.data?.worktrees).toHaveLength(ids.length)
      const bytes = JSON.stringify(result)
      expected ??= bytes
      expect(bytes).toBe(expected)
    }
  })
  it('renders byte-identical changes and project reports in every format for every commit order', async () => {
    // RVCM1131 finding 1: the tied-identity test above proves source facts
    // are stable, but only a rendered report certifies the report. This test
    // carries permuted Git inputs (distinct post-scrub identities, so every
    // collector row keeps a distinct key) through the production collector,
    // finalizer and all four renderers, for both the changes kind (commits)
    // and the project kind (tags surface as releases). Branches and
    // worktrees have no collector consumer today, so their order is proven
    // at the source level only; that boundary is recorded in
    // docs/certification/m113-s-local-sources.md.
    const ids = ['a', 'b', 'c']
    const collect = reportTestCollector({ ...testSelections(), ...changeSelections() })
    let expectedSource: string | undefined
    let expectedRenders: Record<string, string> | undefined
    for (const order of threeIndexOrders) {
      const idsInOrder = order.map((step) => ids[step] ?? 'a')
      const fake = permutedGitIo(idsInOrder, {
        log: (id) => `\0${id.repeat(40)}\0${gitRecordAt(id)}\0Render subject ${id}\0\n${id}.ts\0`,
        worktree: (id) =>
          `worktree /fixture/render-${id}\0HEAD ${id.repeat(40)}\0branch refs/heads/render/${id}\0\0`,
        tag: (id) => `render-tag-${id}\0${id.repeat(40)}\0\0${gitRecordAt(id)}\n`,
        merged: 'refs/heads/main\n',
        branches:
          `refs/heads/main\0${'a'.repeat(40)}\n` +
          idsInOrder.map((id) => `refs/heads/render/${id}\0${id.repeat(40)}\n`).join(''),
      })
      const result = await gitSource(fake, (text) =>
        text.replaceAll('private-render-canary', '[redacted]'),
      ).read(context())
      expect(result.record.status).toBe('ok')
      expect(result.data?.commits.map((row) => row.sha)).toEqual([
        'a'.repeat(40),
        'b'.repeat(40),
        'c'.repeat(40),
      ])
      const bytes = JSON.stringify(result)
      expectedSource ??= bytes
      expect(bytes).toBe(expectedSource)
      if (result.data === null) throw new Error('Missing test facts')
      const snapshot = buildSourceSnapshot({
        git: result,
        changelog: availableSource('changelog', {
          sections: [{ version: 'Unreleased', date: null, lines: ['Render change'] }],
        }),
      })
      const rendered: Record<string, string> = {}
      for (const kind of ['changes', 'project'] as const) {
        const document = collect(snapshot, reportOptions(kind))
        expect(document.header.contentHash).toMatch(/^[a-f0-9]{64}$/u)
        const formats = renderAllFormats(document)
        for (const [format, output] of Object.entries(formats)) {
          rendered[`${kind}/${format}`] = output
        }
      }
      expectedRenders ??= rendered
      expect(rendered).toEqual(expectedRenders)
    }
  })
  it('shows working-tree paths relative to the workspace before scrubbing', async () => {
    const result = await gitSource(io, redactSecrets, [repo.root]).read(context())
    expect(result.data?.worktrees.map((row) => row.path)).toEqual(['.', '../sibling'])
    expect(JSON.stringify(result.data?.worktrees)).not.toContain(root)
  })
  it('replaces an outside working tree under the home folder before revealing its account path', async () => {
    const fake: ReportGitIo = {
      run: async (args, signal) => {
        if (!args.includes('worktree')) return await io.run(args, signal)
        return {
          code: 0,
          stdout: `worktree C:\\Users\\Private\\worktrees\\child\0HEAD ${repo.head}\0branch refs/heads/m12/s\0\0`,
        }
      },
    }
    const result = await gitSource(fake, redactSecrets, [
      'C:/workspace/project',
      'C:/Users/Private',
    ]).read(context())
    expect(result.data?.worktrees[0]?.path).toBe('~/worktrees/child')
    expect(JSON.stringify(result.data?.worktrees)).not.toContain('Private')
  })
  it('resolves a workspace alias through git before displaying worktree paths', async () => {
    const fake: ReportGitIo = {
      run: async (args, signal) => {
        if (args.includes('--show-toplevel'))
          return { code: 0, stdout: '/private/var/fixture/repository\n' }
        if (args.includes('worktree'))
          return {
            code: 0,
            stdout: `worktree /private/var/fixture/repository\0HEAD ${repo.head}\0branch refs/heads/main\0\0worktree /private/var/fixture/sibling\0HEAD ${repo.head}\0branch refs/heads/m12/s\0\0`,
          }
        return await io.run(args, signal)
      },
    }
    const result = await gitSource(fake, redactSecrets, ['/var/fixture/repository']).read(context())
    expect(result.record.status).toBe('ok')
    expect(result.data?.worktrees.map((row) => row.path)).toEqual(['.', '../sibling'])
  })
  it('names a missing or enclosing repository rather than empty success', async () => {
    const missing = gitSource(
      { run: () => Promise.resolve({ stdout: '', code: 1 }) },
      (text) => text,
    )
    expect(await missing.read(context())).toMatchObject({
      record: { status: 'unavailable', reason: expect.any(String), observedAt: null },
      data: null,
    })
    const enclosing = gitSource(
      {
        run: (args, signal) =>
          args.includes('--show-prefix')
            ? Promise.resolve({ stdout: 'nested/\n', code: 0 })
            : io.run(args, signal),
      },
      (text) => text,
    )
    const observed1 = await enclosing.read(context())
    expect(observed1.record.status).toBe('unavailable')
  })
  it('requests the commit bound plus one and marks truncated evidence partial', async () => {
    const fake: ReportGitIo = {
      run: async (args, signal) => {
        const result = await io.run(args, signal)
        if (!args.includes('log')) return result
        expect(args).toContain(`--max-count=${String(REPORT_GIT_MAX_COMMITS + 1)}`)
        const row = `\0${repo.head}\0${REPORT_FIXTURE_AS_OF}\0Fixture\0\nREADME.md\0`
        return { stdout: row.repeat(REPORT_GIT_MAX_COMMITS + 1), code: 0 }
      },
    }
    const result = await gitSource(fake, (text) => text).read(context())
    expect(result.record).toMatchObject({ status: 'partial', reason: expect.any(String) })
    expect(result.data?.commits).toHaveLength(REPORT_GIT_MAX_COMMITS)
  })
  it('cancels before any process is started', async () => {
    const signal = AbortSignal.abort()
    const run = vi.fn<ReportGitIo['run']>()
    const observed2 = await gitSource({ run }, (text) => text).read({ ...context(), signal })
    expect(observed2.record.status).toBe('unavailable')
    expect(run).not.toHaveBeenCalled()
  })
  it('parses empty subjects and empty commits without confusing field and record separators', async () => {
    const fake: ReportGitIo = {
      run: async (args, signal) => {
        if (!args.includes('log')) return await io.run(args, signal)
        return {
          code: 0,
          stdout: `\0${repo.head}\0${REPORT_FIXTURE_AS_OF}\0\0\0${repo.first}\0${REPORT_FIXTURE_AS_OF}\0Fixture\0\nREADME.md\0`,
        }
      },
    }
    const result = await gitSource(fake, (text) => text).read(context())
    expect(result.record.status).toBe('ok')
    expect(result.data?.commits.find((row) => row.sha === repo.head)).toMatchObject({
      subject: '',
      files: [],
    })
    expect(result.data?.commits.find((row) => row.sha === repo.first)?.files).toEqual(['README.md'])
  })
  it('reads working trees from a bare shared repository without fabricating a HEAD for its storage', async () => {
    const fake: ReportGitIo = {
      run: async (args, signal) => {
        const result = await io.run(args, signal)
        return {
          ...result,
          stdout: args.includes('worktree')
            ? `worktree /fixture/storage.git\0bare\0\0${result.stdout}`
            : result.stdout,
        }
      },
    }
    const result = await gitSource(fake, (text) => text).read(context())
    expect(result.record.status).toBe('ok')
    expect(result.data?.worktrees).toHaveLength(2)
  })
})
