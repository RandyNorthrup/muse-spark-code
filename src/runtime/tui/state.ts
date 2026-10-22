import { stripVTControlCharacters } from 'node:util'
import { TUI_LIMITS, UI_TEXT } from '../../shared/constants'
import { formatUsd } from '../../shared/l10n/exactUsd'
import { fill, formatBytes, formatNumber, formatPercent, uiLocale } from '../../shared/l10n/text'
import type { TuiAsk, TuiEvent } from './protocol'

export interface TuiState {
  status: Extract<TuiEvent, { type: 'status' }> | undefined
  pairing: Extract<TuiEvent, { type: 'pairing' }> | undefined
  chat: Extract<TuiEvent, { type: 'chat' }>[]
  diff: Extract<TuiEvent, { type: 'diff' }> | undefined
  tasks: Extract<TuiEvent, { type: 'tasks' }>['items']
  asks: TuiAsk[]
}

export function initialTuiState(): TuiState {
  return { status: undefined, pairing: undefined, chat: [], diff: undefined, tasks: [], asks: [] }
}

/** Strip terminal controls, including OSC/CSI, C1 and bidi overrides. */
export function terminalText(value: string): string {
  return stripVTControlCharacters(value)
    .replaceAll(/\p{Cc}/gu, (char) => (char === '\n' ? char : ''))
    .replaceAll(/\p{Bidi_Control}/gu, '')
}

/** Grapheme boundaries preserve CJK, accents and joined emoji on edit/wrap. */
export function terminalGraphemes(value: string): string[] {
  return Array.from(
    new Intl.Segmenter(uiLocale(), { granularity: 'grapheme' }).segment(value),
    (item) => item.segment,
  )
}

export function reduceTuiEvent(state: TuiState, event: TuiEvent): void {
  switch (event.type) {
    case 'status': {
      state.status = event
      break
    }
    case 'pairing': {
      state.pairing = event
      break
    }
    case 'chat': {
      const previous = state.chat.find((item) => item.id === event.id && item.role === event.role)
      if (previous === undefined) state.chat.push({ ...event })
      else previous.text = event.delta ? previous.text + event.text : event.text
      let remaining = TUI_LIMITS.transcriptChars
      state.chat = state.chat
        .slice(-TUI_LIMITS.transcriptEntries)
        .toReversed()
        .filter((item) => {
          if (remaining === 0) return false
          item.text = item.text.slice(-remaining)
          remaining -= item.text.length
          return true
        })
        .toReversed()
      break
    }
    case 'diff': {
      state.diff = event
      break
    }
    case 'tasks': {
      state.tasks = event.items
      break
    }
    case 'ask': {
      const index = state.asks.findIndex((ask) => ask.id === event.ask.id)
      if (index === -1) {
        if (state.asks.length >= TUI_LIMITS.pendingAsks) throw new Error(UI_TEXT.tuiInvalidFrame)
        state.asks.push(event.ask)
      } else state.asks[index] = event.ask
      break
    }
    case 'settled': {
      state.asks = state.asks.filter((ask) => ask.id !== event.id)
      break
    }
  }
}

export function expireTuiState(state: TuiState, now: number): void {
  state.asks = state.asks.filter((ask) => ask.expiresAt > now)
  if (
    state.pairing?.setup !== null &&
    state.pairing?.setup !== undefined &&
    state.pairing.setup.expiresAt <= now
  ) {
    state.pairing = { ...state.pairing, setup: null }
  }
}

export function askChoices(ask: TuiAsk): { choice: 'once' | 'always' | 'deny'; label: string }[] {
  return [
    { choice: 'once', label: UI_TEXT.allowOnce },
    ...(ask.kind === 'paid' ? [{ choice: 'always' as const, label: UI_TEXT.paidAllowAlways }] : []),
    { choice: 'deny', label: UI_TEXT.paidDeny },
  ]
}

export function askLines(ask: TuiAsk): string[] {
  return [
    `${terminalText(ask.title)}: ${terminalText(ask.detail).replaceAll('\n', ' ')}`,
    ...(ask.kind === 'paid'
      ? [
          fill(UI_TEXT.tuiPaidCost, {
            price: terminalText(ask.price),
            budget: formatUsd(ask.dailyBudgetUsd, TUI_LIMITS.currencyDigits),
          }),
        ]
      : []),
    ...askChoices(ask).map((item, index) => `${formatNumber(index + 1)}. ${item.label}`),
  ]
}

export function statusLines(state: TuiState): string[] {
  const status = state.status
  return status === undefined
    ? [UI_TEXT.tuiConnecting]
    : [
        `${terminalText(status.node)}: ${status.attended ? UI_TEXT.tuiAttended : UI_TEXT.tuiUnattended}`,
        fill(UI_TEXT.tuiResources, {
          cpu: formatPercent(status.cpuPercent),
          memory: formatBytes(status.memoryBytes),
        }),
        status.sealed ? UI_TEXT.tuiSealed : UI_TEXT.tuiUnlocked,
      ]
}

export function pairingLines(state: TuiState): string[] {
  const pairing = state.pairing
  return pairing === undefined
    ? []
    : [
        fill(UI_TEXT.tuiFingerprint, { fingerprint: pairing.fingerprint }),
        ...(pairing.setup === null
          ? []
          : [fill(UI_TEXT.tuiSetupCode, { code: terminalText(pairing.setup.code) })]),
      ]
}

/** Each screen-reader event is one physical line; numbered choices stay visible. */
export function eventLine(event: TuiEvent, state: TuiState): string {
  let parts: string[]
  switch (event.type) {
    case 'status': {
      parts = statusLines(state)
      break
    }
    case 'pairing': {
      parts = pairingLines(state)
      break
    }
    case 'chat': {
      parts = [
        `${event.role === 'user' ? UI_TEXT.tuiYou : UI_TEXT.tuiAgent}: ${terminalText(event.text)}`,
      ]
      break
    }
    case 'diff': {
      parts = [`${terminalText(event.path)}: ${terminalText(event.patch)}`]
      break
    }
    case 'ask': {
      parts =
        state.asks[0]?.id === event.ask.id
          ? askLines(event.ask)
          : [`${UI_TEXT.queuedLabel}: ${terminalText(event.ask.title)}`]
      break
    }
    case 'settled': {
      const next = state.asks[0]
      parts = [UI_TEXT.tuiAnswered, ...(next === undefined ? [] : askLines(next))]
      break
    }
    case 'tasks': {
      parts = event.items.map(
        (item) => `${terminalText(item.title)} (${terminalText(item.status)})`,
      )
      break
    }
  }
  return terminalText(parts.join(' | ')).replaceAll('\n', ' ')
}
