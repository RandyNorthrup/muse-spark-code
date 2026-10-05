// The one line a run of steps folds under (M87, PLAN.md D66 item 3): what
// ran, in first-seen order, files and folders counted once, failures last,
// in the display language's plural forms and list.
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { loadUiTable } from '../../src/host/l10n'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import {
  isFinishedStep,
  type StepEntry,
  stepSummary,
  stepSummaryText,
} from '../../src/webview/stepSummary'
import { FakeLogOutputChannel } from './helpers/fakes'
import { tool } from './helpers/transcriptFixtures'

const thought: StepEntry = {
  kind: 'reasoning',
  id: 'r',
  parts: ['x'],
  isStreaming: false,
  startedAt: 0,
  durationMs: 1,
}

const text = (steps: readonly StepEntry[]) => stepSummaryText(stepSummary(steps))

/** Installs a shipped table through the real loader (PLAN.md D33). */
async function install(language: string): Promise<void> {
  await loadUiTable({
    language,
    readExtensionFile: () =>
      Promise.resolve(
        readFileSync(new URL(`../../l10n/ui.${language}.json`, import.meta.url), 'utf8'),
      ),
    log: new FakeLogOutputChannel(),
  })
}

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('stepSummary', () => {
  it('counts each kind in first-seen order, files by distinct path', () => {
    const summary = stepSummary([
      tool({ id: 'e1', tool: 'edit_file', args: '{"path":"a.ts"}' }),
      tool({ id: 's1', tool: 'powershell', args: '{"command":"ls"}' }),
      thought,
      tool({ id: 'e2', tool: 'write_file', args: '{"path":"b.ts","content":"x"}' }),
      tool({ id: 'e3', tool: 'edit_file', args: '{"path":"a.ts"}' }),
      tool({ id: 'r1', args: '{"path":"x.ts"}' }),
      tool({ id: 'r2', args: '{"path":"x.ts"}' }),
    ])
    expect(summary).toEqual({
      parts: [
        { kind: 'edited', count: 2 },
        { kind: 'ran', count: 1 },
        { kind: 'read', count: 1 },
      ],
      failed: 0,
    })
  })

  it('adds a pathless patch’s own file count, and a pathless read once each', () => {
    expect(
      stepSummary([
        tool({
          id: 'p',
          tool: 'apply_patch',
          args: '{}',
          patchSummary: { files: 3, added: 1, removed: 1 },
        }),
        tool({ id: 'q', tool: 'apply_patch', args: '{}' }),
        tool({ id: 'e', tool: 'edit_file', args: '{"path":"a.ts"}' }),
        tool({ id: 'r1', args: '{}' }),
        tool({ id: 'r2', args: 'not json' }),
      ]).parts,
    ).toEqual([
      { kind: 'edited', count: 5 },
      { kind: 'read', count: 2 },
    ])
  })

  it('counts the folders a search looked in, the workspace when it names none', () => {
    const search = (id: string, args: string) => tool({ id, tool: 'search', args })
    expect(
      stepSummary([
        search('a', '{"pattern":"x","paths":[]}'),
        search('b', '{"pattern":"y"}'),
        tool({ id: 'c', tool: 'list_files', args: '{}' }),
      ]).parts,
    ).toEqual([{ kind: 'searched', count: 1 }])
    expect(
      stepSummary([
        search('a', '{"pattern":"x","paths":["src","test"]}'),
        search('b', '{"pattern":"y","path":"src"}'),
        search('c', 'not json'),
        search('d', '{"paths":"src"}'),
      ]).parts,
    ).toEqual([{ kind: 'searched', count: 3 }])
  })

  it('counts commands, web searches and other tools by call, pages by address', () => {
    expect(
      stepSummary([
        tool({ id: 'w1', tool: 'web_search', args: '{"query":"a"}' }),
        tool({ id: 'f1', tool: 'web_fetch', args: '{"url":"https://a.example"}' }),
        tool({ id: 'f2', tool: 'mcp__ide__webFetch', args: '{"url":"https://a.example"}' }),
        tool({ id: 'w2', tool: 'web_search', args: '{"query":"b"}' }),
        tool({ id: 'm', tool: 'add_memory', args: '{"path":"n.md"}' }),
        tool({ id: 'g', tool: 'create_goal', args: '{"objective":"x"}' }),
        tool({ id: 'b1', tool: 'bash', args: '{"command":"a"}' }),
        tool({ id: 'b2', tool: 'bash', args: '{"command":"a"}' }),
      ]).parts,
    ).toEqual([
      { kind: 'searchedWeb', count: 2 },
      { kind: 'fetched', count: 1 },
      { kind: 'used', count: 2 },
      { kind: 'ran', count: 2 },
    ])
  })

  it('counts the failures, not an interruption, and names no thought', () => {
    expect(
      stepSummary([
        tool({ id: 'a', status: 'failed' }),
        tool({ id: 'b', status: 'rejected' }),
        tool({ id: 'c', status: 'interrupted' }),
        tool({ id: 'd', status: 'completed' }),
        thought,
      ]),
    ).toEqual({ parts: [{ kind: 'read', count: 1 }], failed: 2 })
    expect(stepSummary([thought, thought])).toEqual({ parts: [], failed: 0 })
  })

  it('knows a finished step: a tool no longer running, a thought no longer streaming', () => {
    expect(isFinishedStep(tool({ status: 'completed' }))).toBe(true)
    expect(isFinishedStep(tool({ status: 'failed' }))).toBe(true)
    expect(isFinishedStep(tool({ status: 'inProgress' }))).toBe(false)
    expect(isFinishedStep(thought)).toBe(true)
    expect(isFinishedStep({ ...thought, isStreaming: true })).toBe(false)
  })
})

