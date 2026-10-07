import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as childProcess from 'node:child_process'
import * as z from 'zod/mini'
import { buildFixtureRepository } from './helpers/reporting/repository'
import { reportOptions, REPORT_FIXTURE_AS_OF } from './helpers/reporting/snapshot'
import { gitSource, type ReportGitIo } from '../../src/core/reporting/sources/git'
import { REPORT_GIT_MAX_COMMITS } from '../../src/shared/constants'
import { redactSecrets } from '../../src/core/redact'
import { createRuntimeReportSources } from '../../src/runtime/reporting/sources'

vi.mock(import('node:child_process'), { spy: true })

const context = () => ({
  asOf: REPORT_FIXTURE_AS_OF,
  workspaceKey: 'fixture',
  options: reportOptions(),
  signal: new AbortController().signal,
})
describe('local Git report source', () => {
  let root: string
  let repo: Awaited<ReturnType<typeof buildFixtureRepository>>
  let io: ReportGitIo
  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'm113-git-'))
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
