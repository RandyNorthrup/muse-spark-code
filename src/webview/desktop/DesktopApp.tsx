// Muse Desktop (M111, D91.13) lane WB: the workbench layout. Chat on the
// left, the editor group in the centre with the terminal panel below it and
// the tabbed footer at the same width, the rail and sidebar on the right.
// The status bar belongs to SH1's shell surface; this app publishes its
// items over the bridge. ED, SB1 and BP fill the editor, sidebar and
// terminal surfaces inside these regions.

import { useCallback, useEffect, useRef, useState } from 'react'
import { DESKTOP_QUICK_OPEN_MAX_RESULTS, UI_TEXT } from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'
import {
  FOOTER_TABS,
  type DesktopWorkspace,
  type FileEntry,
  type FooterTab,
  type WorkbenchLayout,
} from '../../shared/desktop/bridge'
import {
  KeybindingRegistry,
  chordFromEvent,
  type WorkbenchCommand,
} from '../../shared/desktop/keybindings'
import {
  freshLayout,
  isTerminalPanelVisible,
  moveTerminal,
  nextTerminalAfterClose,
  rankQuickOpen,
  type TerminalTab,
} from '../../shared/desktop/workbench'
import { webviewKey } from '../../shared/keybindings'
import { desktopBridge } from '../bridges/desktop'

const registry = new KeybindingRegistry()

interface OpenFile {
  readonly path: string
  text: string
  savedText: string
}

function footerTabLabel(tab: FooterTab): string {
  return tab === 'terminal'
    ? UI_TEXT.desktop.workbenchTerminal
    : tab === 'problems'
      ? UI_TEXT.desktop.workbenchProblems
      : UI_TEXT.desktop.workbenchOutput
}

