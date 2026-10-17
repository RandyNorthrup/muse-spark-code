import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parsePlaybookCommandLine } from '../../src/runtime/cliArgs'
import {
  changedPlaybookSettings,
  parsePlaybookCommand,
  playbookChangeSchema,
  runPlaybookCli,
  runPlaybookCommand,
} from '../../src/runtime/playbook/command'
import {
  playbookCounters,
  playbookNoteText,
  playbookRecordText,
  playbookText,
} from '../../src/runtime/playbook/text'
import { EN } from '../../src/shared/l10n/en'
import { PLAYBOOK_RECORD_MAX, REVIEW_FINDING_TEXT_MAX_CHARS } from '../../src/shared/constants'
import { TABLE_LOCALES } from '../../src/shared/l10n/locales'
import { formatDateTime, plural, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { loadUiTable } from '../../src/host/l10n'
import {
  surfacePort,
  surfacePriorityNotes,
  surfaceRound,
  surfaceSnapshot,
} from './playbookSurfaceFixtures'

afterEach(() => {
  setUiText(EN, 'en')
})

describe('M116 CLI and shared settings adapter', () => {
  it('runs all three CLI views without any model dependency', async () => {
    for (const view of ['status', 'record', 'settings']) {
      const command = parsePlaybookCommandLine(['playbook', view])
      expect(command).toEqual({ view })
      const writeStdout = vi.fn(),
        printError = vi.fn()
      expect(await runPlaybookCli([view], { port: surfacePort(), writeStdout, printError })).toBe(0)
      expect(writeStdout).toHaveBeenCalledOnce()
      expect(printError).not.toHaveBeenCalled()
    }
    expect(parsePlaybookCommandLine(['auth', 'status'])).toBeUndefined()
  })

  it('runs rule mutations through the CLI with the trusted scoped port', async () => {
    const port = surfacePort()
    for (const argv of [
      ['settings', 'offload', 'off', 'worker', 'maintenance'],
      ['settings', 'offload', 'on'],
      ['settings', 'patchRoundsMax', '1'],
    ]) {
      expect(await runPlaybookCli(argv, { port, writeStdout: vi.fn(), printError: vi.fn() })).toBe(
        0,
      )
    }
    expect(port.snapshot().settings.rules.offload.enabled).toBe(true)
    expect(port.snapshot().settings.patchRoundsMax).toBe(1)
  })

  it('requires a reason, forbids the safety switch, and refuses a raised ceiling', async () => {
    for (const argv of [
      ['settings', 'offload', 'off'],
      ['settings', 'offload', 'off', ' '.repeat(3)],
      ['settings', 'neverAround', 'off', 'reason'],
      ['settings', 'neverAround', 'on'],
      ['settings', 'patchRoundsMax', '3'],
      ['settings', 'patchRoundsMax', '0'],
      ['settings', 'offload', 'on', 'junk'],
      ['status', 'junk'],
      ['record', 'junk'],
      ['settings', 'patchRoundsMax', '1', 'junk'],
      ['unknown'],
    ]) {
      expect(parsePlaybookCommand(argv)).toBeUndefined()
      expect(
        await runPlaybookCli(argv, {
          port: surfacePort(),
          writeStdout: vi.fn(),
          printError: vi.fn(),
        }),
      ).toBe(2)
    }
    expect(
      playbookChangeSchema.safeParse({
        rule: 'offload',
        enabled: false,
        reason: 'migration',
        actor: 'owner',
        at: 0,
      }).success,
    ).toBe(false)
  })

  it('persists disabled reasons with trusted identity/time and can enable again', async () => {
    const port = surfacePort()
    const command = parsePlaybookCommand(['settings', 'offload', 'off', 'worker', 'maintenance'])
    expect(command).toBeDefined()
    if (command === undefined) throw new Error('missing command')
    const answer = await runPlaybookCommand(command, port)
    expect(answer.ok).toBe(true)
    expect(port.snapshot().settings.rules.offload).toEqual({
      enabled: false,
      actor: 'owner',
      at: 1_791_289_800_002,
      reason: 'worker maintenance',
    })
    expect(answer.text).toContain('owner')
    expect(answer.text).toContain(formatDateTime(1_791_289_800_002))
    expect(answer.text).toContain('worker maintenance')
    expect(port.snapshot().records.at(-1)?.kind).toBe('settings')
    expect(
      await runPlaybookCommand(
        { view: 'settings', change: { rule: 'offload', enabled: true } },
        port,
      ),
    ).toMatchObject({ ok: true })
    expect(port.snapshot().settings.rules.offload).toEqual({ enabled: true })
    expect(
      changedPlaybookSettings(port.snapshot().settings, { patchRoundsMax: 1 }, 'owner', 0)
        .patchRoundsMax,
    ).toBe(1)
  })

  it('bounds disable reasons and journal snapshots before presentation', async () => {
    expect(
      playbookChangeSchema.safeParse({
        rule: 'offload',
        enabled: false,
        reason: 'r'.repeat(REVIEW_FINDING_TEXT_MAX_CHARS + 1),
      }).success,
    ).toBe(false)
    const snapshot = surfaceSnapshot()
    const note = surfacePriorityNotes()[0]
    if (note === undefined) throw new Error('missing bounded-record fixture')
    snapshot.records = Array.from({ length: PLAYBOOK_RECORD_MAX + 1 }, () => ({
      kind: 'note',
      value: note,
    }))
    const port = { read: () => Promise.resolve(snapshot), change: () => Promise.resolve(snapshot) }
    expect(await runPlaybookCommand({ view: 'record' }, port)).toEqual({
      ok: false,
      text: UI_TEXT.playbookUnavailable,
    })
  })

  it('fails loudly for unavailable, malformed or failed journal reads and writes', async () => {
    for (const port of [
      undefined,
      {
        read: () => Promise.resolve({ ...surfaceSnapshot(), rawOutput: 'unexpected output' }),
        change: () => Promise.resolve({ ...surfaceSnapshot(), rawOutput: 'unexpected output' }),
      },
      { read: () => Promise.resolve({}), change: () => Promise.resolve({}) },
      {
        read: () => Promise.reject(new Error('private detail')),
        change: () => Promise.reject(new Error('private detail')),
      },
    ]) {
      const writeStdout = vi.fn(),
        printError = vi.fn()
      expect(await runPlaybookCli(['record'], { port, writeStdout, printError })).toBe(1)
      expect(writeStdout).not.toHaveBeenCalled()
      expect(printError).toHaveBeenCalledWith(UI_TEXT.playbookUnavailable)
      expect(
        await runPlaybookCommand(
          { view: 'settings', change: { rule: 'offload', enabled: true } },
          port,
        ),
      ).toEqual({ ok: false, text: UI_TEXT.playbookUnavailable })
    }
  })

  it('shows owner items first and retains stable module/class counts and caught outcomes', () => {
    const snapshot = surfaceSnapshot()
    snapshot.records.push(surfaceRound(1), {
      ...surfaceRound(2),
      value: {
        ...surfaceRound(2).value,
        module: { ...surfaceRound(2).value.module, key: 'src/renamed' },
      },
    })
    expect(playbookCounters(snapshot.records).map((count) => count.round)).toEqual([3, 3])
    const text = playbookText('status', snapshot)
    expect(text.indexOf(UI_TEXT.playbookNotes.classifierBlocked)).toBe(0)
    expect(text).toContain(UI_TEXT.playbookResolutions.caught)
    expect(text).not.toContain(UI_TEXT.playbookResolutions.impossible)
    expect(text).toContain(plural(UI_TEXT.playbookStrikeBadge, 3))
    expect(text).toContain(UI_TEXT.playbookSafetyAlwaysOn)
  })

  it('renders explicit override evidence and each redesign finding outcome', () => {
    const record = surfaceRound()
    record.value.answers.push({
      findingId: 'racy-claim',
      status: 'override',
      actor: 'lead',
      reason: 'owner-approved exception',
      at: 0,
    })
    record.value.resolution = [
      { findingId: 'racy-claim', outcome: 'caught', reason: 'guard catches it' },
    ]
    const text = playbookRecordText(record)
    for (const part of [
      UI_TEXT.playbookDispositions.override,
      'lead',
      'owner-approved exception',
      formatDateTime(0),
      UI_TEXT.playbookResolutions.caught,
      'guard catches it',
    ])
      expect(text).toContain(part)
  })

  it('puts failure notes before progress in both status and record', () => {
    const snapshot = surfaceSnapshot()
    const notes = surfacePriorityNotes()
    snapshot.records = [
      ...notes.map((value) => ({ kind: 'note' as const, value })),
      ...snapshot.records.filter((record) => record.kind === 'design'),
    ]
    const [progress, failure, owner] = notes.map((note) => playbookNoteText(note))
    if (progress === undefined || failure === undefined || owner === undefined)
      throw new Error('missing priority fixtures')
    for (const view of ['status', 'record'] as const) {
      const text = playbookText(view, snapshot)
      expect(text.indexOf(owner)).toBe(0)
      expect(text.indexOf(failure)).toBeGreaterThan(text.indexOf(owner))
      expect(text.indexOf(progress)).toBeGreaterThan(text.indexOf(failure))
      expect(text.indexOf(UI_TEXT.playbookResolutions.caught)).toBeLessThan(text.indexOf(progress))
    }
  })

  it('keeps design status current while the record preserves outcome history', () => {
    const snapshot = surfaceSnapshot()
    const design = snapshot.records.find((record) => record.kind === 'design')
    if (design?.kind !== 'design') throw new Error('missing design')
    snapshot.records.unshift({ kind: 'design', value: { ...design.value, outcome: 'pending' } })
    expect(playbookText('status', snapshot)).not.toContain(UI_TEXT.playbookDesignPending)
    expect(playbookText('status', snapshot)).toContain(UI_TEXT.playbookResolutions.caught)
    expect(playbookText('record', snapshot)).toContain(UI_TEXT.playbookDesignPending)
    expect(playbookText('record', snapshot)).toContain(UI_TEXT.playbookResolutions.caught)
  })

  it.each(TABLE_LOCALES)('reads %s at runtime for every surface', async (locale) => {
    await loadUiTable({
      language: locale,
      log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      readExtensionFile: (segments) =>
        readFile(new URL(`../../${segments.join('/')}`, import.meta.url), 'utf8'),
    })
    const snapshot = surfaceSnapshot()
    const text = playbookText('status', snapshot)
    expect(text).toContain(UI_TEXT.playbookTitle)
    expect(text).not.toContain(EN.playbookTitle)
    expect(text).toContain(UI_TEXT.playbookSafetyAlwaysOn)
    expect(text).toContain(plural(UI_TEXT.playbookStrikeBadge, 3))
    for (const record of snapshot.records)
      if (record.kind === 'note') expect(playbookNoteText(record.value)).not.toMatch(/\{\w+\}/u)
  })
})
