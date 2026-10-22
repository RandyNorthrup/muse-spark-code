import { createElement } from 'react'
import { TUI_LIMITS, UI_TEXT } from '../../shared/constants'
import type { TuiOptions } from './args'
import { TuiController } from './controller'
import type { TuiAsk, TuiConnect, TuiConnection } from './protocol'
import { approvalLines, lineView, TuiInputView, type InkBinding } from './view'
import { terminalText, terminalGraphemes } from './state'

export interface TuiTerminal {
  readonly isTTY: boolean
  dimensions(): { columns: number; rows: number }
  write(text: string, displayed?: () => void): void
  discardInput(): void
  flush(): Promise<void>
  /** Raw UTF-8 input for both surfaces; returns restoration/cleanup. */
  read(handler: (input: string) => void): () => void
  onResize(handler: () => void): () => void
  onInterrupt(handler: () => void): () => void
  onClose(handler: (isFailed: boolean) => void): () => void
}

// Teardown races and dead pipes end the run; anything else reports after shutdown.
function isRoutineTuiFailure(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPIPE') ||
    (error instanceof Error && error.message === UI_TEXT.tuiDisconnected)
  )
}

// Connection failures end the run as disconnected; anything else reports after shutdown.
function isExpectedTuiFailure(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (error instanceof Error &&
      [UI_TEXT.tuiDisconnected, UI_TEXT.tuiInvalidFrame, UI_TEXT.tuiUnsafeSocket].includes(
        error.message,
      ))
  )
}