describe('stepSummaryText', () => {
  const run = [
    tool({ id: 'e1', tool: 'edit_file', args: '{"path":"a.ts"}' }),
    tool({ id: 's1', tool: 'powershell', args: '{"command":"a"}' }),
    tool({ id: 's2', tool: 'powershell', args: '{"command":"b"}', status: 'failed' }),
  ]

  it('reads as a sentence in English: plural forms, a list, the first letter raised', () => {
    expect(
      text([
        tool({ id: 'e1', tool: 'edit_file', args: '{"path":"a.ts"}' }),
        tool({ id: 'e2', tool: 'edit_file', args: '{"path":"b.ts"}' }),
        tool({ id: 's1', tool: 'powershell', args: '{"command":"a"}' }),
        tool({ id: 'r1', args: '{"path":"x.ts"}' }),
        tool({ id: 'r2', args: '{"path":"y.ts"}' }),
        tool({ id: 'r3', args: '{"path":"z.ts"}' }),
      ]),
    ).toBe('Edited 2 files, ran a command, and read 3 files')
    expect(text(run)).toBe('Edited a file, ran 2 commands, and 1 failed')
    expect(text([thought])).toBe(UI_TEXT.thoughtDone)
  })

  it('reads as a sentence in the shipped German, Turkish and Japanese tables', async () => {
    await install('de')
    expect(text(run)).toBe('Eine Datei bearbeitet, 2 Befehle ausgeführt und 1 fehlgeschlagen')
    await install('tr')
    expect(text(run)).toBe('Bir dosya düzenlendi, 2 komut çalıştırıldı ve 1 başarısız')
    await install('ja')
    expect(text(run)).toBe('ファイル 1 件を編集、コマンド 2 件を実行、1 件が失敗')
  })

  it('starts lowercase mid-list in every shipped table, so only the first letter is raised', async () => {
    for (const language of [
      'cs',
      'de',
      'es',
      'fr',
      'hu',
      'it',
      'ja',
      'ko',
      'pl',
      'pt-br',
      'ru',
      'tr',
      'zh-cn',
      'zh-tw',
    ]) {
      await install(language)
      for (const [kind, forms] of Object.entries(UI_TEXT.stepSummary)) {
        for (const form of Object.values(forms)) {
          const first = form.codePointAt(0)
          const head = first === undefined ? '' : String.fromCodePoint(first)
          expect(head, `${language} ${kind}: ${form}`).toBe(head.toLocaleLowerCase(language))
        }
      }
    }
  })
})
