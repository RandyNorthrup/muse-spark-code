// Muse Desktop (M111, D91.13) lane BP: one terminal pane's React shell.
// The emulator persists in terminalEngine (a dragged tab moves its shell
// between the dock, the window and the footer without losing its
// transcript); the shell appends the persistent host, binds the find
// bar's listener and fits. Tab close releases the emulator through
// DesktopApp's tab effect, never here: this shell unmounts on every move.
//
// The shell rides the startup chunk; the engine loads lazily behind an
// explicit loading state (a failed chunk shows the failure with a retry
// that fetches again). The engine shares nothing with this chunk (every
// bridge call, sentence and size arrives through the acquire hooks), so
// the bundler keeps it whole in its own file.

import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import type { ISearchOptions } from '@xterm/addon-search'
import {
  DESKTOP_TERMINAL_DEFAULT_COLS,
  DESKTOP_TERMINAL_DEFAULT_ROWS,
  UI_TEXT,
} from '../../../shared/constants'
import { webviewKey } from '../../../shared/keybindings'
import { fill } from '../../../shared/l10n/text'
import { desktopBridge } from '../../bridges/desktop'
import type {
  IsWorkbenchChord,
  PersistentTerminal,
  PersistentTerminalHooks,
} from './terminalEngine'
import { registerPersistentTerminal, unregisterPersistentTerminal } from './terminalRegistry'

/** The lazy chunk's surface, restated structurally. */
interface TerminalEngineModule {
  readonly acquirePersistentTerminal: (
    tabId: string,
    title: string,
    isReadOnly: boolean,
    hooks: PersistentTerminalHooks,
  ) => PersistentTerminal
}

/** An exit code for the exit sentence; a missing code reads as a dash. */
function exitCodeText(code: number | null): string | number {
  switch (code) {
    case null: {
      return '—'
    }
    default: {
      return code
    }
  }
}

/**
The lazy chunk's stylesheet, loaded once beside its script: esbuild
splits the xterm CSS into `renderer.terminalEngine.css` next to the
lazy chunk, and the same-origin link below is covered by the app's
`style-src 'self'` policy.
*/
function ensureTerminalCss(): void {
  if (document.querySelector('link[data-muse-terminal-css]') !== null) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = './renderer.terminalEngine.css'
  link.dataset['museTerminalCss'] = 'true'
  document.head.append(link)
}

async function loadEngine(): Promise<TerminalEngineModule> {
  const module = await import('./terminalEngine')
  ensureTerminalCss()
  return module
}

export interface TerminalPaneHandle {
  openSearch(): void
  focusPane(): void
}

export interface TerminalViewProps {
  readonly tabId: string
  readonly title: string
  readonly isReadOnly: boolean
  readonly isWorkbenchChord: IsWorkbenchChord
  readonly onFocusPane: (id: string) => void
  readonly registerPane: (id: string, handle: TerminalPaneHandle | null) => void
}

function searchOptions(
  isCaseSensitive: boolean,
  isWholeWord: boolean,
  isRegex: boolean,
): ISearchOptions {
  return {
    caseSensitive: isCaseSensitive,
    wholeWord: isWholeWord,
    regex: isRegex,
    incremental: true,
  }
}

export function TerminalView(properties: TerminalViewProps) {
  const [attempt, setAttempt] = useState(0)
  return (
    <TerminalViewAttempt
      key={attempt}
      {...properties}
      onRetry={() => {
        setAttempt((count) => count + 1)
      }}
    />
  )
}

