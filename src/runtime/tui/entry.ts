import { UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { parseTuiArgs } from './args'
import type { TuiWireBinding } from './protocol'
import { runTui, type TuiTerminal } from './run'
import { connectTuiSocket } from './socket'
import type { InkBinding } from './view'

/** T-LAUNCH's lazy entry: only the owning node's socket, never a model backend. */
export async function runLocalTui(deps: {
  argv: readonly string[]
  env: Readonly<Record<string, string | undefined>>
  socketPath: string
  uid: number | undefined
  signal: AbortSignal
  binding: TuiWireBinding
  ink: InkBinding | undefined
  terminal: TuiTerminal
  table: UiText
  locale: string
  now(): number
}): Promise<number> {
  setUiText(deps.table, deps.locale)
  const parsed = parseTuiArgs(deps.argv, deps.env)
  if (!parsed.ok) {
    deps.terminal.write(`${UI_TEXT.tuiUsage}\n`)
    return 2
  }
  return await runTui({
    options: parsed.options,
    ink: deps.ink,
    terminal: deps.terminal,
    now: () => deps.now(),
    connect: (receive) =>
      connectTuiSocket({
        socketPath: deps.socketPath,
        uid: deps.uid,
        signal: deps.signal,
        binding: deps.binding,
        receive,
      }),
  })
}
