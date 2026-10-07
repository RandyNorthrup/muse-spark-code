import { describe, expect, it, vi } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { parseReportsArguments, reportArguments } from '../../src/runtime/reporting/reportsArgs'
import { runReportsCommand } from '../../src/runtime/reporting/reportsCommand'
import {
  REPORT_EXIT_CODES,
  REPORT_FAIL_ON,
  REPORT_FORMATS,
  REPORT_KINDS,
  UI_TEXT,
} from '../../src/shared/constants'
import { finalizeReport } from '../../src/core/reporting/render/canonical'
import { reportsHarness, REPORT_AS_OF } from './helpers/reporting/runtime'
import { RENDERERS, REPORT_THEME } from './reportRenderFixtures'

describe('M113 CLI routing and parsing', () => {
  it('keeps bare report and its problem alias byte-equivalent with every M93 option', () => {
    for (const args of [
      [],
      ['--out', 'report.md'],
      ['--description', 'project'],
      ['--no-events', '--no-facts'],
      ['--out', ''],
      ['--help'],
      ['--bogus'],
    ]) {
      expect(parseCommandLine(['report', 'problem', ...args])).toEqual(
        parseCommandLine(['report', ...args]),
      )
    }
    expect(parseCommandLine(['report', 'problem', 'project'])).toMatchObject({
      command: 'invalid',
      exitCode: 2,
    })
    for (const args of [
      ['project'],
      ['--format', 'json', 'project'],
      ['--from=x.json'],
      ['history'],
    ]) {
      expect(parseCommandLine(['report', ...args])).toEqual({ command: 'reports', args })
    }
  })

  it('accepts every kind, format and named scope', () => {
    for (const kind of REPORT_KINDS) {
      const scopes: Partial<Record<typeof kind, string[]>> = {
        milestone: ['m110a0'],
        release: ['v0.14.0'],
        estimate: ['finish', 'M113'],
      }
      const args = scopes[kind] ?? []
      expect(parseReportsArguments([kind, ...args]).kind).toBe(kind)
      expect(parseReportsArguments(['history', kind]).kind).toBe(kind)
    }
    for (const format of REPORT_FORMATS)
      expect(parseReportsArguments(['project', '--format', format]).format).toBe(format)
    expect(parseReportsArguments(['usage', '30d', '--by', 'model']).options).toMatchObject({
      scope: '30d',
      by: 'model',
    })
    expect(parseReportsArguments(['changes', 'since', 'v0.14.0']).options.scope).toBe('v0.14.0')
    expect(parseReportsArguments(['session', '--session', 'session-1']).options.sessionId).toBe(
      'session-1',
    )
    expect(
      parseReportsArguments(['playbook', '--module', 'src/**', '--milestone', 'M113']).options,
    ).toMatchObject({ module: 'src/**', milestone: 'M113' })
    expect(
      parseReportsArguments(['estimate', 'finish M113', '--by', '2026-11-01', '--fleet', 'optimum'])
        .options,
    ).toMatchObject({ deadline: '2026-11-01T23:59:59+00:00', fleet: 'optimum' })
    expect(parseReportsArguments(['issues', '--repo', 'owner/project']).options.scope).toBe(
      'owner/project',
    )
    for (const period of [
      'today',
      '7d',
      '30d',
      '90d',
      'week',
      'month',
      '2026-10',
      '2026-10-01..2026-10-06',
    ])
      expect(parseReportsArguments(['usage', period]).options.scope).toBe(period)
  })

  it('refuses malformed arguments and irrelevant or conflicting collection flags', () => {
    for (const args of [
      [],
      ['bogus'],
      ['project', 'extra'],
      ['milestone'],
      ['release'],
      ['usage', 'forever'],
      ['project', '--format', 'yaml'],
      ['project', '--lang', '???'],
      ['project', '--as-of', 'yesterday'],
      ['project', '--fail-on', 'all'],
      ['project', '--out', ''],
      ['project', '--session', 's'],
      ['session', '--by', 'model'],
      ['project', '--repo', 'a/b'],
      ['issues', '--repo', '../outside'],
      ['project', '--from', 'x.json', '--network'],
      ['project', '--from', 'x.json', '--as-of', REPORT_AS_OF],
      ['history', '--diff', 'previous'],
      ['history', '--format', 'html'],
    ])
      expect(() => parseReportsArguments(args), args.join(' ')).toThrow()
  })

  it('uses quotes without expanding Windows paths, variables or substitutions', () => {
    expect(reportArguments(String.raw`project --out "C:\Users\Owner\report file.md"`)).toEqual([
      'project',
      '--out',
      String.raw`C:\Users\Owner\report file.md`,
    ])
    expect(reportArguments(`estimate 'finish $HOME $(whoami)'`)).toEqual([
      'estimate',
      'finish $HOME $(whoami)',
    ])
    expect(() => reportArguments(`project --out 'unfinished`)).toThrow()
  })

  it('tokenizes report arguments with every slash-command whitespace separator', () => {
    for (const separator of ['\r\n', '\r', '\n', '\t', ' ', '\u{00A0}']) {
      expect(reportArguments(`project${separator}--format${separator}text`)).toEqual([
        'project',
        '--format',
        'text',
      ])
    }
  })
})