function TerminalViewAttempt(
  properties: TerminalViewProps & { readonly onRetry: () => void },
): ReactNode {
  const { title, onRetry } = properties
  const [engineModule, setEngineModule] = useState<TerminalEngineModule | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    // One load per mount: a rejection settles here (never shared), and
    // the retry below remounts, so the chunk fetch runs again.
    let isCancelled = false
    void loadEngine()
      .then((module) => {
        if (!isCancelled) setEngineModule(module)
      })
      .catch(() => {
        if (!isCancelled) setLoadFailed(true)
      })
    return () => {
      isCancelled = true
    }
  }, [])

  if (loadFailed) {
    return (
      <div role="alert" className="muse-panel-chunk-failed">
        <p>
          {title}: {UI_TEXT.desktop.panelTerminalFailed}
        </p>
        <button type="button" onClick={onRetry}>
          {UI_TEXT.desktop.panelRetry}
        </button>
      </div>
    )
  }
  if (engineModule === null) {
    return (
      <p role="status" className="muse-panel-terminal-loading">
        {UI_TEXT.desktop.panelTerminalLoading}
      </p>
    )
  }
  const { tabId, isReadOnly, isWorkbenchChord, onFocusPane, registerPane } = properties
  return (
    <TerminalPane
      tabId={tabId}
      title={title}
      isReadOnly={isReadOnly}
      isWorkbenchChord={isWorkbenchChord}
      onFocusPane={onFocusPane}
      registerPane={registerPane}
      engineModule={engineModule}
    />
  )
}

