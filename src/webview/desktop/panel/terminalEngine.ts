// Muse Desktop (M111, D91.13) lane BP: the terminal engine. One xterm.js
// emulator per tab with the addons VS Code uses: WebGL rendering (the
// canvas renderer when the machine has no WebGL2), search, links and
// Unicode 11 widths, fitted to its host. This module is the lazy chunk:
// everything xterm ships travels with it, and it imports nothing the
// startup chunk shares — every bridge call, sentence and size arrives
// through the acquire hooks — so the bundler cannot hoist it into the
// startup path. Nothing else imports xterm.
//
// The emulator outlives its React shell: a dragged tab moves its shell
// between the dock, the window and the footer, and the shell mounts and
// unmounts, while the emulator (its transcript, its bridge
// subscriptions, its exit state) persists in this module until the tab
// closes. The shell appends the persistent host div, binds the find bar's
// listener and fits; DesktopApp's tab effect releases closed tabs.

import '@xterm/xterm/css/xterm.css'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal, type ITheme } from '@xterm/xterm'
import type { MuseDesktopBridge } from '../../../shared/desktop/bridge'

interface TerminalEngineCallbacks {
  /** A key the emulator kept (never a workbench chord; never read-only). */
  readonly onInput: (data: string) => void
  readonly onResize: (cols: number, rows: number) => void
  readonly onOpenLink: (uri: string) => void
  /** The active match index (-1 past the threshold) and the match count. */
  readonly onSearchResults: (resultIndex: number, resultCount: number) => void
  /**
  Whether the keystroke is a workbench chord that fires with terminal
  focus; those propagate to the dispatch instead of reaching the shell,
  as VS Code's commands-to-skip-shell do.
  */
  readonly isWorkbenchChord: IsWorkbenchChord
}

/** Whether a keystroke is a workbench chord that fires with terminal focus. */
export type IsWorkbenchChord = (event: {
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly metaKey: boolean
  readonly key: string
  readonly code: string
}) => boolean

interface TerminalEngine {
  write(data: string): void
  /** Writes the exit sentence and locks the emulator read-only. */
  exit(text: string): void
  focus(): void
  fit(): void
  findNext(term: string, options: ISearchOptions): boolean
  findPrevious(term: string, options: ISearchOptions): boolean
  clearSearch(): void
  /** Re-reads the theme after a light/dark switch. */
  applyTheme(): void
  dispose(): void
}

/**
Resolves one specified token value into the `rgb()` triple xterm
parses: token aliases (`var(--ms-raised)`) and system keywords never
reach it unresolved.
*/
function resolveColor(value: string): string {
  const probe = document.createElement('div')
  probe.style.color = value
  document.documentElement.append(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved
}

/**
The emulator's theme from the design tokens: code text on the code
surface, the accent cursor, selected text on the selection. The system
keywords only show before the token sheet arrives.
*/
function resolveTerminalTheme(): ITheme {
  const css = getComputedStyle(document.documentElement)
  const pick = (token: string, system: string): string => {
    const read = css.getPropertyValue(token).trim()
    return resolveColor(read === '' ? system : read)
  }
  return {
    foreground: pick('--ms-code-text', 'CanvasText'),
    background: pick('--ms-code-surface', 'Canvas'),
    cursor: pick('--ms-accent', 'CanvasText'),
    selectionBackground: pick('--ms-selection', 'Highlight'),
    selectionForeground: pick('--ms-on-selection', 'HighlightText'),
  }
}

function hasWebgl2(): boolean {
  const probe = document.createElement('canvas')
  return probe.getContext('webgl2') !== null
}

function createTerminalEngine(
  element: HTMLElement,
  callbacks: TerminalEngineCallbacks,
  isReadOnly: boolean,
  initialCols: number,
  initialRows: number,
): TerminalEngine {
  const terminal = new Terminal({
    cols: initialCols,
    rows: initialRows,
    screenReaderMode: true,
    // The Unicode 11 addon drives the proposed unicode API, as it does
    // in VS Code: without the flag the addon refuses to activate.
    allowProposedApi: true,
    theme: resolveTerminalTheme(),
  })
  const fit = new FitAddon()
  terminal.loadAddon(fit)
  const search = new SearchAddon()
  terminal.loadAddon(search)
  search.onDidChangeResults((event) => {
    callbacks.onSearchResults(event.resultIndex, event.resultCount)
  })
  terminal.loadAddon(new Unicode11Addon())
  terminal.unicode.activeVersion = '11'
  terminal.loadAddon(
    new WebLinksAddon((event, uri) => {
      event.preventDefault()
      callbacks.onOpenLink(uri)
    }),
  )
  // WebGL only where the machine offers a context; elsewhere (and after
  // a context loss) the canvas renderer carries the emulator, as it does
  // for every xterm.js host without WebGL2.
  if (hasWebgl2()) {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => {
      webgl.dispose()
    })
    terminal.loadAddon(webgl)
  }
  terminal.attachCustomKeyEventHandler((event) => !callbacks.isWorkbenchChord(event))
  terminal.open(element)
  fit.fit()

  const input = isReadOnly
    ? undefined
    : terminal.onData((data) => {
        callbacks.onInput(data)
      })

  // Refit off the frame the resize arrives on, and only when the box
  // changed: refitting synchronously inside the observer feeds it its
  // own resize and loops the frame.
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
      if (terminal.cols > 0 && terminal.rows > 0) callbacks.onResize(terminal.cols, terminal.rows)
    })
  })
  resize.observe(element)

  return {
    write(data: string): void {
      terminal.write(data)
    },
    exit(text: string): void {
      terminal.write(`\r\n${text}\r\n`)
      terminal.options.disableStdin = true
    },
    focus(): void {
      terminal.focus()
    },
    fit(): void {
      if (!(element.clientWidth > 0 && element.clientHeight > 0)) {
        return
      }

      fit.fit()
      if (terminal.cols > 0 && terminal.rows > 0) callbacks.onResize(terminal.cols, terminal.rows)
    },
    findNext(term: string, options: ISearchOptions): boolean {
      return search.findNext(term, options)
    },
    findPrevious(term: string, options: ISearchOptions): boolean {
      return search.findPrevious(term, options)
    },
    clearSearch(): void {
      search.clearDecorations()
    },
    applyTheme(): void {
      terminal.options.theme = resolveTerminalTheme()
    },
    dispose(): void {
      resize.disconnect()
      cancelAnimationFrame(frame)
      input?.dispose()
      terminal.dispose()
    },
  }
}

