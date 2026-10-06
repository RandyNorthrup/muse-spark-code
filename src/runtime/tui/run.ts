import { createElement } from 'react'
import { TUI_LIMITS, UI_TEXT } from '../../shared/constants'
import type { TuiOptions } from './args'
import { TuiController } from './controller'
import type { TuiConnect, TuiConnection } from './protocol'
import { lineView, TuiInputView, type InkBinding } from './view'
import { terminalText, terminalGraphemes } from './state'

export interface TuiTerminal {
  readonly isTTY: boolean
  dimensions(): { columns: number; rows: number }
  write(text: string): void
  /** Raw UTF-8 input in line mode; returns restoration/cleanup. */
  read(handler: (input: string) => void): () => void
  onResize(handler: () => void): () => void
  onInterrupt(handler: () => void): () => void
  onClose(handler: () => void): () => void
}

/** No fallback success: a missing renderer, broken socket or bad frame fails. */
export async function runTui(deps: {
  options: TuiOptions
  connect: TuiConnect
  terminal: TuiTerminal
  ink: InkBinding | undefined
  now(): number
}): Promise<number> {
  const isLinear = deps.options.screenReader || !deps.terminal.isTTY
  if (!isLinear && deps.ink === undefined) throw new Error(UI_TEXT.tuiRendererMissing)
  let connection: TuiConnection | undefined
  let screen: ReturnType<InkBinding['render']> | undefined
  let isActive = true
  const outcome = { failed: false }
  let lineInput = ''
  let isOverflow = false
  const protect = (operation: () => void) => {
    try {
      operation()
    } catch {
      outcome.failed = true
      connection?.close()
    }
  }
  const view = () => {
    if (deps.ink === undefined) throw new Error(UI_TEXT.tuiRendererMissing)
    return createElement(TuiInputView, {
      controller,
      ink: deps.ink,
      ...deps.terminal.dimensions(),
      noColor: deps.options.noColor,
    })
  }
  const controller = new TuiController({
    now: () => deps.now(),
    send: (action) => {
      protect(() => {
        if (connection === undefined) throw new Error(UI_TEXT.tuiDisconnected)
        connection.send(action)
      })
    },
    changed: () => {
      protect(() => {
        if (isActive && !isLinear) screen?.rerender(view())
      })
    },
    line: (text) => {
      protect(() => {
        if (isActive && isLinear)
          deps.terminal.write(`${terminalText(text).replaceAll('\n', ' ')}\n`)
      })
    },
  })
  const cleanups: (() => void)[] = []
  try {
    connection = await deps.connect((event) => {
      if (isActive) controller.receive(event)
    })
    if (isLinear) {
      deps.terminal.write(`${UI_TEXT.tuiLineKeys}\n`)
      cleanups.push(
        deps.terminal.read((input) => {
          protect(() => {
            for (const char of input) {
              if (char === '\u{1B}' || char === '\u{3}') {
                controller.key(char)
                lineInput = ''
                isOverflow = false
                continue
              }
              if (char === '\n' || char === '\r') {
                if (isOverflow) {
                  isOverflow = false
                  lineInput = ''
                  continue
                }
                const command = lineInput
                lineInput = ''
                controller.submit(command)
                if (command !== '/stop' && command.startsWith('/'))
                  deps.terminal.write(`${lineView(controller)}\n`)
              } else if (isOverflow) continue
              else if (char === '\u{7F}' || char === '\b')
                lineInput = terminalGraphemes(lineInput).slice(0, -1).join('')
              else {
                lineInput += terminalText(char)
                if (lineInput.length > TUI_LIMITS.inputChars) {
                  lineInput = ''
                  isOverflow = true
                  deps.terminal.write(`${UI_TEXT.tuiInputTooLong}\n`)
                }
              }
            }
          })
        }),
      )
    } else if (deps.ink !== undefined)
      screen = deps.ink.render(view(), { exitOnCtrlC: false, patchConsole: false })
    cleanups.push(
      deps.terminal.onResize(() => {
        protect(() => {
          if (!isLinear) screen?.rerender(view())
        })
      }),
      deps.terminal.onInterrupt(() => {
        controller.key('', { escape: true })
      }),
      deps.terminal.onClose(() => {
        connection?.close()
      }),
    )
    const timer = setInterval(() => {
      protect(() => {
        controller.tick()
      })
    }, TUI_LIMITS.refreshMs)
    cleanups.push(() => {
      clearInterval(timer)
    })
    await connection.closed
    return outcome.failed ? 1 : 0
  } catch {
    deps.terminal.write(`${UI_TEXT.tuiDisconnected}\n`)
    return 1
  } finally {
    isActive = false
    for (const cleanup of cleanups.toReversed()) cleanup()
    screen?.unmount()
    connection?.close()
    controller.state.pairing = undefined
    controller.state.asks = []
    lineInput = ''
  }
}
