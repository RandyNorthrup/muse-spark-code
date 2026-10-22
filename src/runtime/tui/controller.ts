import { TUI_LIMITS, UI_TEXT } from '../../shared/constants'
import { tuiEventSchema, type TuiAction, type TuiAsk, type TuiEvent } from './protocol'
import {
  askChoices,
  askLines,
  eventLine,
  expireTuiState,
  initialTuiState,
  reduceTuiEvent,
  terminalGraphemes,
  terminalText,
} from './state'

export type TuiView = 'chat' | 'diff' | 'tasks' | 'status'
const views: readonly TuiView[] = ['chat', 'diff', 'tasks', 'status']

/** Both surfaces use this controller; it has no model, grant store or timer. */
export class TuiController {
  private readonly sent = new Set<string>()
  private presented: TuiAsk | undefined
  private focused = false
  readonly state = initialTuiState()
  view: TuiView = 'chat'
  input = ''
  scroll = 0

  constructor(
    private readonly deps: {
      now(): number
      send(action: TuiAction): void
      changed(): void
      line(text: string): void
    },
  ) {}

  private answer(index: number): void {
    const displayed = this.state.asks[0]
    if (displayed === undefined || !this.focused || this.presented !== displayed) return
    this.tick()
    const ask = this.state.asks[0]
    if (ask !== displayed || this.sent.has(displayed.id)) return
    const item = askChoices(ask)[index]
    if (item === undefined) return
    this.deps.send({
      type: 'answer',
      id: ask.id,
      digest: ask.digest,
      expiresAt: ask.expiresAt,
      choice: item.choice,
    })
    // Keep the ask visible until authoritative settlement; never reuse a grant.
    this.sent.add(ask.id)
  }

  /** Presentation and input are separate: a hidden/replaced ask cannot answer. */
  presentAsk(ask: TuiAsk | undefined): void {
    const next = ask === this.state.asks[0] ? ask : undefined
    if (this.presented !== next) this.focused = false
    this.presented = next
  }

  blurAsk(): void {
    this.focused = false
  }

  receive(raw: TuiEvent): void {
    const event = tuiEventSchema.parse(raw)
    if (event.type === 'settled') this.sent.delete(event.id)
    reduceTuiEvent(this.state, event)
    this.tick(false)
    // Expired asks/codes are never announced, even if delivered late.
    if (event.type === 'ask' && event.ask.expiresAt <= this.deps.now()) return
    this.deps.line(eventLine(event, this.state))
  }

  tick(shouldAnnounce = true): void {
    const previous = this.state.asks[0]?.id
    expireTuiState(this.state, this.deps.now())
    for (const id of this.sent) {
      if (this.state.asks.every((ask) => ask.id !== id)) this.sent.delete(id)
    }
    const next = this.state.asks[0]
    if (this.presented !== next) {
      this.presentAsk(undefined)
      this.input = ''
    }
    if (shouldAnnounce && next !== undefined && previous !== next.id)
      this.deps.line(askLines(next).join(' | '))
    this.deps.changed()
  }

  /** Esc and Ctrl+C are handled before composer, approval or view input. */
  key(
    input: string,
    key: {
      escape?: boolean
      ctrl?: boolean
      return?: boolean
      tab?: boolean
      backspace?: boolean
      delete?: boolean
      upArrow?: boolean
      downArrow?: boolean
      pageUp?: boolean
      pageDown?: boolean
      pasted?: boolean
    } = {},
  ): void {
    if (
      input === '\u{1B}' ||
      input === '\u{3}' ||
      key.escape === true ||
      (input === 'c' && key.ctrl === true)
    ) {
      this.deps.send({ type: 'stop', scope: 'all' })
      this.input = ''
      this.blurAsk()
      this.deps.line(UI_TEXT.tuiStopRequested)
      this.deps.changed()
      return
    }
    if (key.tab === true) {
      if (this.state.asks.length > 0) {
        this.focused = key.pasted !== true && this.presented === this.state.asks[0]
      } else {
        this.view = views[(views.indexOf(this.view) + 1) % views.length] ?? 'chat'
        this.scroll = 0
      }
    } else if (key.upArrow === true || key.pageUp === true) this.scroll += 1
    else if (key.downArrow === true || key.pageDown === true)
      this.scroll = Math.max(0, this.scroll - 1)
    else if (this.state.asks.length > 0) {
      if (key.pasted !== true && key.ctrl !== true && /^[1-9]$/u.test(input))
        this.answer(Number(input) - 1)
      // Enter has no default; other typing never answers an ask.
    } else if (key.return === true) this.submit(this.input)
    else if (key.backspace === true || key.delete === true)
      this.input = terminalGraphemes(this.input).slice(0, -1).join('')
    else if (key.ctrl !== true)
      this.input = (this.input + terminalText(input).replaceAll('\n', '')).slice(
        0,
        TUI_LIMITS.inputChars,
      )
    this.deps.changed()
  }

  /** Screen-reader commands are linear; no raw-mode cursor or spinner. */
  submit(line: string): void {
    const command = line.trim()
    if (command === '/stop') this.key('', { escape: true })
    else if (['/chat', '/diff', '/tasks', '/status'].includes(command)) {
      const selected = views.find((view) => `/${view}` === command)
      if (selected !== undefined) this.view = selected
      this.deps.changed()
    } else if (this.state.asks.length > 0) {
      // Decisions come only from focused, individually decoded keys.
      this.tick()
    } else if (command !== '' && this.state.asks.length === 0) {
      if (command.length > TUI_LIMITS.inputChars) throw new Error(UI_TEXT.tuiInputTooLong)
      this.deps.send({ type: 'message', text: command })
      this.input = ''
    }
  }
}
