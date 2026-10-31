// Muse Desktop (M111, D91.13) lane BP: one terminal pane's React shell.
// The emulator persists in terminalEngine (a dragged tab moves its shell
// between the dock, the window and the footer without losing its
// transcript); the shell appends the persistent host, binds the find
// bar's listener and fits. Tab close releases the emulator through
// DesktopApp's tab effect, never here: this shell unmounts on every move.

import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import type { ISearchOptions } from '@xterm/addon-search'
import { UI_TEXT } from '../../../shared/constants'
import { webviewKey } from '../../../shared/keybindings'
import { fill } from '../../../shared/l10n/text'
import {
  acquirePersistentTerminal,
  type IsWorkbenchChord,
  type PersistentTerminal,
} from './terminalEngine'

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
  const { tabId, title, isReadOnly, isWorkbenchChord, onFocusPane, registerPane } = properties
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
    const acquired = acquirePersistentTerminal(tabId, title, isReadOnly, isWorkbenchChord)
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
  }, [isReadOnly, isWorkbenchChord, tabId, title])

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