describe('M113 reports command', () => {
  it('renders all four formats exactly, with one injectable clock and no network by default', async () => {
    for (const format of REPORT_FORMATS) {
      const h = reportsHarness()
      expect(await runReportsCommand(['project', '--format', format], h.deps)).toBe(0)
      const options = h.generate.mock.calls[0]?.[0]
      expect(options).toMatchObject({ asOf: REPORT_AS_OF, network: false, full: false })
      expect(h.now).toHaveBeenCalledTimes(1)
      const expected = finalizeReport({
        ...h.document,
        header: { ...h.document.header, scope: '' },
      })
      expect(h.stdout.mock.calls[0]?.[0]).toBe(RENDERERS[format](expected, 'en', REPORT_THEME))
      expect(h.stderr).not.toHaveBeenCalled()
      expect(h.history.save).not.toHaveBeenCalled()
    }
  })

  it('passes --as-of, --full, --network and --lang without reading the clock', async () => {
    const h = reportsHarness()
    expect(
      await runReportsCommand(
        ['project', '--as-of', REPORT_AS_OF, '--full', '--network', '--lang', 'de'],
        h.deps,
      ),
    ).toBe(0)
    expect(h.now).not.toHaveBeenCalled()
    expect(h.generate.mock.calls[0]?.[0]).toMatchObject({ full: true, network: true })
    expect(h.stdout.mock.calls[0]?.[0]).toContain('locale de')
  })

  it('re-renders --from byte for byte without collection, clock or history writes', async () => {
    for (const format of REPORT_FORMATS) {
      const h = reportsHarness({ keepHistory: true })
      expect(await runReportsCommand(['--from', 'saved.json', '--format', format], h.deps)).toBe(0)
      expect(h.stdout.mock.calls[0]?.[0]).toBe(RENDERERS[format](h.document, 'en', REPORT_THEME))
      expect(h.generate).not.toHaveBeenCalled()
      expect(h.now).not.toHaveBeenCalled()
      expect(h.history.save).not.toHaveBeenCalled()
    }
  })

  it('refuses malformed, unredacted, tampered and wrong-kind saved input without echoing it', async () => {
    for (const document of [
      { password: 'CANARY-private-data' },
      {
        ...reportsHarness().document,
        header: { ...reportsHarness().document.header, scope: 'CANARY-private-data' },
      },
    ]) {
      const h = reportsHarness({ readSaved: () => Promise.resolve(document) })
      expect(await runReportsCommand(['project', '--from', 'x.json'], h.deps)).toBe(1)
      expect(h.stdout).not.toHaveBeenCalled()
      expect(h.stderr.mock.calls.flat().join('')).not.toContain('CANARY')
    }
    const h = reportsHarness()
    expect(await runReportsCommand(['session', '--from', 'project.json'], h.deps)).toBe(1)
  })

  it('returns all five exits with unavailable sources and semantic conditions', async () => {
    const normal = reportsHarness()
    expect(await runReportsCommand(['project'], normal.deps)).toBe(REPORT_EXIT_CODES.generated)
    const missing = reportsHarness({ services: {} })
    expect(await runReportsCommand(['project'], missing.deps)).toBe(REPORT_EXIT_CODES.failed)
    expect(missing.stderr).toHaveBeenCalledWith('Report kind project is not available yet.')
    expect(await runReportsCommand(['project', '--bogus'], reportsHarness().deps)).toBe(
      REPORT_EXIT_CODES.usage,
    )
    const notFound = reportsHarness({
      services: {
        generate: () => Promise.resolve({ status: 'notFound', id: 'M999', nearest: ['M113'] }),
      },
    })
    expect(await runReportsCommand(['milestone', 'M999'], notFound.deps)).toBe(
      REPORT_EXIT_CODES.notFound,
    )
    expect(notFound.stderr).toHaveBeenCalledWith('Not found: M999. Nearest matches: M113')
    for (const condition of REPORT_FAIL_ON) {
      const h = reportsHarness()
      const deps = { ...h.deps, services: { ...h.deps.services, conditions: () => [condition] } }
      expect(await runReportsCommand(['project', '--fail-on', condition], deps)).toBe(
        REPORT_EXIT_CODES.conditionHeld,
      )
      expect(h.stdout).toHaveBeenCalledTimes(1)
    }
    const strict = reportsHarness()
    expect(
      await runReportsCommand(
        ['project', '--strict', '--fail-on', 'blocked,channelLag', '--fail-on', 'ciFailing'],
        strict.deps,
      ),
    ).toBe(4)
    expect(strict.generate.mock.calls[0]?.[0].failOn).toEqual([
      'blocked',
      'channelLag',
      'ciFailing',
      'unavailable',
      'drift',
    ])
    const unavailable = reportsHarness({ services: {} })
    const doc = finalizeReport({
      ...unavailable.document,
      sources: unavailable.document.sources.map((source) =>
        source.id === 'git' ? { ...source, status: 'unavailable', reason: 'No git' } : source,
      ),
    })
    expect(
      await runReportsCommand(['--from', 'offline.json', '--fail-on', 'unavailable'], {
        ...unavailable.deps,
        readSaved: () => Promise.resolve(doc),
      }),
    ).toBe(4)
  })

  it('saves exact output and history only when requested, and fails a refused write', async () => {
    const h = reportsHarness({ keepHistory: true })
    expect(await runReportsCommand(['project', '--out', 'report.md'], h.deps)).toBe(0)
    expect(h.stdout).not.toHaveBeenCalled()
    expect(h.writeOut.mock.calls[0]?.[0]).toBe('report.md')
    expect(h.history.save).toHaveBeenCalledTimes(1)
    expect(await runReportsCommand(['--from', 'x.json', '--save'], h.deps)).toBe(0)
    expect(h.history.save).toHaveBeenCalledTimes(2)
    const refused = reportsHarness({ writeOut: () => Promise.reject(new Error('CANARY-path')) })
    expect(await runReportsCommand(['project', '--out', 'report.md'], refused.deps)).toBe(1)
    expect(refused.stderr).toHaveBeenCalledWith(UI_TEXT.reportUi.saveFailed)
    expect(refused.stdout).not.toHaveBeenCalled()
  })

  it('lists history deterministically and reports empty or missing history honestly', async () => {
    const h = reportsHarness()
    expect(await runReportsCommand(['history', 'project', '--format', 'json'], h.deps)).toBe(0)
    expect(JSON.parse(h.stdout.mock.calls[0]?.[0] ?? '')).toMatchObject([
      { id: 'saved-1', kind: 'project' },
    ])
    expect(h.generate).not.toHaveBeenCalled()
    const empty = reportsHarness({
      services: { history: { ...h.history, list: () => Promise.resolve([]) } },
    })
    expect(await runReportsCommand(['history'], empty.deps)).toBe(0)
    expect(empty.stdout).toHaveBeenCalledWith(`${UI_TEXT.reportUi.noHistory}\n`)
    expect(await runReportsCommand(['history'], reportsHarness({ services: {} }).deps)).toBe(1)
  })

  it('does not produce output or save a cancelled report', async () => {
    const abort = new AbortController()
    abort.abort()
    const h = reportsHarness({ signal: abort.signal, keepHistory: true })
    expect(await runReportsCommand(['project'], h.deps)).toBe(1)
    expect(h.generate).not.toHaveBeenCalled()
    expect(h.history.save).not.toHaveBeenCalled()
    expect(h.stdout).not.toHaveBeenCalled()
  })

  it('diffs an explicit saved file or the newest earlier report in the same scope', async () => {
    const h = reportsHarness()
    const before = finalizeReport({
      ...h.document,
      header: { ...h.document.header, scope: '', asOf: '2026-10-05T12:00:00+00:00' },
    })
    const compare = vi.fn<NonNullable<typeof h.deps.services.compare>>((from, to) => ({
      from: from.header,
      to: to.header,
      sections: [],
    }))
    const renderDiff = vi.fn<NonNullable<typeof h.deps.services.renderDiff>>(
      () => 'Rendered difference\n',
    )
    const history = {
      ...h.history,
      list: () =>
        Promise.resolve([
          { id: 'old', header: before.header },
          { id: 'foreign', header: { ...before.header, scope: 'other-workspace' } },
          { id: 'future', header: { ...before.header, asOf: '2026-10-07T12:00:00+00:00' } },
        ]),
      get: vi.fn(() => Promise.resolve(before)),
    }
    const deps = {
      ...h.deps,
      services: { ...h.deps.services, history, compare, renderDiff },
      readSaved: () => Promise.resolve(before),
    }
    expect(await runReportsCommand(['project', '--diff', 'previous'], deps)).toBe(0)
    expect(history.get).toHaveBeenCalledWith('project', 'old')
    expect(h.stdout).toHaveBeenLastCalledWith('Rendered difference\n')
    expect(
      await runReportsCommand(['project', '--diff', 'old.json', '--format', 'text'], deps),
    ).toBe(0)
    expect(renderDiff.mock.lastCall?.[1]).toBe('text')
    expect(compare).toHaveBeenCalledTimes(2)
    expect(
      await runReportsCommand(['project', '--diff', 'previous'], {
        ...deps,
        services: { ...deps.services, history: { ...history, list: () => Promise.resolve([]) } },
      }),
    ).toBe(1)
    expect(
      await runReportsCommand(['project', '--diff', 'old.json'], {
        ...deps,
        readSaved: () => Promise.resolve(h.document),
      }),
    ).toBe(1)
  })

  it('includes equal-asOf reports and selects by timestamp then latest saved sequence', async () => {
    const h = reportsHarness({ keepHistory: true })
    const first = finalizeReport({
      ...h.document,
      header: { ...h.document.header, scope: '', asOf: REPORT_AS_OF },
    })
    const second = finalizeReport({ ...first, sections: [] })
    const saved = new Map([
      ['a-first', first],
      ['z-second', second],
    ])
    const entries = [
      {
        id: 'earlier-time-last-save',
        header: { ...first.header, asOf: '2026-10-05T12:00:00+00:00' },
      },
      { id: 'z-second', header: second.header },
      { id: 'a-first', header: first.header },
      { id: 'future', header: { ...first.header, asOf: '2026-10-07T12:00:00+00:00' } },
      { id: 'foreign', header: { ...first.header, scope: 'other' } },
    ]
    const compare = vi.fn<NonNullable<typeof h.deps.services.compare>>((from, to) => ({
      from: from.header,
      to: to.header,
      sections: [],
    }))
    const history = {
      ...h.history,
      list: () => Promise.resolve(entries),
      get: vi.fn((_kind: string, id: string) => {
        const document = saved.get(id)
        if (document === undefined) throw new Error('Unexpected saved id')
        return Promise.resolve(document)
      }),
      save: vi.fn(() => {
        expect(history.get).toHaveBeenCalledWith('project', 'z-second')
        return Promise.resolve()
      }),
    }
    const deps = {
      ...h.deps,
      services: {
        ...h.deps.services,
        history,
        compare,
        renderDiff: () => 'Compared saved sequence\n',
      },
    }
    expect(
      await runReportsCommand(['project', '--as-of', REPORT_AS_OF, '--diff', 'previous'], deps),
    ).toBe(0)
    expect(compare.mock.calls[0]?.[0]).toEqual(second)
    expect(history.save).toHaveBeenCalledTimes(1)
    entries.splice(1, 1)
    history.save.mockResolvedValue()
    deps.services.renderDiff = () => `${UI_TEXT.reportUi.noChange}\n`
    expect(
      await runReportsCommand(['project', '--as-of', REPORT_AS_OF, '--diff', 'previous'], deps),
    ).toBe(0)
    expect(history.get.mock.lastCall).toEqual(['project', 'a-first'])
    expect(compare.mock.lastCall?.[0].header.contentHash).toBe(
      compare.mock.lastCall?.[1].header.contentHash,
    )
    expect(h.stdout.mock.lastCall?.[0]).toContain('No change since')
  })
})
