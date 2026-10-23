import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import type { NodeMethodPort } from '../../../shared/hostApi/nodeMethods'
import { isNodePageError } from '../../bridges/nodePort'
import type { NodePageAuthPort } from '../git/network'
import {
  attachNodeTerminal,
  openNodeTerminal,
  type NodeTerminalSession,
  type NodeTerminalSocketFactory,
} from './session'
import './terminal.css'

/** The terminal follows the surrounding editor theme, then the design
tokens, then the system's own colours. The probe resolves whatever chain
wins into one `rgb()` triple xterm parses: system keywords never reach it. */
function resolveTerminalColor(value: string): string {
  const probe = document.createElement('div')
  probe.style.color = value
  document.documentElement.append(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved
}

function terminalTheme(): ITheme {
  const css = getComputedStyle(document.documentElement)
  const read = (name: string): string => css.getPropertyValue(name).trim()
  const pick = (editor: string, token: string, system: string): string =>
    resolveTerminalColor(read(editor) || read(token) || system)
  return {
    foreground: pick('--vscode-terminal-foreground', '--ms-code-text', 'CanvasText'),
    background: pick('--vscode-terminal-background', '--ms-code-surface', 'Canvas'),
    cursor: pick('--vscode-terminalCursor-foreground', '--ms-cursor', 'CanvasText'),
    selectionBackground: pick(
      '--vscode-terminal-selectionBackground',
      '--ms-selection',
      'Highlight',
    ),
  }
}

interface TerminalTab {
  readonly key: string
  readonly terminalId: string
  readonly source: 'person' | 'shared'
  readonly session: NodeTerminalSession
}

export interface TerminalTabsProps {
  readonly port: NodeMethodPort
  readonly auth: NodePageAuthPort
  readonly workspaceId: string
  readonly connect: NodeTerminalSocketFactory
  readonly run: (work: (signal: AbortSignal) => Promise<void>) => void
  readonly busy: boolean
}

/** The workspace terminals: one xterm.js view per tab, all mounted and only
the active one visible (hidden views keep layout, so their emulators hold
scrollback). Background tabs never steal focus: quiet unless addressed. */
export function TerminalTabs({ port, auth, workspaceId, connect, run, busy }: TerminalTabsProps) {
  const [tabs, setTabs] = useState<readonly TerminalTab[]>([])
  const [active, setActive] = useState('')
  const [attachId, setAttachId] = useState('')
  const [error, setError] = useState('')
  const keys = useRef(0)

  const fail = useCallback((failure: unknown) => {
    // Cancellation is silent; the name check (not instanceof) holds
    // across DOMException realms.
    if (
      typeof failure === 'object' &&
      failure !== null &&
      'name' in failure &&
      failure.name === 'AbortError'
    )
      return
    // A typed refusal displays; anything else is a bug and is rethrown to
    // the window's failure channel.
    if (!isNodePageError(failure)) throw failure
    setError(UI_TEXT.nodeErrors[failure.code])
  }, [])

  const openTerminal = useCallback(() => {
    run(async (signal) => {
      setError('')
      try {
        const session = await openNodeTerminal({
          port,
          auth,
          workspaceId,
          size: { cols: 80, rows: 24 },
          connect,
          signal,
        })
        if (signal.aborted) {
          session.close()
          return
        }
        keys.current += 1
        const key = `terminal-${String(keys.current)}`
        setTabs((previous) => [
          ...previous,
          { key, terminalId: session.terminalId, source: 'person', session },
        ])
        setActive(key)
      } catch (error_: unknown) {
        // Unmount aborts the signal, so a stale failure is always an
        // aborted one here: the abort check alone drops it. A typed
        // refusal displays; anything else is a bug and is rethrown to
        // the window's failure channel.
        if (signal.aborted) return
        if (isNodePageError(error_)) {
          fail(error_)
          return
        }
        throw error_
      }
    })
  }, [auth, connect, fail, port, run, workspaceId])

  const attachTerminal = useCallback(
    (terminalId: string) => {
      run(async (signal) => {
        setError('')
        try {
          const session = await attachNodeTerminal({ port, terminalId, connect, signal })
          if (signal.aborted) {
            session.close()
            return
          }
          keys.current += 1
          const key = `terminal-${String(keys.current)}`
          setTabs((previous) => [...previous, { key, terminalId, source: 'shared', session }])
          setActive(key)
          setAttachId('')
        } catch (error_: unknown) {
          // Unmount aborts the signal, so a stale failure is always an
          // aborted one here: the abort check alone drops it. A typed
          // refusal displays; anything else is a bug and is rethrown to
          // the window's failure channel.
          if (signal.aborted) return
          if (isNodePageError(error_)) {
            fail(error_)
            return
          }
          throw error_
        }
      })
    },
    [connect, fail, port, run],
  )

  const closeTab = useCallback(
    (key: string) => {
      const tab = tabs.find((entry) => entry.key === key)
      setTabs((previous) => previous.filter((entry) => entry.key !== key))
      setActive((current) => {
        if (current !== key) return current
        const rest = tabs.filter((entry) => entry.key !== key)
        return rest.at(-1)?.key ?? ''
      })
      tab?.session.close()
    },
    [tabs],
  )

  // Closing the surface ends every tab: the page holds no shell open behind
  // the person's back, and the server disposes each PTY on its dropped
  // socket regardless.
  const liveTabs = useRef<readonly TerminalTab[]>([])
  useEffect(() => {
    liveTabs.current = tabs
  }, [tabs])
  useEffect(
    () => () => {
      for (const tab of liveTabs.current) tab.session.close()
    },
    [],
  )

  return (
    <section aria-label={UI_TEXT.nodeLabels.terminal}>
      <h2>{UI_TEXT.nodeLabels.terminal}</h2>
      <div className="node-actions" role="toolbar" aria-label={UI_TEXT.nodeLabels.terminal}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-pressed={tab.key === active}
            onClick={() => {
              setActive(tab.key)
            }}
          >
            {tab.source === 'person'
              ? UI_TEXT.nodeLabels.terminalPerson
              : UI_TEXT.nodeLabels.terminalShared}
          </button>
        ))}
        <button type="button" disabled={busy} onClick={openTerminal}>
          {UI_TEXT.nodeLabels.newTerminal}
        </button>
        <button
          type="button"
          aria-label={UI_TEXT.nodeLabels.close}
          disabled={busy || active === ''}
          onClick={() => {
            closeTab(active)
          }}
        >
          {UI_TEXT.nodeLabels.close}
        </button>
      </div>
      <form
        className="node-actions"
        onSubmit={(event) => {
          event.preventDefault()
          const terminalId = attachId.trim()
          if (terminalId !== '') attachTerminal(terminalId)
        }}
      >
        <label>
          {UI_TEXT.nodeLabels.terminalId}
          <input
            type="text"
            value={attachId}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setAttachId(event.target.value)
            }}
          />
        </label>
        <button type="submit" disabled={busy || attachId.trim() === ''}>
          {UI_TEXT.nodeLabels.attachTerminal}
        </button>
      </form>
      {error !== '' && <p role="alert">{error}</p>}
      <div className="node-terminal-stack">
        {tabs.map((tab) => (
          <TerminalView key={tab.key} tab={tab} visible={tab.key === active} onError={fail} />
        ))}
      </div>
    </section>
  )
}