// A dead pipe at shutdown ends the run; anything else surfaces to the caller.
function isExpectedFlushFailure(error: unknown): boolean {
  return (
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED')) ||
    (error instanceof Error && error.message === UI_TEXT.tuiDisconnected)
  )
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
  const lifecycle = { isActive: true, isStopped: false, isFailed: false }
  let finish: (() => void) | undefined
  const stopped = new Promise<undefined>((resolve) => {
    finish = () => {
      resolve(undefined)
    }
  })
  let lineInput = ''
  let isOverflow = false
  let activeAsk: TuiAsk | undefined
  let presentation = 0
  let isReady = false
  let isPasting = false
  let sequence = ''
  let control: 'escape' | 'csi' | 'ss3' | 'osc' | 'string' | 'stringEscape' | undefined
  let escapeTimer: ReturnType<typeof setTimeout> | undefined
  let quietTimer: ReturnType<typeof setTimeout> | undefined
  const cleanups: (() => void)[] = []
  let removeClose: (() => void) | undefined
  const end = (isFailure: boolean) => {
    lifecycle.isFailed ||= isFailure
    lifecycle.isStopped = true
    controller.presentAsk(undefined)
    connection?.close()
    finish?.()
  }
  // Unexpected failures are collected for one fixed line after shutdown; their
  // raw text never reaches the terminal.
  const failures: unknown[] = []
  const report = (error: unknown): void => {
    failures.push(error)
  }
  const protect = (operation: () => void) => {
    try {
      operation()
    } catch (error: unknown) {
      // Protected teardowns end the run and continue; unexpected failures report.
      end(true)
      if (!isRoutineTuiFailure(error)) report(error)
    }
  }
  const quiet = () => {
    isReady = false
    clearTimeout(quietTimer)
    quietTimer = setTimeout(() => {
      isReady = true
    }, TUI_LIMITS.decisionQuietMs)
  }
  const resetInput = () => {
    lineInput = ''
    isOverflow = false
    controller.input = ''
    controller.blurAsk()
    quiet()
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
  const presentLinear = () => {
    const version = ++presentation
    const approval = approvalLines(controller, deps.terminal.dimensions())
    controller.presentAsk(undefined)
    deps.terminal.write(`${approval.lines.map((line) => line.text).join('\n')}\n`, () => {
      if (
        version === presentation &&
        lifecycle.isActive &&
        !lifecycle.isStopped &&
        deps.terminal.isTTY
      )
        controller.presentAsk(approval.ask)
    })
  }
  const acknowledgeRender = () => {
    const version = ++presentation
    const ask = approvalLines(controller, deps.terminal.dimensions()).ask
    const rendered = screen
    if (rendered === undefined) return
    void (async () => {
      try {
        await rendered.waitUntilRenderFlush()
        if (version === presentation && lifecycle.isActive && !lifecycle.isStopped)
          controller.presentAsk(ask)
      } catch (error: unknown) {
        // Rendering failures end the run; unexpected failures report after shutdown.
        end(true)
        if (!isRoutineTuiFailure(error)) report(error)
      }
    })()
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
        if (!lifecycle.isActive || lifecycle.isStopped) return
        const ask = controller.state.asks[0]
        if (ask !== activeAsk) {
          activeAsk = ask
          resetInput()
          deps.terminal.discardInput()
          if (isLinear && ask !== undefined) presentLinear()
        }
        if (isLinear) {
          return
        }

        screen?.rerender(view())
        acknowledgeRender()
      })
    },
    line: (text) => {
      protect(() => {
        if (!isLinear || !lifecycle.isActive || lifecycle.isStopped) return
        // The active ask has its own bounded presentation, never eventLine's choices.
        if (controller.state.asks.length === 0)
          deps.terminal.write(`${terminalText(text).replaceAll('\n', ' ')}\n`)
      })
    },
  })
  const stopKey = () => {
    controller.key('', { escape: true })
    resetInput()
  }
  const inputChar = (char: string, isFresh: boolean) => {
    if (char === '\u{3}' && !isPasting) {
      stopKey()
      return
    }
    if (char === '\t' && !isPasting) {
      if (isFresh || controller.state.asks.length === 0) controller.key('', { tab: true })
      return
    }
    if (
      controller.state.asks.length > 0 &&
      (!isLinear || (char !== '/' && !lineInput.startsWith('/')))
    ) {
      if (isFresh) controller.key(char)
      return
    }
    if (!isLinear) {
      controller.key(char === '\n' || char === '\r' ? '' : terminalText(char), {
        return: !isPasting && (char === '\n' || char === '\r'),
        backspace: char === '\u{7F}' || char === '\b',
      })
      return
    }
    if (!isPasting && (char === '\n' || char === '\r')) {
      if (isOverflow) {
        isOverflow = false
        lineInput = ''
        return
      }
      const command = lineInput
      lineInput = ''
      controller.submit(command)
      if (command !== '/stop' && command.startsWith('/')) {
        if (controller.state.asks.length > 0) presentLinear()
        else deps.terminal.write(`${lineView(controller)}\n`)
      }
    } else if (isOverflow) return
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
  const decode = (input: string) => {
    const isFresh =
      deps.terminal.isTTY && isReady && !isPasting && input.length === 1 && control === undefined
    quiet()
    for (const char of input) {
      if (char === '\u{3}' && !isPasting) {
        control = undefined
        clearTimeout(escapeTimer)
        stopKey()
        continue
      }
      if (control === 'escape') {
        clearTimeout(escapeTimer)
        control = undefined
        sequence = ''
        switch (char) {
          case '[': {
            control = 'csi'
            continue
          }
          case 'O': {
            control = 'ss3'
            continue
          }
          case ']': {
            control = 'osc'
            continue
          }
          case 'P':
          case '^':
          case '_': {
            control = 'string'
            continue
          }
          default: {
            continue
          }
        }
      }
      if (control === 'csi' || control === 'ss3') {
        sequence = (sequence + char).slice(-TUI_LIMITS.inputChars)
        if (/[@-~]/u.test(char)) {
          if (control === 'csi' && sequence === '200~') {
            isPasting = true
            controller.blurAsk()
          }
          if (control === 'csi' && sequence === '201~') {
            isPasting = false
            controller.blurAsk()
            quiet()
          }
          if (control === 'csi' && sequence === 'O') controller.blurAsk()
          if (!isLinear && !isPasting && (sequence === 'A' || sequence === 'B'))
            controller.key('', { upArrow: sequence === 'A', downArrow: sequence === 'B' })
          control = undefined
          sequence = ''
        }
        continue
      }
      if (control !== undefined && ['osc', 'string', 'stringEscape'].includes(control)) {
        if (
          (control === 'osc' && char === '\u{7}') ||
          (control === 'stringEscape' && char === '\\')
        )
          control = undefined
        else if (char === '\u{1B}') control = 'stringEscape'
        else if (control === 'stringEscape') control = 'string'
        continue
      }
      if (char === '\u{1B}') {
        control = 'escape'
        escapeTimer = setTimeout(() => {
          protect(() => {
            if (control !== 'escape') {
              return
            }

            control = undefined
            if (!isPasting) stopKey()
          })
        }, TUI_LIMITS.escapeMs)
      } else inputChar(char, isFresh)
    }
  }
  try {
    // Subscribe before connection setup; early EOF and I/O errors win the race.
    removeClose = deps.terminal.onClose(end)
    const opening = lifecycle.isStopped
      ? Promise.resolve(undefined)
      : (async () => {
          const connected = await deps.connect((event) => {
            if (lifecycle.isActive && !lifecycle.isStopped)
              protect(() => {
                controller.receive(event)
              })
          })
          if (!lifecycle.isActive || lifecycle.isStopped) connected.close()
          return connected
        })()
    connection = await Promise.race([opening, stopped])
    if (connection !== undefined && !lifecycle.isStopped) {
      deps.terminal.discardInput()
      quiet()
      if (isLinear) {
        deps.terminal.write(`${UI_TEXT.tuiLineKeys}\n`)
        if (controller.state.asks.length > 0) presentLinear()
      } else if (deps.ink !== undefined) {
        screen = deps.ink.render(view(), { exitOnCtrlC: false, patchConsole: false })
        acknowledgeRender()
      }
      cleanups.push(
        deps.terminal.read((input) => {
          protect(() => {
            decode(input)
          })
        }),
        deps.terminal.onResize(() => {
          protect(() => {
            resetInput()
            if (!isLinear) {
              controller.presentAsk(undefined)
              screen?.rerender(view())
              acknowledgeRender()
            } else if (controller.state.asks.length > 0) presentLinear()
          })
        }),
        deps.terminal.onInterrupt(() => {
          protect(stopKey)
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
      await Promise.race([connection.closed, stopped])
    }
  } catch (error: unknown) {
    // Connection failures mark the run failed; unexpected failures are also
    // reported after shutdown, never with their raw text.
    lifecycle.isFailed = true
    if (!isExpectedTuiFailure(error)) report(error)
    protect(() => {
      deps.terminal.write(`${UI_TEXT.tuiDisconnected}\n`)
    })
  } finally {
    lifecycle.isActive = false
    clearTimeout(escapeTimer)
    clearTimeout(quietTimer)
    for (const cleanup of cleanups.toReversed()) protect(cleanup)
    protect(() => {
      screen?.unmount()
      connection?.close()
    })
    protect(() => {
      if (failures.length > 0) deps.terminal.write(`${UI_TEXT.tuiUnexpectedFailure}\n`)
    })
  }
  try {
    await deps.terminal.flush()
  } catch (error: unknown) {
    // A failed flush marks the run; anything else surfaces to the caller.
    if (!isExpectedFlushFailure(error)) throw error
    lifecycle.isFailed = true
  }
  removeClose?.()
  controller.state.pairing = undefined
  controller.state.asks = []
  lineInput = ''
  return lifecycle.isFailed ? 1 : 0
}