export interface PersistentTerminal {
  /** The xterm host div; the shell appends it and it moves with the tab. */
  readonly host: HTMLDivElement
  focus(): void
  fit(): void
  findNext(term: string, options: ISearchOptions): boolean
  findPrevious(term: string, options: ISearchOptions): boolean
  clearSearch(): void
  applyTheme(): void
  /**
  The mounted shell's find listener, or null while no shell shows the
  tab (a footer tab, a hidden panel): results with no listener are
  dropped, and the shell clears stale decorations when it unmounts.
  */
  setSearchListener(listener: ((resultIndex: number, resultCount: number) => void) | null): void
  release(): void
}

const acquiredTerminals = new Map<string, PersistentTerminal>()

/**
Everything the lazy chunk needs from the startup chunk, handed in by
the shell: the registry entries, the bridge calls, the exit sentence
and the opening size. The engine calls nothing else outside xterm.
*/
export interface PersistentTerminalHooks {
  readonly isWorkbenchChord: IsWorkbenchChord
  readonly initialCols: number
  readonly initialRows: number
  readonly register: (tabId: string, terminal: PersistentTerminal) => void
  readonly unregister: (tabId: string) => void
  readonly writeTerminal: MuseDesktopBridge['writeTerminal']
  readonly resizeTerminal: MuseDesktopBridge['resizeTerminal']
  readonly openExternal: MuseDesktopBridge['openExternal']
  readonly onTerminalData: MuseDesktopBridge['onTerminalData']
  readonly onTerminalExit: MuseDesktopBridge['onTerminalExit']
  readonly formatExit: (code: number | null) => string
}

/**
The tab's emulator, created on first use and kept until
releasePersistentTerminal (terminalRegistry, which owns disposal from
outside this chunk). The first call's title, read-only flag and hooks
win: a tab's never change afterwards.
*/
export function acquirePersistentTerminal(
  tabId: string,
  title: string,
  isReadOnly: boolean,
  hooks: PersistentTerminalHooks,
): PersistentTerminal {
  const kept = acquiredTerminals.get(tabId)
  if (kept !== undefined) return kept
  const host = document.createElement('div')
  host.className = 'muse-panel-terminal-host'
  host.dir = 'ltr'
  host.setAttribute('role', 'application')
  host.setAttribute('aria-label', title)
  let searchListener: ((resultIndex: number, resultCount: number) => void) | null = null
  const created = createTerminalEngine(
    host,
    {
      onInput: (data) => {
        hooks.writeTerminal(tabId, data)
      },
      onResize: (cols, rows) => {
        hooks.resizeTerminal(tabId, cols, rows)
      },
      onOpenLink: (uri) => {
        void hooks.openExternal(uri)
      },
      onSearchResults: (resultIndex, resultCount) => {
        searchListener?.(resultIndex, resultCount)
      },
      isWorkbenchChord: hooks.isWorkbenchChord,
    },
    isReadOnly,
    hooks.initialCols,
    hooks.initialRows,
  )
  const releaseData = hooks.onTerminalData((frame) => {
    if (frame.id === tabId) created.write(frame.data)
  })
  const releaseExit = hooks.onTerminalExit((frame) => {
    if (frame.id !== tabId) return
    created.exit(hooks.formatExit(frame.code))
  })
  const scheme = window.matchMedia('(prefers-color-scheme: dark)')
  const retheme = (): void => {
    created.applyTheme()
  }
  scheme.addEventListener('change', retheme)
  const terminal: PersistentTerminal = {
    host,
    focus(): void {
      created.focus()
    },
    fit(): void {
      created.fit()
    },
    findNext(term, options): boolean {
      return created.findNext(term, options)
    },
    findPrevious(term, options): boolean {
      return created.findPrevious(term, options)
    },
    clearSearch(): void {
      created.clearSearch()
    },
    applyTheme(): void {
      created.applyTheme()
    },
    setSearchListener(listener): void {
      searchListener = listener
    },
    release(): void {
      scheme.removeEventListener('change', retheme)
      releaseData()
      releaseExit()
      created.dispose()
      acquiredTerminals.delete(tabId)
      hooks.unregister(tabId)
    },
  }
  acquiredTerminals.set(tabId, terminal)
  hooks.register(tabId, terminal)
  return terminal
}
