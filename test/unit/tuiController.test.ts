import { afterEach, describe, expect, it } from 'vitest'
import { TuiController } from '../../src/runtime/tui/controller'
import { tuiEventSchema, type TuiAction, type TuiAsk } from '../../src/runtime/tui/protocol'
import {
  askChoices,
  askLines,
  initialTuiState,
  reduceTuiEvent,
  terminalText,
} from '../../src/runtime/tui/state'
import { TUI_LIMITS, UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { parseTuiArgs } from '../../src/runtime/tui/args'
import { recordCalls } from './helpers/recordCalls'

const toolAsk: TuiAsk = {
  kind: 'tool',
  id: 'ask-1',
  digest: 'exact-action',
  expiresAt: 5000,
  title: 'Run check',
  detail: 'npm run check',
}
function fixture() {
  let now = 1000
  const sent = recordCalls<[TuiAction]>()
  const lines = recordCalls<[string]>()
  const changed = recordCalls<[]>()
  const controller = new TuiController({
    send: sent.fn,
    line: lines.fn,
    changed: changed.fn,
    now: () => now,
  })
  return {
    controller,
    sent: sent.calls,
    lines: lines.calls,
    time(value: number) {
      now = value
    },
  }
}
function focusAsk(controller: TuiController): void {
  controller.presentAsk(controller.state.asks[0])
  controller.key('', { tab: true })
}
afterEach(() => {
  setUiText(EN, 'en')
})

describe('M110 T controller and projections', () => {
  it('single-digit lines are ordinary chat when no ask is pending', () => {
    const f = fixture()
    f.controller.key('1')
    f.controller.key('', { return: true })
    f.controller.submit('2')
    expect(f.sent).toEqual([[{ type: 'message', text: '1' }], [{ type: 'message', text: '2' }]])
    expect(f.controller.input).toBe('')
  })
  it('streaming text replaces snapshots, merges deltas and stays bounded', () => {
    const { controller } = fixture()
    controller.receive({ type: 'chat', role: 'agent', id: 'm', text: 'hel', delta: false })
    controller.receive({ type: 'chat', role: 'agent', id: 'm', text: 'lo', delta: true })
    expect(controller.state.chat[0]?.text).toBe('hello')
    controller.receive({ type: 'chat', role: 'agent', id: 'm', text: 'complete', delta: false })
    expect(controller.state.chat[0]?.text).toBe('complete')
    for (let index = 0; index < 110; index++)
      controller.receive({
        type: 'chat',
        role: 'agent',
        id: String(index),
        text: 'x'.repeat(1000),
        delta: false,
      })
    expect(controller.state.chat.length).toBeLessThanOrEqual(TUI_LIMITS.transcriptEntries)
    expect(
      controller.state.chat.reduce((sum, item) => sum + item.text.length, 0),
    ).toBeLessThanOrEqual(TUI_LIMITS.transcriptChars)
    expect(controller.state.chat.at(-1)?.id).toBe('109')
  })
  it('never approves Enter, typing, an invalid choice or a repeated choice', () => {
    const f = fixture()
    f.controller.receive({ type: 'ask', ask: toolAsk })
    focusAsk(f.controller)
    f.controller.key('', { return: true })
    f.controller.key('yes')
    f.controller.key('9')
    expect(f.sent).toEqual([])
    f.controller.key('1')
    f.controller.key('1')
    f.controller.receive({ type: 'ask', ask: toolAsk })
    f.controller.key('1')
    expect(f.sent).toHaveLength(1)
    expect(f.sent).toContainEqual([
      {
        type: 'answer',
        id: toolAsk.id,
        digest: toolAsk.digest,
        expiresAt: toolAsk.expiresAt,
        choice: 'once',
      },
    ])
  })
  it('does not approve a different ask when the displayed ask expires', () => {
    const f = fixture()
    f.controller.receive({ type: 'ask', ask: toolAsk })
    focusAsk(f.controller)
    f.controller.receive({ type: 'ask', ask: { ...toolAsk, id: 'later', expiresAt: 9000 } })
    f.time(5000)
    f.controller.key('1')
    expect(f.sent).toEqual([])
    expect(f.controller.state.asks.map((ask) => ask.id)).toEqual(['later'])
    focusAsk(f.controller)
    f.controller.key('2')
    expect(f.sent).toContainEqual([expect.objectContaining({ id: 'later', choice: 'deny' })])
  })
  it('expired numeric line input never becomes a model message or answers the next ask', () => {
    const f = fixture()
    f.controller.receive({ type: 'ask', ask: toolAsk })
    f.time(5000)
    f.controller.submit('1')
    expect(f.sent).toEqual([])
  })
  it.each(['chat', 'diff', 'tasks', 'status'] as const)(
    'one-key Stop interrupts %s with an ask and draft active',
    (view) => {
      const f = fixture()
      f.controller.view = view
      f.controller.input = 'unsent draft'
      f.controller.receive({ type: 'ask', ask: toolAsk })
      f.controller.key('', { escape: true })
      f.controller.key('c', { ctrl: true })
      expect(f.sent).toEqual([[{ type: 'stop', scope: 'all' }], [{ type: 'stop', scope: 'all' }]])
      expect(f.controller.input).toBe('')
    },
  )
  it('paid choices are three equal explicit options with price and shared budget', () => {
    const f = fixture()
    const ask: TuiAsk = { ...toolAsk, kind: 'paid', price: '$0.04 per image', dailyBudgetUsd: 1 }
    expect(askChoices(ask).map((item) => item.choice)).toEqual(['once', 'always', 'deny'])
    expect(askLines(ask).join(' ')).toContain('$0.04 per image')
    expect(askLines(ask).join(' ')).toContain('$1.00')
    f.controller.receive({ type: 'ask', ask })
    expect(f.lines[0]?.[0]).toContain('3. Deny')
    focusAsk(f.controller)
    f.controller.key('2')
    expect(f.sent).toContainEqual([expect.objectContaining({ choice: 'always' })])
    expect(
      tuiEventSchema.safeParse({ type: 'ask', ask: { ...toolAsk, kind: 'paid' } }).success,
    ).toBe(false)
  })
  it('vault asks never acquire paid workspace grants; settlement removes only its ask', () => {
    const f = fixture()
    f.controller.receive({ type: 'ask', ask: { ...toolAsk, kind: 'vault' } })
    focusAsk(f.controller)
    f.controller.key('2')
    expect(f.sent).toContainEqual([expect.objectContaining({ choice: 'deny' })])
    f.controller.receive({ type: 'settled', id: 'unrelated' })
    expect(f.controller.state.asks).toHaveLength(1)
    f.controller.receive({ type: 'settled', id: toolAsk.id })
    expect(f.controller.state.asks).toEqual([])
  })
  it('shows the full certificate pin and never shows a late or expired setup code', () => {
    const f = fixture()
    const fingerprint = 'ab'.repeat(32)
    f.controller.receive({
      type: 'pairing',
      fingerprint,
      setup: { code: 'PAIR-CODE', expiresAt: 2000 },
    })
    expect(f.lines.at(-1)?.[0]).toContain(fingerprint)
    expect(f.lines.at(-1)?.[0]).toContain('PAIR-CODE')
    f.time(2000)
    f.controller.tick()
    expect(f.controller.state.pairing?.setup).toBeNull()
    f.controller.receive({
      type: 'pairing',
      fingerprint,
      setup: { code: 'LATE-CODE', expiresAt: 1500 },
    })
    expect(f.lines.at(-1)?.[0]).not.toContain('LATE-CODE')
    expect(
      tuiEventSchema.safeParse({ type: 'pairing', fingerprint: 'ab', setup: null }).success,
    ).toBe(false)
  })
  it('strips terminal injection and bidi overrides from every event line', () => {
    const f = fixture()
    const payload = '\u{1B}[2J\u{1B}]52;c;clipboard\u{7}hello\u{9B}\u{202E}\nnext'
    expect(terminalText(payload)).toBe('hello\nnext')
    f.controller.receive({ type: 'chat', id: 'm', role: 'agent', text: payload, delta: false })
    expect(f.lines[0]?.[0]).toBe('Agent: hello next')
  })
  it('bounds the ask queue and validates every projection before changing state', () => {
    const state = initialTuiState()
    for (let index = 0; index < TUI_LIMITS.pendingAsks; index++)
      reduceTuiEvent(state, { type: 'ask', ask: { ...toolAsk, id: String(index) } })
    expect(() => {
      reduceTuiEvent(state, { type: 'ask', ask: { ...toolAsk, id: 'over-cap' } })
    }).toThrow(UI_TEXT.tuiInvalidFrame)
    const f = fixture()
    expect(() => {
      f.controller.receive({
        type: 'status',
        node: 'test',
        attended: true,
        cpuPercent: -1,
        memoryBytes: 0,
        sealed: true,
      })
    }).toThrow()
    expect(f.controller.state.status).toBeUndefined()
  })
  it('reads the installed table at dispatch time and keeps unknown task statuses', () => {
    const f = fixture()
    setUiText({ ...EN, tuiStopRequested: 'Alles stoppen', tuiYou: 'Sie' }, 'de')
    f.controller.key('\u{1B}')
    expect(f.lines).toContainEqual(['Alles stoppen'])
    f.controller.receive({
      type: 'tasks',
      items: [{ id: 't', title: 'Compile', status: 'future-status' }],
    })
    expect(f.lines).toContainEqual(['Compile (future-status)'])
  })
  it('keyboard navigation, edit, backspace and Enter send a bounded draft', () => {
    const f = fixture()
    f.controller.key('abc')
    f.controller.key('', { backspace: true })
    f.controller.key('', { return: true })
    expect(f.sent).toContainEqual([{ type: 'message', text: 'ab' }])
    expect(f.controller.input).toBe('')
    f.controller.key('', { tab: true })
    expect(f.controller.view).toBe('diff')
    f.controller.key('', { upArrow: true })
    f.controller.key('', { downArrow: true })
    expect(f.controller.scroll).toBe(0)
    expect(() => {
      f.controller.submit('x'.repeat(TUI_LIMITS.inputChars + 1))
    }).toThrow(UI_TEXT.tuiInputTooLong)
    f.controller.key('x'.repeat(TUI_LIMITS.inputChars + 1))
    expect(f.controller.input).toHaveLength(TUI_LIMITS.inputChars)
  })
  it('strict arguments honour NO_COLOR presence and refuse remote/credential flags', () => {
    expect(parseTuiArgs(['--screen-reader'], { NO_COLOR: '' })).toEqual({
      ok: true,
      options: { screenReader: true, noColor: true },
    })
    expect(parseTuiArgs([], {})).toEqual({
      ok: true,
      options: { screenReader: false, noColor: false },
    })
    for (const argv of [
      ['--node', 'remote'],
      ['--key', 'canary'],
      ['positional'],
      ['--screen-reader=false'],
      ['--bypass'],
    ])
      expect(parseTuiArgs(argv, {}).ok).toBe(false)
  })
  it('repeated asks keep their queue position; line mode names only the active choices', () => {
    const f = fixture()
    f.controller.receive({ type: 'ask', ask: toolAsk })
    f.controller.receive({
      type: 'ask',
      ask: { ...toolAsk, id: 'second', title: 'Second request' },
    })
    expect(f.lines.at(-1)?.[0]).toBe('Queued: Second request')
    f.controller.receive({ type: 'ask', ask: toolAsk })
    expect(f.controller.state.asks.map((ask) => ask.id)).toEqual(['ask-1', 'second'])
    f.controller.receive({ type: 'settled', id: 'ask-1' })
    expect(f.lines.at(-1)?.[0]).toContain('Second request')
    expect(f.lines.at(-1)?.[0]).toContain(`1. ${UI_TEXT.allowOnce}`)
  })
  it('fresh numeric chat after timer expiry is sent as chat, never approval', () => {
    const f = fixture()
    f.controller.receive({ type: 'ask', ask: toolAsk })
    f.time(5000)
    f.controller.tick()
    f.controller.submit('1')
    expect(f.sent).toEqual([[{ type: 'message', text: '1' }]])
  })
  it('setup and paid projections reject oversized codes and invalid prices/budgets', () => {
    const fingerprint = 'a'.repeat(64)
    expect(
      tuiEventSchema.safeParse({
        type: 'pairing',
        fingerprint,
        setup: { code: 'x'.repeat(TUI_LIMITS.setupCodeChars + 1), expiresAt: 2000 },
      }).success,
    ).toBe(false)
    for (const ask of [
      { ...toolAsk, kind: 'paid', price: '', dailyBudgetUsd: 1 },
      { ...toolAsk, kind: 'paid', dailyBudgetUsd: 1 },
      { ...toolAsk, kind: 'paid', price: '$0.04' },
      { ...toolAsk, kind: 'paid', price: '$0.04', dailyBudgetUsd: -1 },
      { ...toolAsk, kind: 'paid', price: '$0.04', dailyBudgetUsd: Infinity },
    ])
      expect(tuiEventSchema.safeParse({ type: 'ask', ask }).success).toBe(false)
  })
  it('composer backspace removes a joined emoji as one grapheme', () => {
    const f = fixture()
    f.controller.key('hi👩‍💻')
    f.controller.key('', { backspace: true })
    expect(f.controller.input).toBe('hi')
  })
  it('projection caps bound task lists, streamed text, identifiers and expiry values', () => {
    const task = { id: 't', title: 'Build', status: 'pending' }
    expect(
      tuiEventSchema.safeParse({
        type: 'tasks',
        items: Array.from({ length: TUI_LIMITS.tasks + 1 }, () => task),
      }).success,
    ).toBe(false)
    expect(
      tuiEventSchema.safeParse({
        type: 'chat',
        id: 'm',
        role: 'agent',
        delta: false,
        text: 'x'.repeat(TUI_LIMITS.transcriptChars + 1),
      }).success,
    ).toBe(false)
    expect(
      tuiEventSchema.safeParse({
        type: 'chat',
        id: 'x'.repeat(TUI_LIMITS.inputChars + 1),
        role: 'agent',
        delta: false,
        text: 'text',
      }).success,
    ).toBe(false)
    expect(
      tuiEventSchema.safeParse({ type: 'ask', ask: { ...toolAsk, expiresAt: -1 } }).success,
    ).toBe(false)
  })
  it('bounds empty transcript entries and rejects invalid resource status', () => {
    const f = fixture()
    for (let index = 0; index <= TUI_LIMITS.transcriptEntries; index++)
      f.controller.receive({
        type: 'chat',
        id: String(index),
        role: 'agent',
        delta: false,
        text: '',
      })
    expect(f.controller.state.chat).toHaveLength(TUI_LIMITS.transcriptEntries)
    const status = {
      type: 'status',
      node: 'test',
      attended: true,
      cpuPercent: 0,
      memoryBytes: 0,
      sealed: true,
    }
    for (const invalid of [
      { ...status, cpuPercent: -1 },
      { ...status, cpuPercent: 100 + 1 },
      { ...status, memoryBytes: -1 },
    ])
      expect(tuiEventSchema.safeParse(invalid).success).toBe(false)
  })
})
