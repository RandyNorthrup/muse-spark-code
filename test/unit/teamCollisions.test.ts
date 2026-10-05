import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { SharedFiles, teamPathMatcher } from '../../src/core/team/sharedFiles'
import { teamSharedFilesConfigShape } from '../../src/core/team/teamConfig'
import { WaitForGraph } from '../../src/core/team/waitFor'
import {
  expandWriteSet,
  FileHintQuestions,
  WriteSetLeases,
  writeSetOverlap,
} from '../../src/core/team/writeSets'

const files = [
  'src/a.ts',
  'src/b.ts',
  'docs/a.md',
  'CHANGELOG.md',
  'package.nls.json',
  'l10n/ui.fr.json',
]
const shared = new SharedFiles()
const a = { taskId: 'a', attempt: 1 }
const b = { taskId: 'b', attempt: 1 }
const retired = { kind: 'proved', method: 'windowsJob' } as const
const plan = (writes: string[]) => expandWriteSet(writes, files)

describe('team collision leases', () => {
  it('serializes overlapping attempts, fills another lane, releases at retirement and reacquires for rework', () => {
    const leases = new WriteSetLeases('workspace', shared)
    expect(leases.acquire(a, plan(['src/a.ts'])).kind).toBe('acquired')
    expect(leases.acquire(b, plan(['src/a.ts']))).toMatchObject({
      kind: 'wait',
      holder: a,
      paths: ['src/a.ts'],
    })
    expect(leases.acquire({ taskId: 'c', attempt: 1 }, plan(['src/b.ts'])).kind).toBe('acquired')
    expect(leases.release(a, retired)).toBe(true)
    expect(leases.acquire(b, plan(['src/a.ts'])).kind).toBe('acquired')
    expect(leases.release(b, { kind: 'userDecision' })).toBe(true)
    expect(leases.acquire({ ...b, attempt: 2 }, plan(['src/a.ts'])).kind).toBe('acquired')
    expect(leases.release(b, retired)).toBe(false)
    expect(leases.acquire(b, plan(['src/a.ts'])).kind).toBe('stale')
    leases.release({ ...b, attempt: 2 }, retired)
    expect(leases.acquire(b, plan(['src/a.ts'])).kind).toBe('stale')
  })

  it('lets delegated children and pipeline steps share their parent lease', () => {
    const leases = new WriteSetLeases('workspace', shared)
    leases.acquire(a, plan(['src/a.ts']))
    const child = { taskId: 'child', attempt: 1 }
    const qa = { taskId: 'qa', attempt: 1 }
    expect(leases.acquire(child, plan(['src/a.ts']), 'serialize', a).kind).toBe('acquired')
    expect(leases.acquire(qa, plan(['src/a.ts']), 'serialize', a).kind).toBe('acquired')
    leases.release(a, retired)
    expect(leases.acquire(b, plan(['src/a.ts'])).kind).toBe('wait')
    leases.release(child, retired)
    leases.release(qa, retired)
    expect(leases.acquire(b, plan(['src/a.ts'])).kind).toBe('acquired')
    expect(
      leases.acquire({ taskId: 'lateChild', attempt: 1 }, plan(['src/a.ts']), 'serialize', a).kind,
    ).toBe('stale')
  })

  it('leases no undeclared paths, allows overlaps on request, grows free paths and predicts occupied growth', () => {
    const leases = new WriteSetLeases('workspace', shared)
    leases.acquire(a, expandWriteSet(undefined, files))
    expect(leases.snapshot()).toEqual([])
    leases.acquire(b, plan(['src/b.ts']))
    expect(leases.grow(a, 'src/new.ts').kind).toBe('acquired')
    expect(leases.grow(a, 'src/b.ts')).toEqual({ kind: 'conflict', holder: b, paths: ['src/b.ts'] })
    expect(leases.snapshot().find((lease) => lease.holder.taskId === a.taskId)?.paths).toEqual([
      'src/new.ts',
    ])
    expect(
      leases.acquire({ taskId: 'allowed', attempt: 1 }, plan(['src/b.ts']), 'allow').kind,
    ).toBe('acquired')
    expect(leases.grow({ ...a, attempt: 2 }, 'src/a.ts').kind).toBe('stale')
  })

  it('inherits a retired pipeline lineage while refusing late children and superseded parents', () => {
    const leases = new WriteSetLeases('workspace', shared)
    leases.acquire(a, plan(['src/a.ts']))
    const child = { taskId: 'child', attempt: 1 }
    leases.acquire(child, plan(['src/a.ts']), 'serialize', a)
    leases.release(a, retired)
    expect(
      leases.acquire({ taskId: 'qa', attempt: 1 }, plan(['src/a.ts']), 'serialize', a, 'pipeline')
        .kind,
    ).toBe('acquired')
    expect(
      leases.acquire({ taskId: 'late', attempt: 1 }, plan(['src/a.ts']), 'serialize', a).kind,
    ).toBe('stale')
    expect(
      leases.acquire(
        { taskId: 'foreign', attempt: 1 },
        plan(['src/b.ts']),
        'serialize',
        b,
        'pipeline',
      ).kind,
    ).toBe('stale')
    leases.release(child, retired)
    leases.release({ taskId: 'qa', attempt: 1 }, retired)
    leases.acquire({ ...a, attempt: 2 }, plan(['src/a.ts']))
    expect(
      leases.acquire(
        { taskId: 'superseded', attempt: 1 },
        plan(['src/a.ts']),
        'serialize',
        a,
        'pipeline',
      ).kind,
    ).toBe('stale')
  })

  it('clips roles, conservatively overlaps future prefixes, and makes whole-tree/in-place writers exclusive', () => {
    expect(expandWriteSet(['**'], files, ['docs/**']).paths).toEqual(['docs/a.md'])
    expect(expandWriteSet(['src/**'], files, ['docs/**']).patterns).toEqual([])
    expect(writeSetOverlap(plan(['src/new/**']), plan(['src/new/deep/*.ts']), shared)).not.toEqual(
      [],
    )
    expect(
      writeSetOverlap(
        expandWriteSet(['src/**'], [], ['src/a/**']),
        expandWriteSet(['src/**'], [], ['src/b/**']),
        shared,
      ),
    ).toEqual([])
    const leases = new WriteSetLeases('workspace', shared)
    expect(leases.acquire(a, expandWriteSet(['**'], files)).kind).toBe('acquired')
    expect(leases.snapshot()[0]?.exclusiveWriter).toBe(true)
    expect(leases.acquire(b, expandWriteSet(undefined, files), 'allow').kind).toBe('wait')
    leases.release(a, retired)
    leases.acquire(a, expandWriteSet([], files, undefined, true))
    // The retired attempt cannot be restarted; a fresh attempt owns in-place.
    expect(
      leases.acquire({ ...a, attempt: 2 }, expandWriteSet([], files, undefined, true)).kind,
    ).toBe('acquired')
    expect(leases.acquire(b, plan(['docs/a.md']))).toMatchObject({ kind: 'wait' })
    expect(() => expandWriteSet(['../escape.ts'], files)).toThrow()
    expect(() => expandWriteSet(['C:/escape.ts'], files)).toThrow()
    expect(expandWriteSet(['**/*'], files).exclusiveWriter).toBe(true)
    expect(() => leases.grow({ ...a, attempt: 2 }, '../escape.ts')).toThrow()
    const clipped = new WriteSetLeases('workspace', shared)
    clipped.acquire(a, expandWriteSet(['**'], files, ['docs/**']))
    expect(() => clipped.grow(a, 'src/a.ts')).toThrow()
  })

  it('transfers a quarantined attempt lease and refuses every stale release or growth', () => {
    const leases = new WriteSetLeases('workspace', shared)
    leases.acquire(a, plan(['src/a.ts']))
    expect(leases.transfer(a, { ...a, attempt: 2 })).toBe(true)
    expect(leases.release(a, retired)).toBe(false)
    expect(leases.grow(a, 'src/b.ts').kind).toBe('stale')
    expect(leases.transfer(a, { ...a, attempt: 3 })).toBe(false)
    expect(leases.snapshot()[0]?.holder.attempt).toBe(2)
  })

  it('preserves strict built-ins and user authority across overlapping repository rules', () => {
    const configured = new SharedFiles(
      [{ pattern: 'src/hot.json', kind: 'json-table' }],
      [
        { pattern: 'l10n/ui.fr.json', kind: 'text' },
        { pattern: 'src/**', kind: 'text' },
        { pattern: '**', kind: 'text' },
      ],
    )
    expect(configured.kind('l10n/ui.fr.json')).toBe('json-table')
    expect(configured.kind('src/hot.json')).toBe('json-table')
    expect(configured.kind('CHANGELOG.md')).toBe('changelog')
    expect(configured.kind('src/a.ts')).toBe('text')
    expect(
      new SharedFiles(
        [{ pattern: 'l10n/ui.fr.json', kind: 'text' }],
        [{ pattern: 'l10n/**', kind: 'json-table' }],
      ).kind('l10n/ui.fr.json'),
    ).toBe('text')
    expect(
      new SharedFiles(
        [],
        [
          { pattern: 'data/*.json', kind: 'json-table' },
          { pattern: 'data/**', kind: 'text' },
        ],
      ).kind('data/a.json'),
    ).toBe('json-table')
  })

  it('canonicalizes path aliases before leasing, role clipping, growth and hint matching', () => {
    for (const alias of [
      'src/./a.ts',
      'src//a.ts',
      '././src/a.ts',
      'src/tmp/../a.ts',
      String.raw`src\a.ts`,
    ]) {
      const leases = new WriteSetLeases('workspace', shared)
      const set = expandWriteSet([alias], ['src/./a.ts'], ['src//*.ts'])
      expect(set.paths).toEqual(['src/a.ts'])
      expect(set.patterns).toEqual(['src/a.ts'])
      expect(leases.acquire(a, set).kind).toBe('acquired')
      expect(leases.acquire(b, plan(['src/a.ts']))).toMatchObject({
        kind: 'wait',
        paths: ['src/a.ts'],
      })
      expect(leases.grow(a, 'src/tmp/../b.ts').kind).toBe('acquired')
      expect(leases.snapshot()[0]?.paths).toEqual(['src/a.ts', 'src/b.ts'])
      const questions = new FileHintQuestions().questions(
        '/repo',
        'ours',
        set,
        [
          {
            repository: '/repo',
            windowInstanceId: 'other',
            paths: [alias],
          },
        ],
        shared,
      )
      expect(questions[0]?.paths).toEqual(['src/a.ts'])
    }
    for (const outside of [
      '',
      '.',
      'src/..',
      'src/../../escape.ts',
      './C:/escape.ts',
      './C:/../escape.ts',
      './/C:/../escape.ts',
      'src/../C:/../escape.ts',
      String.raw`\\server\file`,
      '/escape.ts',
    ])
      expect(() => expandWriteSet([outside], files)).toThrow()
  })

  it('folds case consistently on insensitive filesystems and preserves sensitive distinctions', () => {
    const insensitive = new SharedFiles([], [], true)
    const upper = expandWriteSet(['SRC/A.TS'], [], ['src/**'], false, true)
    const lower = expandWriteSet(['src/a.ts'], [], undefined, false, true)
    const leases = new WriteSetLeases('workspace', insensitive)
    expect(upper.paths).toEqual(['src/a.ts'])
    expect(leases.acquire(a, upper).kind).toBe('acquired')
    expect(leases.acquire(b, lower).kind).toBe('wait')
    expect(leases.grow(a, 'SRC/B.TS').kind).toBe('acquired')
    expect(leases.snapshot()[0]?.paths).toEqual(['src/a.ts', 'src/b.ts'])
    expect(insensitive.kind('L10N/UI.FR.JSON')).toBe('json-table')
    expect(teamPathMatcher('src/A.ts', false)('src/a.ts')).toBe(false)
    expect(
      writeSetOverlap(
        expandWriteSet(['src/A.ts'], [], undefined, false, false),
        expandWriteSet(['src/a.ts'], [], undefined, false, false),
        new SharedFiles([], [], false),
      ),
    ).toEqual([])
  })

  it('exempts narrower merge-kind globs while leasing globs that can create ordinary files', () => {
    for (const pattern of [
      'l10n/ui.*.json',
      'l10n/ui.??.json',
      'l10n/ui.[a-z][a-z].json',
      'l10n/{ui.fr.json,ui.en.json}',
      'package.nls.*.json',
      'locales/fr/**/*.json',
      'locales/{fr,en}/**/*.json',
      'i18n/messages*.json',
    ])
      expect(writeSetOverlap(plan([pattern]), plan([pattern]), shared)).toEqual([])
    for (const pattern of ['l10n/*', 'l10n/**/*.json', 'l10n/{ui.fr.json,notes.md}', '**/*.json'])
      expect(writeSetOverlap(plan([pattern]), plan([pattern]), shared)).not.toEqual([])
    const override = new SharedFiles([{ pattern: 'l10n/ui.fr.json', kind: 'text' }])
    expect(
      writeSetOverlap(
        expandWriteSet(['l10n/ui.*.json'], []),
        expandWriteSet(['l10n/ui.*.json'], []),
        override,
      ),
    ).not.toEqual([])
    const repository = new SharedFiles([], [{ pattern: '**', kind: 'text' }])
    expect(writeSetOverlap(plan(['l10n/ui.*.json']), plan(['l10n/ui.*.json']), repository)).toEqual(
      [],
    )
    expect(() => shared.shouldSerializePattern(`l10n/${'{a,b}'.repeat(10)}.json`)).toThrow(
      RangeError,
    )
  })

  it('never serializes built-in JSON/changelog files, while declared text shared files serialize', () => {
    const configured = new SharedFiles([{ pattern: 'src/hot.ts', kind: 'text' }])
    expect(
      writeSetOverlap(
        plan(['CHANGELOG.md', 'package.nls.json', 'l10n/*.json']),
        plan(['CHANGELOG.md', 'package.nls.json', 'l10n/*.json']),
        configured,
      ),
    ).toEqual([])
    expect(configured.undeclaredTextFiles(['src/hot.ts', 'src/a.ts'], ['src/a.ts'])).toEqual([
      'src/hot.ts',
    ])
    expect(configured.undeclaredTextFiles(['src/hot.ts'], ['src/**'])).toEqual([])
    expect(configured.kind('src/shared/l10n/en.ts')).toBeUndefined()
    expect(teamPathMatcher('CHANGELOG.md')('nested/CHANGELOG.md')).toBe(false)
    expect(teamPathMatcher('src/A.ts')('src/a.ts')).toBe(
      process.platform === 'win32' || process.platform === 'darwin',
    )
    expect(configured.kind('locales/a/b.json')).toBe('json-table')
    expect(
      new SharedFiles([], [{ pattern: 'config.json', kind: 'json-table' }]).kind('config.json'),
    ).toBe('json-table')
    expect(() => new SharedFiles([], [{ pattern: 'l10n/*.json', kind: 'text' }])).toThrow()
    const schema = z.strictObject(teamSharedFilesConfigShape)
    expect(
      schema.safeParse({ sharedFiles: [{ pattern: 'docs/hot.md', kind: 'text' }] }).success,
    ).toBe(true)
    expect(schema.safeParse({ sharedFiles: [{ pattern: 'a', kind: 'union' }] }).success).toBe(false)
    expect(schema.safeParse({ runner: 'repo-controlled' }).success).toBe(false)
  })

  it('asks once per fresh hint collision, skips key/bullet files and expires dropped collisions', () => {
    const questions = new FileHintQuestions()
    const hint = {
      windowInstanceId: 'other',
      repository: '/repo/.git',
      paths: ['src/a.ts', 'l10n/ui.fr.json'],
    }
    const set = plan(['src/**', 'l10n/*.json'])
    const first = questions.questions('/repo/.git', 'ours', set, [hint], shared)
    expect(first[0]?.paths).toEqual(['src/a.ts'])
    questions.answer(first[0]!, 'wait')
    expect(questions.questions('/repo/.git', 'ours', set, [hint], shared)[0]?.answer).toBe('wait')
    expect(questions.questions('/different', 'ours', set, [hint], shared)).toEqual([])
    expect(questions.questions('/repo/.git', 'ours', set, [hint], shared)[0]?.answer).toBe('wait')
    questions.answer(first[0]!, 'continue')
    expect(
      questions.questions(
        '/repo/.git',
        'ours',
        set,
        [{ ...hint, paths: [...hint.paths, 'src/b.ts'] }],
        shared,
      )[0]?.answer,
    ).toBeUndefined()
    expect(questions.questions('/repo/.git', 'other', set, [hint], shared)).toEqual([])
  })

  it('retains Continue and Wait for live hints across unrelated tasks, repositories and windows', () => {
    for (const answer of ['continue', 'wait'] as const) {
      const questions = new FileHintQuestions()
      const hint = {
        repository: '/repo',
        windowInstanceId: 'other',
        paths: ['src/./a.ts', 'src/b.ts'],
      }
      const ask = (writes: string[], hints = [hint]) =>
        questions.questions('/repo', 'ours', plan(writes), hints, shared)
      questions.answer(ask(['src/a.ts'])[0]!, answer)
      expect(ask(['src/b.ts'])[0]?.answer).toBeUndefined()
      questions.questions('/different', 'ours', plan(['src/a.ts']), [], shared)
      expect(
        questions.questions('/repo', 'third', plan(['src/a.ts']), [hint], shared)[0]?.answer,
      ).toBeUndefined()
      expect(ask(['src/a.ts'])[0]?.answer).toBe(answer)
      expect(ask(['src/**'])[0]?.answer).toBeUndefined()
      questions.answer(ask(['src/**'])[0]!, answer)
      expect(ask(['src/a.ts'])[0]?.answer).toBe(answer)
      expect(ask(['src/**'], [{ ...hint, paths: ['src/a.ts'] }])[0]?.answer).toBe(answer)
      expect(ask(['src/b.ts'])[0]?.answer).toBeUndefined()
      ask(['src/a.ts'], [])
      expect(ask(['src/a.ts'])[0]?.answer).toBeUndefined()
      expect(ask(['src/a.ts'], [{ ...hint, windowInstanceId: 'new' }])[0]?.answer).toBeUndefined()
    }
  })
})

describe('team wait graph', () => {
  it('refuses a newer cycle across leases, dependencies, children and slots atomically', () => {
    const graph = new WaitForGraph()
    expect(graph.replace('a', [{ holder: 'b', kind: 'lease' }]).kind).toBe('accepted')
    graph.add('b', { holder: 'c', kind: 'dependency' })
    graph.add('c', { holder: 'd', kind: 'child' })
    expect(graph.add('d', { holder: 'a', kind: 'slot' })).toEqual({
      kind: 'cycle',
      cycle: ['d', 'a', 'b', 'c', 'd'],
    })
    expect(graph.holdersOf('d')).toEqual([])
    graph.remove('c')
    expect(graph.add('d', { holder: 'a', kind: 'slot' }).kind).toBe('accepted')
    expect(graph.holdersOf('b')).toEqual([])
    expect(graph.replace('self', [{ holder: 'self', kind: 'slot' }])).toEqual({
      kind: 'cycle',
      cycle: ['self', 'self'],
    })
  })
})