export function DesktopApp() {
  const [workspace, setWorkspace] = useState<DesktopWorkspace | null>(null)
  const [layout, setLayout] = useState<WorkbenchLayout>(freshLayout)
  const [layoutNotice, setLayoutNotice] = useState<string | null>(null)
  const [files, setFiles] = useState<readonly FileEntry[]>([])
  const [openFiles, setOpenFiles] = useState<readonly OpenFile[]>([])
  const [terminals, setTerminals] = useState<readonly TerminalTab[]>([])
  const [terminalText, setTerminalText] = useState<ReadonlyMap<string, string>>(new Map())
  const [quickOpenVisible, setQuickOpenVisible] = useState(false)
  const [quickOpenQuery, setQuickOpenQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const chatRef = useRef<HTMLElement>(null)
  const editorRef = useRef<HTMLElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const terminalRef = useRef<HTMLElement>(null)
  const layoutRef = useRef(layout)
  useEffect(() => {
    layoutRef.current = layout
  }, [layout])

  const persistLayout = useCallback(
    async (next: WorkbenchLayout) => {
      setLayout(next)
      if (workspace === null) return
      await desktopBridge().setLayout({
        key: { workspaceRoot: workspace.root },
        layout: next,
      })
    },
    [workspace],
  )

  useEffect(() => {
    const controller = new AbortController()
    const isAborted = (): boolean => controller.signal.aborted
    void (async () => {
      try {
        const bridge = desktopBridge()
        const current = await bridge.workspace()
        if (isAborted()) return
        setWorkspace(current)
        let stored: WorkbenchLayout | null = null
        try {
          stored = await bridge.getLayout({ workspaceRoot: current.root })
        } catch (error_: unknown) {
          // Only a schema refusal means the stored record is unreadable;
          // anything else is the outer handler's to report.
          if (!(error_ instanceof Error) || error_.name !== 'ZodError') throw error_
          stored = null
          if (!isAborted()) setLayoutNotice(UI_TEXT.desktop.workbenchLayoutUnreadable)
        }
        if (isAborted()) return
        setLayout(stored ?? freshLayout())
        setFiles(await bridge.listFiles())
      } catch (error_: unknown) {
        // Bridge failures arrive as Errors with the refusal as their
        // message; a schema refusal means the bridge answered nonsense;
        // anything else is a bug, not a refusal to soften.
        if (error_ instanceof Error && error_.name === 'ZodError') {
          if (!isAborted()) setError(UI_TEXT.desktop.workbenchBridgeUnavailable)
        } else if (error_ instanceof Error && error_.name === 'Error') {
          if (!isAborted()) setError(error_.message)
        } else {
          throw error_
        }
      }
    })()
    return () => {
      controller.abort()
    }
  }, [])

  useEffect(() => {
    const bridge = desktopBridge()
    const offData = bridge.onTerminalData((frame) => {
      setTerminalText((previous) => {
        const next = new Map(previous)
        next.set(frame.id, `${next.get(frame.id) ?? ''}${frame.data}`)
        return next
      })
    })
    const offExit = bridge.onTerminalExit((frame) => {
      setTerminalText((previous) => {
        const next = new Map(previous)
        const code = frame.code === null ? '—' : String(frame.code)
        next.set(
          frame.id,
          `${next.get(frame.id) ?? ''}\n${fill(UI_TEXT.desktop.workbenchTerminalExited, { code })}\n`,
        )
        return next
      })
    })
    return () => {
      offData()
      offExit()
    }
  }, [])

  useEffect(() => {
    if (workspace === null) return
    void desktopBridge().publishStatus({
      workspaceRoot: workspace.root,
      items: [
        {
          id: 'workbench.workspace',
          side: 'left',
          text: fill(UI_TEXT.desktop.workbenchStatusWorkspace, { name: workspace.name }),
          priority: 10,
        },
        {
          id: 'workbench.terminals',
          side: 'right',
          text: plural(UI_TEXT.desktop.workbenchStatusTerminals, terminals.length, {
            count: String(terminals.length),
          }),
          priority: 20,
        },
      ],
    })
  }, [workspace, terminals.length])

  const openFile = useCallback(
    async (filePath: string) => {
      try {
        const result = await desktopBridge().readFile(filePath)
        setOpenFiles((previous) => [
          ...previous.filter((file) => file.path !== result.path),
          { path: result.path, text: result.text, savedText: result.text },
        ])
        const next: WorkbenchLayout = {
          ...layoutRef.current,
          openFiles: [...new Set([...layoutRef.current.openFiles, result.path])],
          activeFile: result.path,
        }
        await persistLayout(next)
      } catch (error_: unknown) {
        // The main process refuses binary and outside files by name and
        // the preload refuses malformed answers; both read the same way
        // here. Anything else is a bug, not an unreadable file.
        if (error_ instanceof Error && error_.name === 'ZodError') {
          setError(UI_TEXT.desktop.workbenchBridgeUnavailable)
        } else if (error_ instanceof Error && error_.name === 'Error') {
          setError(UI_TEXT.desktop.workbenchFileUnreadable)
        } else {
          throw error_
        }
      }
    },
    [persistLayout],
  )

  const newTerminal = useCallback(async () => {
    if (workspace === null) return
    const created = await desktopBridge().createTerminal({
      cwd: workspace.root,
      cols: 80,
      rows: 24,
    })
    setTerminals((previous) => [...previous, created])
    const next: WorkbenchLayout = {
      ...layoutRef.current,
      terminalPlacement:
        layoutRef.current.terminalPlacement === 'hidden'
          ? 'docked'
          : layoutRef.current.terminalPlacement,
      activeTerminalId: created.id,
    }
    await persistLayout(next)
  }, [persistLayout, workspace])

  const runCommand = useCallback(
    (command: WorkbenchCommand) => {
      const current = layoutRef.current
      switch (command) {
        case 'workbench.quickOpen': {
          setQuickOpenVisible((visible) => !visible)
          break
        }
        case 'workbench.toggleSidebar': {
          void persistLayout({ ...current, sidebarVisible: !current.sidebarVisible })
          break
        }
        case 'workbench.toggleRail': {
          void persistLayout({ ...current, railVisible: !current.railVisible })
          break
        }
        case 'workbench.toggleTerminal': {
          void persistLayout(
            moveTerminal(current, current.terminalPlacement === 'hidden' ? 'show' : 'hide'),
          )
          break
        }
        case 'workbench.newTerminal': {
          void newTerminal()
          break
        }
        case 'workbench.focusChat': {
          chatRef.current?.focus()
          break
        }
        case 'workbench.focusEditor': {
          editorRef.current?.focus()
          break
        }
        case 'workbench.focusTerminal': {
          terminalRef.current?.focus()
          break
        }
        case 'workbench.focusSidebar': {
          sidebarRef.current?.focus()
          break
        }
        case 'workbench.saveFile': {
          const active = openFiles.find((file) => file.path === current.activeFile)
          if (active !== undefined) {
            void desktopBridge()
              .writeFile(active.path, active.text)
              .then(() => {
                setOpenFiles((previous) =>
                  previous.map((file) =>
                    file.path === active.path ? { ...file, savedText: file.text } : file,
                  ),
                )
              })
          }
          break
        }
        case 'workbench.closeFile': {
          if (current.activeFile !== undefined) {
            const remaining = current.openFiles.filter((file) => file !== current.activeFile)
            setOpenFiles((previous) => previous.filter((file) => file.path !== current.activeFile))
            void persistLayout({
              ...current,
              openFiles: remaining,
              activeFile: remaining.at(-1),
            })
          }
          break
        }
        case 'workbench.nextFile':
        case 'workbench.previousFile': {
          const list = current.openFiles
          if (list.length > 1 && current.activeFile !== undefined) {
            const at = list.indexOf(current.activeFile)
            const step = command === 'workbench.nextFile' ? 1 : -1
            const next = list.at((at + step + list.length) % list.length)
            if (next !== undefined) void persistLayout({ ...current, activeFile: next })
          }
          break
        }
      }
    },
    [newTerminal, openFiles, persistLayout],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const binding = registry.commandForChord(chordFromEvent(event))
      if (binding === undefined) return
      event.preventDefault()
      runCommand(binding.command as WorkbenchCommand)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [runCommand])

  if (error !== null && workspace === null) {
    return (
      <main className="muse-desktop-setup" aria-label={UI_TEXT.desktop.workbenchSetupTitle}>
        <h1>{UI_TEXT.desktop.workbenchSetupTitle}</h1>
        <p role="alert">{error}</p>
      </main>
    )
  }

  const closeTerminal = (id: string): void => {
    desktopBridge().closeTerminal(id)
    const outcome = nextTerminalAfterClose(terminals, id, layout.activeTerminalId)
    setTerminals(outcome.tabs)
    void persistLayout({ ...layout, activeTerminalId: outcome.activeId })
  }

  const activeFile = openFiles.find((file) => file.path === layout.activeFile)
  const activeTerminalId = layout.activeTerminalId ?? terminals[0]?.id
  const quickOpenResults = rankQuickOpen(quickOpenQuery, files).slice(
    0,
    DESKTOP_QUICK_OPEN_MAX_RESULTS,
  )

  return (
    <div className="muse-desktop" data-setup={workspace?.setupMode ? 'true' : undefined}>
      <section
        ref={chatRef}
        tabIndex={-1}
        aria-label={UI_TEXT.desktop.workbenchChat}
        className="muse-desktop-chat"
        style={{ inlineSize: `${String(layout.chatWidthPx)}px` }}
      >
        <header className="muse-desktop-pane-head">{UI_TEXT.desktop.workbenchChat}</header>
        {workspace?.setupMode ? (
          <div className="muse-desktop-setup-body">
            <h1>{UI_TEXT.desktop.workbenchSetupTitle}</h1>
            <p>{UI_TEXT.desktop.workbenchSetupDetail}</p>
          </div>
        ) : null}
        {layoutNotice === null ? null : <p role="status">{layoutNotice}</p>}
        {error === null ? null : <p role="alert">{error}</p>}
      </section>

      <div className="muse-desktop-centre">
        <section
          ref={editorRef}
          tabIndex={-1}
          aria-label={UI_TEXT.desktop.workbenchEditor}
          className="muse-desktop-editor"
        >
          <div
            role="tablist"
            aria-label={UI_TEXT.desktop.workbenchEditor}
            className="muse-desktop-tabs"
          >
            {layout.openFiles.map((filePath) => {
              const file = openFiles.find((open) => open.path === filePath)
              const isDirty = file !== undefined && file.text !== file.savedText
              return (
                <button
                  key={filePath}
                  role="tab"
                  aria-selected={layout.activeFile === filePath}
                  onClick={() => void persistLayout({ ...layout, activeFile: filePath })}
                >
                  <span dir="ltr">{filePath.split('/').pop()}</span>
                  {isDirty ? <span aria-label={UI_TEXT.desktop.workbenchUnsaved}> ●</span> : null}
                </button>
              )
            })}
          </div>
          {activeFile === undefined ? (
            <p className="muse-desktop-empty">{UI_TEXT.desktop.workbenchNoFileOpen}</p>
          ) : (
            <textarea
              aria-label={activeFile.path}
              dir="ltr"
              className="muse-desktop-code"
              value={activeFile.text}
              onChange={(event) => {
                const text = event.target.value
                setOpenFiles((previous) =>
                  previous.map((file) =>
                    file.path === activeFile.path ? { ...file, text } : file,
                  ),
                )
              }}
            />
          )}
        </section>

        {isTerminalPanelVisible(layout.terminalPlacement) ? (
          <section
            ref={terminalRef}
            tabIndex={-1}
            aria-label={UI_TEXT.desktop.workbenchTerminal}
            className={
              layout.terminalPlacement === 'floating'
                ? 'muse-desktop-terminal muse-desktop-terminal-floating'
                : 'muse-desktop-terminal'
            }
            style={{ blockSize: `${String(layout.terminalHeightPx)}px` }}
          >
            <TerminalTabs
              terminals={terminals}
              activeId={activeTerminalId}
              text={
                activeTerminalId === undefined ? '' : (terminalText.get(activeTerminalId) ?? '')
              }
              onNew={() => void newTerminal()}
              onClose={closeTerminal}
              onSelect={(id) => void persistLayout({ ...layout, activeTerminalId: id })}
              onInput={(data) => {
                if (activeTerminalId !== undefined)
                  desktopBridge().writeTerminal(activeTerminalId, data)
              }}
            />
            <div className="muse-desktop-terminal-actions">
              <button onClick={() => void persistLayout(moveTerminal(layout, 'collapse'))}>
                {UI_TEXT.desktop.workbenchCollapseTerminal}
              </button>
              {layout.terminalPlacement === 'floating' ? (
                <button onClick={() => void persistLayout(moveTerminal(layout, 'dock'))}>
                  {UI_TEXT.desktop.workbenchDockTerminal}
                </button>
              ) : (
                <button onClick={() => void persistLayout(moveTerminal(layout, 'detach'))}>
                  {UI_TEXT.desktop.workbenchDetachTerminal}
                </button>
              )}
            </div>
          </section>
        ) : null}

        <footer className="muse-desktop-footer">
          <div
            role="tablist"
            aria-label={UI_TEXT.desktop.workbenchTerminal}
            className="muse-desktop-tabs"
          >
            {FOOTER_TABS.map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={layout.activeFooterTab === tab}
                onClick={() => {
                  if (tab === 'terminal' && layout.terminalPlacement === 'footer') {
                    void persistLayout(moveTerminal({ ...layout, activeFooterTab: tab }, 'expand'))
                  } else {
                    void persistLayout({ ...layout, activeFooterTab: tab })
                  }
                }}
              >
                {footerTabLabel(tab)}
              </button>
            ))}
          </div>
          {layout.activeFooterTab === 'problems' ? (
            <p>{UI_TEXT.desktop.workbenchNoProblems}</p>
          ) : null}
          {layout.activeFooterTab === 'output' ? <p>{UI_TEXT.desktop.workbenchNoOutput}</p> : null}
          {layout.activeFooterTab === 'terminal' && layout.terminalPlacement === 'footer' ? (
            <button onClick={() => void persistLayout(moveTerminal(layout, 'expand'))}>
              {UI_TEXT.desktop.workbenchExpandTerminal}
            </button>
          ) : null}
        </footer>
      </div>

      {layout.railVisible ? (
        <nav aria-label={UI_TEXT.desktop.workbenchSidebar} className="muse-desktop-rail">
          <button
            aria-label={UI_TEXT.desktop.workbenchToggleSidebar}
            onClick={() => {
              runCommand('workbench.toggleSidebar')
            }}
          >
            <span aria-hidden="true">▦</span>
            <kbd>{registry.labelForCommand('workbench.toggleSidebar')}</kbd>
          </button>
          <button
            aria-label={UI_TEXT.desktop.workbenchToggleTerminal}
            onClick={() => {
              runCommand('workbench.toggleTerminal')
            }}
          >
            <span aria-hidden="true">⌘</span>
            <kbd>{registry.labelForCommand('workbench.toggleTerminal')}</kbd>
          </button>
        </nav>
      ) : null}

      {layout.sidebarVisible ? (
        <aside
          ref={sidebarRef}
          tabIndex={-1}
          aria-label={UI_TEXT.desktop.workbenchSidebar}
          className="muse-desktop-sidebar"
          style={{ inlineSize: `${String(layout.sidebarWidthPx)}px` }}
        >
          <header className="muse-desktop-pane-head">{UI_TEXT.desktop.workbenchSidebar}</header>
          <ul className="muse-desktop-files">
            {files.map((file) => (
              <li key={file.path}>
                <button dir="ltr" onClick={() => void openFile(file.path)}>
                  {file.path}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}

      {quickOpenVisible ? (
        <div
          className="muse-desktop-quickopen"
          role="dialog"
          aria-modal="true"
          aria-label={UI_TEXT.desktop.workbenchQuickOpen}
        >
          <input
            autoFocus
            aria-label={UI_TEXT.desktop.workbenchQuickOpen}
            placeholder={UI_TEXT.desktop.workbenchQuickOpen}
            value={quickOpenQuery}
            onChange={(event) => {
              setQuickOpenQuery(event.target.value)
            }}
            onKeyDown={(event) => {
              const action = webviewKey('desktop.quickOpen', event)
              if (action === 'close') setQuickOpenVisible(false)
              if (action !== 'accept' || quickOpenResults[0] === undefined) {
                return
              }

              void openFile(quickOpenResults[0].path)
              setQuickOpenVisible(false)
            }}
          />
          <ul>
            {quickOpenResults.map((file) => (
              <li key={file.path}>
                <button
                  dir="ltr"
                  onClick={() => {
                    void openFile(file.path)
                    setQuickOpenVisible(false)
                  }}
                >
                  {file.path}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function TerminalTabs(properties: {
  readonly terminals: readonly TerminalTab[]
  readonly activeId: string | undefined
  readonly text: string
  readonly onNew: () => void
  readonly onClose: (id: string) => void
  readonly onSelect: (id: string) => void
  readonly onInput: (data: string) => void
}) {
  return (
    <div className="muse-desktop-terminal-body">
      <div
        role="tablist"
        aria-label={UI_TEXT.desktop.workbenchTerminal}
        className="muse-desktop-tabs"
      >
        {properties.terminals.map((terminal) => (
          <span key={terminal.id} className="muse-desktop-terminal-tab">
            <button
              role="tab"
              aria-selected={properties.activeId === terminal.id}
              onClick={() => {
                properties.onSelect(terminal.id)
              }}
            >
              {terminal.title}
            </button>
            <button
              aria-label={UI_TEXT.desktop.workbenchCloseTerminal}
              onClick={() => {
                properties.onClose(terminal.id)
              }}
            >
              ×
            </button>
          </span>
        ))}
        <button onClick={properties.onNew}>{UI_TEXT.desktop.workbenchNewTerminal}</button>
      </div>
      <pre dir="ltr" className="muse-desktop-terminal-output" aria-live="polite">
        {properties.text}
      </pre>
      <input
        aria-label={UI_TEXT.desktop.workbenchTerminal}
        dir="ltr"
        onKeyDown={(event) => {
          if (webviewKey('desktop.terminal', event) !== 'submit') {
            return
          }

          properties.onInput(`${event.currentTarget.value}\n`)
          event.currentTarget.value = ''
        }}
      />
    </div>
  )
}