interface TerminalViewProps {
  readonly tab: TerminalTab
  readonly visible: boolean
  readonly onError: (failure: unknown) => void
}

function TerminalView({ tab, visible, onError }: TerminalViewProps) {
  const host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState(UI_TEXT.nodeTerminal.connecting)
  const session = tab.session

  useEffect(() => {
    const element = host.current
    if (element === null) return
    const terminal = new Terminal({
      cols: 80,
      rows: 24,
      screenReaderMode: true,
      theme: terminalTheme(),
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(element)
    fit.fit()
    if (terminal.cols > 0 && terminal.rows > 0) session.resize(terminal.cols, terminal.rows)
    const data = terminal.onData((input: string) => {
      session.write(input)
    })
    // Refit off the frame the resize arrives on, and only when the
    // host's own box changed: refitting synchronously inside the
    // observer feeds it its own resize and loops the frame.
    let lastWidth = 0
    let lastHeight = 0
    let frame = 0
    const resize = new ResizeObserver(() => {
      const width = element.clientWidth
      const height = element.clientHeight
      if (width === lastWidth && height === lastHeight) return
      lastWidth = width
      lastHeight = height
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        fit.fit()
        if (terminal.cols > 0 && terminal.rows > 0) session.resize(terminal.cols, terminal.rows)
      })
    })
    resize.observe(element)
    let hasLiveOutput = false
    const release = session.events((event) => {
      if (event.type === 'output') {
        if (!hasLiveOutput) {
          hasLiveOutput = true
          setStatus('')
        }
        terminal.write(event.data)
      } else if (event.type === 'ended') {
        setStatus(
          fill(UI_TEXT.nodeMessages.terminalEnded, {
            id: tab.terminalId,
            code: event.exitCode ?? '—',
          }),
        )
        terminal.options.disableStdin = true
      } else {
        onError(event.error)
      }
    })
    return () => {
      release()
      resize.disconnect()
      cancelAnimationFrame(frame)
      data.dispose()
      terminal.dispose()
    }
  }, [onError, session, tab.terminalId])

  // The host div belongs to xterm (it manages its classes); React owns only
  // the wrapper's visibility, so a tab switch never disturbs the emulator.
  // Hidden views keep layout, so every emulator measures and holds its
  // scrollback while only the active one shows.
  return (
    <div className={visible ? 'node-terminal-view' : 'node-terminal-view node-terminal-hidden'}>
      <div
        ref={host}
        className="node-terminal-host"
        role="application"
        aria-label={
          tab.source === 'person'
            ? UI_TEXT.nodeLabels.terminalPerson
            : UI_TEXT.nodeLabels.terminalShared
        }
      />
      {status !== '' && (
        <p role="status" className="node-terminal-status">
          {status}
        </p>
      )}
    </div>
  )
}
