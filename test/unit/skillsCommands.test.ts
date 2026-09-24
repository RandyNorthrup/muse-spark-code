import { describe, expect, it } from 'vitest'
import type { ProcessResult } from '../../src/host/backend/sandboxSetup'
import {
  type ImportSkillsDeps,
  importSkills,
  type ManageSkillsDeps,
  manageSkills,
  type SkillPickItem,
} from '../../src/host/commands/skillsCommands'
import type { SkillImportSource } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'

const CATALOG = JSON.stringify({
  skills: [
    {
      id: 'bundled:grill',
      name: 'grill',
      description: 'Interview',
      scope: 'bundled',
      activation: 'on',
    },
    { id: 'user:caveman', name: 'caveman', description: 'Terse', scope: 'user', activation: 'off' },
    { id: 'foreign:x', name: 'x', description: 'x', scope: 'foreign', activation: 'on' },
  ],
})

function report(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    source: { type: 'claude', path: '/home/u/.claude/skills' },
    dry_run: true,
    candidates: [
      { id: 'codex-review', action: 'copy', valid: true },
      { id: 'broken', action: 'copy', valid: false },
    ],
    installed: [],
    quarantined: [],
    skipped: [],
    failed: [],
    ...overrides,
  })
}

const ok = (stdout: string): ProcessResult => ({ exitCode: 0, stdout, stderr: '' })

interface HarnessOptions {
  /** Answers each CLI run; undefined means the CLI is absent. */
  readonly cli?: (args: readonly string[]) => ProcessResult
  readonly picks?: (items: readonly SkillPickItem[]) => ReadonlySet<string> | undefined
  readonly source?: SkillImportSource | undefined
  readonly confirmsImport?: boolean
  readonly confirmsRestart?: boolean
  readonly isTrusted?: boolean
}

function harness(options: HarnessOptions = {}) {
  const runs: (readonly string[])[] = []
  const information: string[] = []
  const errors: string[] = []
  const shown: SkillPickItem[][] = []
  const confirmations: [string, string][] = []
  let restarts = 0
  let restartPrompts = 0
  const log = new FakeLogOutputChannel()
  const base = {
    runCli: (args: readonly string[]) => {
      if (options.cli === undefined) {
        return undefined
      }
      runs.push(args)
      return Promise.resolve(options.cli(args))
    },
    workspaceRoot: '/ws',
    isWorkspaceTrusted: () => options.isTrusted ?? true,
    showInformation: (message: string) => {
      information.push(message)
    },
    showError: (message: string) => {
      errors.push(message)
    },
    confirmRestart: () => {
      restartPrompts += 1
      return Promise.resolve(options.confirmsRestart ?? true)
    },
    restart: () => {
      restarts += 1
      return Promise.resolve()
    },
    log,
  }
  const manage: ManageSkillsDeps = {
    ...base,
    pickSkills: (items) => {
      shown.push([...items])
      return Promise.resolve(options.picks?.(items))
    },
  }
  const importing: ImportSkillsDeps = {
    ...base,
    pickSource: () => Promise.resolve('source' in options ? options.source : 'claude'),
    confirmImport: (message, detail) => {
      confirmations.push([message, detail])
      return Promise.resolve(options.confirmsImport ?? true)
    },
  }
  return {
    manage,
    importing,
    runs,
    information,
    errors,
    shown,
    confirmations,
    log,
    restarts: () => restarts,
    restartPrompts: () => restartPrompts,
  }
}