function TerminalPane(
  properties: TerminalViewProps & { readonly engineModule: TerminalEngineModule },
) {
  const { tabId, title, isReadOnly, isWorkbenchChord, onFocusPane, registerPane, engineModule } =
    properties
  const shell = useRef<HTMLDivElement>(null)
  const engine = useRef<PersistentTerminal | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [isCaseSensitive, setCaseSensitive] = useState(false)
  const [isWholeWord, setWholeWord] = useState(false)
  const [isRegex, setRegex] = useState(false)
  const [matchText, setMatchText] = useState('')

  useEffect(() => {
    // The pane's handle for the workbench's focus and search chords,
    // registered on mount and withdrawn on unmount (a move
    // re-registers from the new shell).
    const handle: TerminalPaneHandle = {
      openSearch: () => {
        setSearchOpen(true)
      },
      focusPane: () => {
        engine.current?.focus()
      },
    }
    registerPane(tabId, handle)
    return () => {
      registerPane(tabId, null)
    }
  }, [registerPane, tabId])

  useEffect(() => {
    input.current?.focus()
  }, [searchOpen])

  useEffect(() => {
    const wrapper = shell.current
    if (wrapper === null) return
    const bridge = desktopBridge()
    const hooks: PersistentTerminalHooks = {
      isWorkbenchChord,
      initialCols: DESKTOP_TERMINAL_DEFAULT_COLS,
      initialRows: DESKTOP_TERMINAL_DEFAULT_ROWS,
      register: registerPersistentTerminal,
      unregister: unregisterPersistentTerminal,
      writeTerminal: (id, data) => {
        bridge.writeTerminal(id, data)
      },
      resizeTerminal: (id, cols, rows) => {
        bridge.resizeTerminal(id, cols, rows)
      },
      openExternal: (uri) => bridge.openExternal(uri),
      onTerminalData: (listener) => bridge.onTerminalData(listener),
      onTerminalExit: (listener) => bridge.onTerminalExit(listener),
      formatExit: (code) =>
        fill(UI_TEXT.desktop.workbenchTerminalExited, { code: exitCodeText(code) }),
    }
    const acquired = engineModule.acquirePersistentTerminal(tabId, title, isReadOnly, hooks)
    engine.current = acquired
    wrapper.append(acquired.host)
    acquired.setSearchListener((resultIndex, resultCount) => {
      setMatchText(
        resultCount === 0
          ? UI_TEXT.desktop.panelFindNoResults
          : fill(UI_TEXT.desktop.panelFindCount, {
              current: resultIndex + 1,
              total: resultCount,
            }),
      )
    })
    acquired.fit()
    return () => {
      engine.current = null
      acquired.setSearchListener(null)
      acquired.clearSearch()
    }
  }, [engineModule, isReadOnly, isWorkbenchChord, tabId, title])

  const runSearch = (
    next: string,
    isForward: boolean,
    isMatchCase: boolean,
    isMatchWord: boolean,
    isMatchRegex: boolean,
  ): void => {
    const current = engine.current
    if (current === null) return
    if (next === '') {
      current.clearSearch()
      setMatchText('')
      return
    }
    try {
      const options = searchOptions(isMatchCase, isMatchWord, isMatchRegex)
      if (isForward) current.findNext(next, options)
      else current.findPrevious(next, options)
    } catch (error: unknown) {
      // An unfinished pattern is not a valid expression yet; typing on
      // re-searches. Anything else is rethrown.
      if (!(error instanceof SyntaxError)) throw error
      setMatchText('')
    }
  }

  const searchWith = (next: string, isForward: boolean): void => {
    runSearch(next, isForward, isCaseSensitive, isWholeWord, isRegex)
  }

  const closeSearch = (): void => {
    setSearchOpen(false)
    setMatchText('')
    setTerm('')
    engine.current?.clearSearch()
    engine.current?.focus()
  }

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    const action = webviewKey('desktop.terminalSearch', event)
    if (action === 'close') {
      event.preventDefault()
      closeSearch()
      return
    }
    if (!(action === 'next' || action === 'previous')) {
      return
    }

    event.preventDefault()
    searchWith(term, action === 'next')
  }

  return (
    <div
      ref={shell}
      className="muse-panel-terminal"
      onFocus={() => {
        onFocusPane(tabId)
      }}
    >
      {searchOpen ? (
        <div className="muse-panel-find" role="search" aria-label={UI_TEXT.desktop.panelFind}>
          <input
            ref={input}
            className="muse-panel-find-input"
            placeholder={UI_TEXT.desktop.panelFindPlaceholder}
            aria-label={UI_TEXT.desktop.panelFindPlaceholder}
            value={term}
            onChange={(event) => {
              const next = event.currentTarget.value
              setTerm(next)
              searchWith(next, true)
            }}
            onKeyDown={onSearchKey}
          />
          <span className="muse-panel-find-count" aria-live="polite">
            {matchText}
          </span>
          <button
            type="button"
            title={UI_TEXT.desktop.panelFindPrevious}
            aria-label={UI_TEXT.desktop.panelFindPrevious}
            onClick={() => {
              searchWith(term, false)
            }}
          >
            ↑
          </button>
          <button
            type="button"
            title={UI_TEXT.desktop.panelFindNext}
            aria-label={UI_TEXT.desktop.panelFindNext}
            onClick={() => {
              searchWith(term, true)
            }}
          >
            ↓
          </button>
          <button
            type="button"
            title={UI_TEXT.desktop.panelFindCase}
            aria-label={UI_TEXT.desktop.panelFindCase}
            aria-pressed={isCaseSensitive}
            onClick={() => {
              setCaseSensitive(!isCaseSensitive)
              runSearch(term, true, !isCaseSensitive, isWholeWord, isRegex)
            }}
          >
            Aa
          </button>
          <button
            type="button"
            title={UI_TEXT.desktop.panelFindWord}
            aria-label={UI_TEXT.desktop.panelFindWord}
            aria-pressed={isWholeWord}
            onClick={() => {
              setWholeWord(!isWholeWord)
              runSearch(term, true, isCaseSensitive, !isWholeWord, isRegex)
            }}
          >
            |…|
          </button>
          <button
            type="button"
            title={UI_TEXT.desktop.panelFindRegex}
            aria-label={UI_TEXT.desktop.panelFindRegex}
            aria-pressed={isRegex}
            onClick={() => {
              setRegex(!isRegex)
              runSearch(term, true, isCaseSensitive, isWholeWord, !isRegex)
            }}
          >
            .*
          </button>
          <button
            type="button"
            title={UI_TEXT.desktop.panelFindClose}
            aria-label={UI_TEXT.desktop.panelFindClose}
            onClick={closeSearch}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  )
}