describe('manageSkills', () => {
  it('lists the toggleable skills checked by activation, applies the changes, offers the restart', async () => {
    const t = harness({
      cli: (args) => ok(args[1] === 'list' ? CATALOG : '{}'),
      picks: () => new Set(['user:caveman']),
    })
    await manageSkills(t.manage)
    expect(t.shown).toEqual([
      [
        {
          id: 'bundled:grill',
          label: 'grill',
          description: 'built-in',
          detail: 'Interview',
          picked: true,
        },
        {
          id: 'user:caveman',
          label: 'caveman',
          description: 'yours',
          detail: 'Terse',
          picked: false,
        },
      ],
    ])
    expect(t.runs).toEqual([
      ['skills', 'list', '--workspace', '/ws', '--trust-workspace', '--json'],
      [
        'skills',
        'disable',
        'grill',
        '--scope',
        'built-in',
        '--workspace',
        '/ws',
        '--trust-workspace',
        '--json',
      ],
      [
        'skills',
        'enable',
        'caveman',
        '--scope',
        'user',
        '--workspace',
        '/ws',
        '--trust-workspace',
        '--json',
      ],
    ])
    expect(t.restarts()).toBe(1)
    expect(t.information).toEqual([
      'Muse Code restarted with the new skills; your next message continues the conversation.',
    ])
    expect(t.errors).toEqual([])
  })

  it('says so when the CLI is missing, the list fails or cannot be read', async () => {
    const missing = harness()
    await manageSkills(missing.manage)
    expect(missing.errors).toEqual([
      'Managing skills needs the Muse Code CLI, which is not installed.',
    ])
    const failing = harness({
      cli: () => ({ exitCode: 2, stdout: '', stderr: 'malformed settings file\nat line 3' }),
    })
    await manageSkills(failing.manage)
    expect(failing.errors).toEqual(['Muse Code could not list its skills: malformed settings file'])
    expect(failing.shown).toEqual([])
    const garbled = harness({ cli: () => ok('Skills: 26 loaded') })
    await manageSkills(garbled.manage)
    expect(garbled.errors[0]).toMatch(/^Muse Code could not list its skills: .*not JSON/)
    const silent = harness({ cli: () => ({ exitCode: 1, stdout: '', stderr: '' }) })
    await manageSkills(silent.manage)
    expect(silent.errors).toEqual(['Muse Code could not list its skills: exit code 1'])
  })

  it('does nothing on dismissal and reports an unchanged pick', async () => {
    const dismissed = harness({ cli: () => ok(CATALOG), picks: () => undefined })
    await manageSkills(dismissed.manage)
    expect(dismissed.runs).toHaveLength(1)
    expect(dismissed.information).toEqual([])
    const unchanged = harness({ cli: () => ok(CATALOG), picks: () => new Set(['bundled:grill']) })
    await manageSkills(unchanged.manage)
    expect(unchanged.runs).toHaveLength(1)
    expect(unchanged.information).toEqual(['No skills changed.'])
    expect(unchanged.restartPrompts()).toBe(0)
  })

  it('reports each change the CLI refused and restarts only for the ones it made', async () => {
    // The list and the enable work; the disable is refused.
    const answers: Record<string, ProcessResult> = {
      list: ok(CATALOG),
      disable: { exitCode: 1, stdout: '', stderr: 'settings file is read-only' },
      enable: ok('{}'),
    }
    const partly = harness({
      cli: (args) => answers[args[1] ?? ''] ?? ok(''),
      picks: () => new Set(['user:caveman']),
      confirmsRestart: false,
    })
    await manageSkills(partly.manage)
    expect(partly.errors).toEqual(['Muse Code could not change grill: settings file is read-only'])
    expect(partly.restartPrompts()).toBe(1)
    expect(partly.restarts()).toBe(0)
    const none = harness({
      cli: (args) =>
        args[1] === 'list' ? ok(CATALOG) : { exitCode: 1, stdout: 'denied', stderr: '' },
      picks: () => new Set(['user:caveman']),
    })
    await manageSkills(none.manage)
    expect(none.errors).toEqual(['Muse Code could not change grill: denied; caveman: denied'])
    expect(none.restartPrompts()).toBe(0)
  })

  it('reports a CLI that disappears between the list and a change', async () => {
    const t = harness({ cli: () => ok(CATALOG), picks: () => new Set<string>() })
    const runCli = t.manage.runCli
    let calls = 0
    await manageSkills({
      ...t.manage,
      runCli: (args) => {
        calls += 1
        return calls === 1 ? runCli(args) : undefined
      },
    })
    expect(t.errors).toEqual([
      'Muse Code could not change grill: Managing skills needs the Muse Code CLI, which is not installed.',
    ])
  })
})

describe('importSkills', () => {
  it('previews, confirms with the candidates, imports, reports and offers the restart', async () => {
    const t = harness({
      cli: (args) =>
        ok(
          args.includes('--dry-run')
            ? report()
            : report({
                dry_run: false,
                candidates: [],
                installed: [{ id: 'codex-review' }],
                skipped: [{ id: 'broken', reason: 'invalid frontmatter' }],
                failed: [{ id: 'other' }],
              }),
        ),
    })
    await importSkills(t.importing)
    expect(t.runs).toEqual([
      ['skills', 'import', '--from', 'claude', '--scope', 'user', '--dry-run', '--json'],
      ['skills', 'import', '--from', 'claude', '--scope', 'user', '--json'],
    ])
    expect(t.confirmations).toEqual([
      [
        'Import these skills into your Muse Code skills?',
        'codex-review\nbroken (not valid, will be skipped)',
      ],
    ])
    expect(t.information[0]).toBe(
      'Imported 1: codex-review. 1 skipped: broken (invalid frontmatter). 1 failed: other',
    )
    expect(t.restarts()).toBe(1)
  })

  it('stops on dismissal, a declined confirmation, or nothing to import', async () => {
    const dismissed = harness({ cli: () => ok(report()), source: undefined })
    await importSkills(dismissed.importing)
    expect(dismissed.runs).toEqual([])
    const declined = harness({ cli: () => ok(report()), confirmsImport: false })
    await importSkills(declined.importing)
    expect(declined.runs).toHaveLength(1)
    const empty = harness({ cli: () => ok(report({ candidates: [] })), source: 'codex' })
    await importSkills(empty.importing)
    expect(empty.information).toEqual(['No skills to import from /home/u/.claude/skills.'])
    const unnamed = harness({
      cli: () => ok(report({ candidates: [], source: { type: 'codex', path: null } })),
      source: 'codex',
    })
    await importSkills(unnamed.importing)
    expect(unnamed.information).toEqual(['No skills to import from codex.'])
  })

  it('reports a failing or unreadable import, and nothing installed means no restart', async () => {
    const failing = harness({ cli: () => ({ exitCode: 3, stdout: '', stderr: 'no such source' }) })
    await importSkills(failing.importing)
    expect(failing.errors).toEqual(['Muse Code could not import skills: no such source'])
    const garbled = harness({ cli: () => ok('{}') })
    await importSkills(garbled.importing)
    expect(garbled.errors[0]).toMatch(/^Muse Code could not import skills: .*unexpected shape/)
    const nothing = harness({
      cli: (args) => ok(args.includes('--dry-run') ? report() : report({ dry_run: false })),
    })
    await importSkills(nothing.importing)
    expect(nothing.information).toEqual(['Imported 0: —'])
    expect(nothing.restartPrompts()).toBe(0)
    const lateFailure = harness({
      cli: (args) => ok(args.includes('--dry-run') ? report() : 'not json'),
    })
    await importSkills(lateFailure.importing)
    expect(lateFailure.errors[0]).toMatch(/not JSON/)
  })
})
