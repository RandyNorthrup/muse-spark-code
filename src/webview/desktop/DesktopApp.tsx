// Muse Desktop (M111, D91.13) lanes WB and BP: the workbench layout.
// Chat on the left, the editor group in the centre with the bottom panel
// below it and the tabbed footer at the same width, the rail and sidebar
// on the right. The status bar belongs to SH1's shell surface; this app
// publishes its items over the bridge. ED and SB1 fill the editor and
// sidebar surfaces inside these regions; BP's BottomPanel fills the
// terminal panel, the floating window and the footer strip. This module
// owns the panel's state (tabs, Problems, Output, the exit question),
// the bridge subscriptions, the panel actions and the workbench
// dispatcher, which honours each binding's `when`.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  DESKTOP_LAYOUT_BOUNDS,
  DESKTOP_PANEL_KEYBOARD_RESIZE_PX,
  DESKTOP_QUICK_OPEN_MAX_RESULTS,
  DESKTOP_TERMINAL_DEFAULT_COLS,
  DESKTOP_TERMINAL_DEFAULT_ROWS,
  UI_TEXT,
} from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'
import {
  type DesktopWorkspace,
  type FileEntry,
  type FloatingBounds,
  type OutputSnapshot,
  type PanelProblem,
  type SplitNode,
  type TerminalSessionInfo,
  type TerminalSlot,
  type WorkbenchLayoutV2,
} from '../../shared/desktop/bridge'
import {
  KeybindingRegistry,
  WORKBENCH_COMMANDS,
  chordFromEvent,
  isBindingActive,
  type WorkbenchCommand,
  type WorkbenchFocus,
} from '../../shared/desktop/keybindings'
import {
  applyOutputAppend,
  closePane,
  floatingBoundsFromRect,
  moveTabToSlot,
  paneTerminalIds,
  pruneSplitTree,
  resizeFloatingHeightPx,
  resizePanelHeightPx,
  shouldConfirmTerminalClose,
  splitLeaf,
  tabsInSlot,
  type PanelView,
} from '../../shared/desktop/panel'
import {
  freshLayout,
  moveTerminal,
  nextTerminalAfterClose,
  rankQuickOpen,
  type TerminalMove,
} from '../../shared/desktop/workbench'
import { webviewKey } from '../../shared/keybindings'
import { desktopBridge } from '../bridges/desktop'
import { releasePersistentTerminal, type IsWorkbenchChord } from './panel/terminalEngine'
import type { TerminalPaneHandle } from './panel/TerminalView'
import {
  BottomPanel,
  ExitConfirmDialog,
  FooterPanelStrip,
  type BottomPanelActions,
  type BottomPanelState,
  type BottomPanelTab,
  type PendingTabClose,
} from './panel/BottomPanel'

const registry = new KeybindingRegistry()

interface OpenFile {
  readonly path: string
  text: string
  savedText: string
}

function separatorHeight(action: string, current: number): number | undefined {
  switch (action) {
    case 'increase': {
      return resizePanelHeightPx(current, DESKTOP_PANEL_KEYBOARD_RESIZE_PX)
    }
    case 'decrease': {
      return resizePanelHeightPx(current, -DESKTOP_PANEL_KEYBOARD_RESIZE_PX)
    }
    case 'first': {
      return DESKTOP_LAYOUT_BOUNDS.terminalHeightMinPx
    }
    case 'last': {
      return DESKTOP_LAYOUT_BOUNDS.terminalHeightMaxPx
    }
    default: {
      return undefined
    }
  }
}

function sessionToTab(session: TerminalSessionInfo, slot: TerminalSlot): BottomPanelTab {
  if (session.agent === undefined) {
    return { id: session.id, title: session.title, slot, source: 'person', exitCode: undefined }
  }
  return {
    id: session.id,
    title: session.title,
    slot,
    source: 'agent',
    agent: session.agent,
    exitCode: undefined,
  }
}

export function DesktopApp() {
  const [workspace, setWorkspace] = useState<DesktopWorkspace | null>(null)
  const [layout, setLayout] = useState<WorkbenchLayoutV2>(freshLayout)
  const [layoutNotice, setLayoutNotice] = useState<string | null>(null)
  const [files, setFiles] = useState<readonly FileEntry[]>([])
  const [openFiles, setOpenFiles] = useState<readonly OpenFile[]>([])
  const [tabs, setTabs] = useState<readonly BottomPanelTab[]>([])
  const [problems, setProblems] = useState<readonly PanelProblem[]>([])
  const [output, setOutput] = useState<OutputSnapshot>({ channels: [] })
  const [terminalCreateError, setTerminalCreateError] = useState<string | null>(null)
  const [pendingClose, setPendingClose] = useState<PendingTabClose | null>(null)
  const [quickOpenVisible, setQuickOpenVisible] = useState(false)
  const [quickOpenQuery, setQuickOpenQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const chatRef = useRef<HTMLElement>(null)
  const editorRef = useRef<HTMLElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const layoutRef = useRef(layout)
  useEffect(() => {
    layoutRef.current = layout
  }, [layout])
  const tabsRef = useRef(tabs)
  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])
  const openFilesRef = useRef(openFiles)
  useEffect(() => {
    openFilesRef.current = openFiles
  }, [openFiles])
  const pendingCloseRef = useRef(pendingClose)
  useEffect(() => {
    pendingCloseRef.current = pendingClose
  }, [pendingClose])
  // The dispatcher's focus (`when`), the panel's pending focus request,
  // the tab ids known (closed ids release their emulators), the mounted
  // panes' handles and the mounted Problems/Output focus targets.
  const focusRef = useRef<WorkbenchFocus>('other')
  const pendingFocus = useRef<{
    kind: 'pane' | 'search' | 'problems' | 'output'
    id?: string
  } | null>(null)
  const previousTabIds = useRef<ReadonlySet<string>>(new Set())
  const paneHandles = useRef(new Map<string, TerminalPaneHandle>())
  const problemsListRef = useRef<HTMLUListElement>(null)
  const outputWrapRef = useRef<HTMLDivElement>(null)
  const separatorDrag = useRef<{ startY: number; startHeight: number } | null>(null)
  const firstFocusReturn = useRef(true)

  const persistLayout = useCallback(
    async (next: WorkbenchLayoutV2) => {
      setLayout(next)
      if (workspace === null) return
      await desktopBridge().setLayout({
        key: { workspaceRoot: workspace.root },
        layout: next,
      })
    },
    [workspace],
  )

  const updateLayout = useCallback((next: WorkbenchLayoutV2) => {
    setLayout(next)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const isAborted = (): boolean => controller.signal.aborted
    void (async () => {
      try {
        const bridge = desktopBridge()
        const current = await bridge.workspace()
        if (isAborted()) return
        setWorkspace(current)
        let stored: WorkbenchLayoutV2 | null = null
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
        const initial = stored ?? freshLayout()
        const listed = await bridge.listTerminals()
        if (isAborted()) return
        const live = new Map(listed.map((session) => [session.id, session]))
        const liveIds = new Set(live.keys())
        setTabs(
          listed.map((session) => sessionToTab(session, initial.tabSlots[session.id] ?? 'dock')),
        )
        // Stored slots, splits and actives that name dead sessions are
        // pruned; a stored layout is normalized back at once.
        const tabSlots = Object.fromEntries(
          Object.entries(initial.tabSlots).filter(([id]) => liveIds.has(id)),
        )
        const splits =
          initial.splits === undefined
            ? undefined
            : (pruneSplitTree(initial.splits, liveIds) ?? undefined)
        const activeTerminalId =
          initial.activeTerminalId !== undefined && liveIds.has(initial.activeTerminalId)
            ? initial.activeTerminalId
            : listed[0]?.id
        const activePaneId =
          initial.activePaneId !== undefined && liveIds.has(initial.activePaneId)
            ? initial.activePaneId
            : activeTerminalId
        const next: WorkbenchLayoutV2 = {
          ...initial,
          tabSlots,
          splits,
          activeTerminalId,
          activePaneId,
        }
        setLayout(next)
        if (stored !== null || listed.length > 0) {
          await bridge.setLayout({ key: { workspaceRoot: current.root }, layout: next })
        }
        if (isAborted()) return
        const published = await bridge.getProblems()
        if (isAborted()) return
        setProblems(published.problems)
        setOutput(await bridge.getOutput())
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
    // Terminal data flows straight into the persistent emulators (they
    // subscribe in terminalEngine); the workbench tracks only exits
    // (exited tabs), opened sessions (agents' tabs appear) and the
    // Problems and Output stores.
    const offExit = bridge.onTerminalExit((frame) => {
      setTabs((previous) =>
        previous.map((tab) => (tab.id === frame.id ? { ...tab, exitCode: frame.code } : tab)),
      )
    })
    const offOpened = bridge.onTerminalOpened((session) => {
      setTabs((previous) => {
        if (previous.some((tab) => tab.id === session.id)) return previous
        return [
          ...previous,
          sessionToTab(session, layoutRef.current.tabSlots[session.id] ?? 'dock'),
        ]
      })
    })
    const offProblems = bridge.onProblemsChanged((frame) => {
      setProblems(frame.problems)
    })
    const offAppended = bridge.onOutputAppended((frame) => {
      setOutput((previous) => applyOutputAppend(previous, frame))
    })
    const offCleared = bridge.onOutputCleared((frame) => {
      setOutput((previous) => ({
        channels:
          frame.channel === undefined
            ? []
            : previous.channels.filter((entry) => entry.channel !== frame.channel),
      }))
    })
    return () => {
      offExit()
      offOpened()
      offProblems()
      offAppended()
      offCleared()
    }
  }, [])

  useEffect(() => {
    // Closed tabs release their emulators and drop their pane handles;
    // this runs after the shells unmounted, so no shell cleans a
    // disposed engine.
    const live = new Set(tabs.map((tab) => tab.id))
    for (const id of previousTabIds.current) {
      if (live.has(id)) {
        continue
      }

      releasePersistentTerminal(id)
      paneHandles.current.delete(id)
    }
    previousTabIds.current = live
  }, [tabs])

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
          text: plural(UI_TEXT.desktop.workbenchStatusTerminals, tabs.length, {
            count: String(tabs.length),
          }),
          priority: 20,
        },
      ],
    })
  }, [workspace, tabs.length])

  const openFile = useCallback(
    async (filePath: string) => {
      try {
        const result = await desktopBridge().readFile(filePath)
        setOpenFiles((previous) => [
          ...previous.filter((file) => file.path !== result.path),
          { path: result.path, text: result.text, savedText: result.text },
        ])
        const next: WorkbenchLayoutV2 = {
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

  const createFailed = useCallback((error: unknown) => {
    setTerminalCreateError(
      error instanceof Error
        ? `${UI_TEXT.desktop.panelTerminalCreateFailed}: ${error.message}`
        : UI_TEXT.desktop.panelTerminalCreateFailed,
    )
  }, [])

  const newTerminal = useCallback(
    async (slot: 'dock' | 'window') => {
      if (workspace === null) return
      try {
        const created = await desktopBridge().createTerminal({
          cwd: workspace.root,
          cols: DESKTOP_TERMINAL_DEFAULT_COLS,
          rows: DESKTOP_TERMINAL_DEFAULT_ROWS,
        })
        // The opened event adds the tab too; both add-if-missing, so the
        // race either way lands one tab.
        setTabs((previous) =>
          previous.some((tab) => tab.id === created.id)
            ? previous
            : [...previous, sessionToTab(created, slot)],
        )
        const current = layoutRef.current
        await persistLayout({
          ...current,
          terminalPlacement:
            current.terminalPlacement === 'hidden' || current.terminalPlacement === 'footer'
              ? 'docked'
              : current.terminalPlacement,
          tabSlots: { ...current.tabSlots, [created.id]: slot },
          activeTerminalId: created.id,
          activePaneId: created.id,
        })
        setTerminalCreateError(null)
      } catch (error: unknown) {
        createFailed(error)
      }
    },
    [createFailed, persistLayout, workspace],
  )

  const doClose = useCallback(
    async (id: string) => {
      desktopBridge().closeTerminal(id)
      const outcome = nextTerminalAfterClose(
        tabsRef.current,
        id,
        layoutRef.current.activeTerminalId,
      )
      setTabs(outcome.tabs)
      const current = layoutRef.current
      const live = new Set(outcome.tabs.map((tab) => tab.id))
      const activeTerminalId =
        outcome.activeId !== undefined && live.has(outcome.activeId)
          ? outcome.activeId
          : outcome.tabs[0]?.id
      await persistLayout({
        ...current,
        splits:
          current.splits === undefined ? undefined : (closePane(current.splits, id) ?? undefined),
        tabSlots: Object.fromEntries(
          Object.entries(current.tabSlots).filter(([entry]) => entry !== id),
        ),
        activeTerminalId,
        activePaneId:
          current.activePaneId !== undefined &&
          current.activePaneId !== id &&
          live.has(current.activePaneId)
            ? current.activePaneId
            : activeTerminalId,
      })
    },
    [persistLayout],
  )

  const requestClose = useCallback(
    (id: string) => {
      const tab = tabsRef.current.find((entry) => entry.id === id)
      if (tab === undefined) return
      if (tab.exitCode !== undefined) {
        void doClose(id)
        return
      }
      void (async () => {
        let children: { hasChildren: boolean } | null
        try {
          children = await desktopBridge().hasTerminalChildren(id)
        } catch (error: unknown) {
          // The probe cannot tell (the session raced its exit): ask, as
          // the exit question's unknown-means-ask rule requires.
          if (!(error instanceof Error)) throw error
          children = null
        }
        if (children !== null && !shouldConfirmTerminalClose(false, children.hasChildren)) {
          await doClose(id)
          return
        }
        setPendingClose({ id, title: tab.title })
      })()
    },
    [doClose],
  )

  const confirmClose = useCallback(() => {
    const pending = pendingCloseRef.current
    setPendingClose(null)
    if (pending !== null) void doClose(pending.id)
  }, [doClose])

  const cancelClose = useCallback(() => {
    setPendingClose(null)
  }, [])

  const selectTab = useCallback(
    (id: string) => {
      const current = layoutRef.current
      if (current.activeTerminalId === id && current.activePaneId === id) return
      void persistLayout({ ...current, activeTerminalId: id, activePaneId: id })
    },
    [persistLayout],
  )

  const registerPane = useCallback((id: string, handle: TerminalPaneHandle | null) => {
    if (handle === null) paneHandles.current.delete(id)
    else paneHandles.current.set(id, handle)
  }, [])

  const paneHandleFor = useCallback(
    (id: string): TerminalPaneHandle | null => paneHandles.current.get(id) ?? null,
    [],
  )

  const activateTab = useCallback(
    (id: string) => {
      // A clicked tab shows its terminal and takes focus; arrows select
      // through selectTab and stay in the strip.
      const current = layoutRef.current
      if (
        current.activeTerminalId !== id ||
        current.activePaneId !== id ||
        current.panelView !== 'terminal'
      ) {
        void persistLayout({
          ...current,
          activeTerminalId: id,
          activePaneId: id,
          panelView: 'terminal',
        })
      }
      const handle = paneHandleFor(id)
      if (handle === null) {
        pendingFocus.current = { kind: 'pane', id }
      } else {
        handle.focusPane()
        pendingFocus.current = null
      }
    },
    [paneHandleFor, persistLayout],
  )

  const returnTab = useCallback(
    (id: string) => {
      // A footer tab returns to the dock, selected and focused.
      setTabs((previous) => moveTabToSlot(previous, id, 'dock'))
      const current = layoutRef.current
      void persistLayout({
        ...current,
        tabSlots: { ...current.tabSlots, [id]: 'dock' },
        activeTerminalId: id,
        activePaneId: id,
        panelView: 'terminal',
      })
      const handle = paneHandleFor(id)
      if (handle === null) {
        pendingFocus.current = { kind: 'pane', id }
      } else {
        handle.focusPane()
        pendingFocus.current = null
      }
    },
    [paneHandleFor, persistLayout],
  )

  const moveTab = useCallback(
    (id: string, slot: TerminalSlot) => {
      const next = moveTabToSlot(tabsRef.current, id, slot)
      if (next === tabsRef.current) return
      setTabs(next)
      const current = layoutRef.current
      void persistLayout({
        ...current,
        splits:
          slot === 'dock' || current.splits === undefined
            ? current.splits
            : (closePane(current.splits, id) ?? undefined),
        tabSlots: { ...current.tabSlots, [id]: slot },
      })
    },
    [persistLayout],
  )

  const selectView = useCallback(
    (view: PanelView) => {
      const current = layoutRef.current
      if (current.panelView !== view) void persistLayout({ ...current, panelView: view })
    },
    [persistLayout],
  )

  const expandView = useCallback(
    (view: PanelView) => {
      void persistLayout(moveTerminal({ ...layoutRef.current, panelView: view }, 'expand'))
    },
    [persistLayout],
  )

  const movePanel = useCallback(
    (move: TerminalMove) => {
      void persistLayout(moveTerminal(layoutRef.current, move))
    },
    [persistLayout],
  )

  const togglePin = useCallback(() => {
    const current = layoutRef.current
    void persistLayout({ ...current, panelPinned: !current.panelPinned })
  }, [persistLayout])

  const toggleOnTop = useCallback(() => {
    const current = layoutRef.current
    void persistLayout({ ...current, floatingOnTop: !(current.floatingOnTop ?? false) })
  }, [persistLayout])

  const splitsChanged = useCallback(
    (splits: SplitNode | null, shouldPersist: boolean) => {
      const next: WorkbenchLayoutV2 = { ...layoutRef.current, splits: splits ?? undefined }
      if (shouldPersist) void persistLayout(next)
      else updateLayout(next)
    },
    [persistLayout, updateLayout],
  )

  const floatingBoundsChanged = useCallback(
    (bounds: FloatingBounds, shouldPersist: boolean) => {
      const next: WorkbenchLayoutV2 = { ...layoutRef.current, floatingBounds: bounds }
      if (shouldPersist) void persistLayout(next)
      else updateLayout(next)
    },
    [persistLayout, updateLayout],
  )

  const openProblemFile = useCallback(
    (path: string) => {
      // The line reveal is ED's, with the editor; the panel opens the file.
      void openFile(path)
    },
    [openFile],
  )

  const clearOutput = useCallback((channel: string | undefined) => {
    desktopBridge().clearOutput(channel)
  }, [])

  const dismissCreateError = useCallback(() => {
    setTerminalCreateError(null)
  }, [])

  const openSearch = useCallback(
    (id: string | undefined) => {
      if (id === undefined) return
      const current = layoutRef.current
      const handle = paneHandleFor(id)
      if (
        handle !== null &&
        current.panelView === 'terminal' &&
        (current.terminalPlacement === 'docked' || current.terminalPlacement === 'floating')
      ) {
        selectTab(id)
        handle.openSearch()
        pendingFocus.current = null
        return
      }
      const tab = tabsRef.current.find((entry) => entry.id === id)
      if (tab === undefined) {
        pendingFocus.current = null
        return
      }
      pendingFocus.current = { kind: 'search', id }
      if (tab.slot === 'footer') {
        moveTab(id, current.terminalPlacement === 'floating' ? 'window' : 'dock')
      }
      if (current.terminalPlacement === 'hidden') movePanel('show')
      else if (current.terminalPlacement === 'footer') movePanel('expand')
      if (current.panelView !== 'terminal') selectView('terminal')
      selectTab(id)
    },
    [movePanel, moveTab, paneHandleFor, selectTab, selectView],
  )

  const focusTerminalPane = useCallback(
    (id?: string) => {
      const current = layoutRef.current
      const target = id ?? current.activePaneId ?? current.activeTerminalId
      if (target === undefined) return
      const handle = paneHandleFor(target)
      if (
        handle !== null &&
        current.panelView === 'terminal' &&
        (current.terminalPlacement === 'docked' || current.terminalPlacement === 'floating')
      ) {
        handle.focusPane()
        pendingFocus.current = null
        return
      }
      const tab = tabsRef.current.find((entry) => entry.id === target)
      if (tab === undefined) {
        pendingFocus.current = null
        return
      }
      pendingFocus.current = { kind: 'pane', id: target }
      if (tab.slot === 'footer') {
        moveTab(target, current.terminalPlacement === 'floating' ? 'window' : 'dock')
      }
      if (current.terminalPlacement === 'hidden') movePanel('show')
      else if (current.terminalPlacement === 'footer') movePanel('expand')
      if (current.panelView !== 'terminal') selectView('terminal')
      selectTab(target)
    },
    [movePanel, moveTab, paneHandleFor, selectTab, selectView],
  )

  const focusProblems = useCallback(() => {
    const current = layoutRef.current
    if (
      current.panelView === 'problems' &&
      (current.terminalPlacement === 'docked' || current.terminalPlacement === 'floating') &&
      problemsListRef.current !== null
    ) {
      problemsListRef.current.focus()
      pendingFocus.current = null
      return
    }
    if (current.terminalPlacement === 'hidden') movePanel('show')
    else if (current.terminalPlacement === 'footer') movePanel('expand')
    if (current.panelView !== 'problems') selectView('problems')
    pendingFocus.current = { kind: 'problems' }
  }, [movePanel, selectView])

  const focusOutput = useCallback(() => {
    const current = layoutRef.current
    if (
      current.panelView === 'output' &&
      (current.terminalPlacement === 'docked' || current.terminalPlacement === 'floating') &&
      outputWrapRef.current !== null
    ) {
      outputWrapRef.current.focus()
      pendingFocus.current = null
      return
    }
    if (current.terminalPlacement === 'hidden') movePanel('show')
    else if (current.terminalPlacement === 'footer') movePanel('expand')
    if (current.panelView !== 'output') selectView('output')
    pendingFocus.current = { kind: 'output' }
  }, [movePanel, selectView])

  const splitPane = useCallback(
    async (id: string) => {
      if (workspace === null) return
      try {
        const created = await desktopBridge().createTerminal({
          cwd: workspace.root,
          cols: DESKTOP_TERMINAL_DEFAULT_COLS,
          rows: DESKTOP_TERMINAL_DEFAULT_ROWS,
        })
        const current = layoutRef.current
        // Splits live in the dock: the split tab joins it, and splitting
        // outside the split view starts a new split there (the old
        // panes' tabs remain as tabs).
        const base: SplitNode =
          current.splits !== undefined && paneTerminalIds(current.splits).includes(id)
            ? current.splits
            : { kind: 'leaf', terminalId: id }
        const grown = splitLeaf(base, id, created.id, 'right')
        setTabs((previous) => {
          const added = previous.some((tab) => tab.id === created.id)
            ? previous
            : [...previous, sessionToTab(created, 'dock')]
          return moveTabToSlot(added, id, 'dock')
        })
        await persistLayout({
          ...current,
          terminalPlacement:
            current.terminalPlacement === 'hidden' || current.terminalPlacement === 'footer'
              ? 'docked'
              : current.terminalPlacement,
          splits: grown,
          tabSlots: { ...current.tabSlots, [created.id]: 'dock', [id]: 'dock' },
          activeTerminalId: created.id,
          activePaneId: created.id,
        })
        setTerminalCreateError(null)
      } catch (error: unknown) {
        createFailed(error)
      }
    },
    [createFailed, persistLayout, workspace],
  )

  const adjustPanelHeight = useCallback(
    (delta: number) => {
      const current = layoutRef.current
      if (current.terminalPlacement === 'docked') {
        void persistLayout({
          ...current,
          terminalHeightPx: resizePanelHeightPx(current.terminalHeightPx, delta),
        })
        return
      }
      if (current.terminalPlacement !== 'floating') return
      const measured = document.querySelector('.muse-panel-floating')?.getBoundingClientRect()
      const bounds =
        current.floatingBounds ?? (measured === undefined ? null : floatingBoundsFromRect(measured))
      if (bounds === null) return
      void persistLayout({
        ...current,
        floatingBounds: { ...bounds, heightPx: resizeFloatingHeightPx(bounds.heightPx, delta) },
      })
    },
    [persistLayout],
  )

  // Satisfies the panel's focus requests after every commit: panes and
  // searches wait for their shell to mount (a move lands it a commit
  // later); Problems and Output focus once their view renders. A closed
  // tab clears its request instead of hanging it.
  useEffect(() => {
    const pending = pendingFocus.current
    if (pending === null) return
    const isPlaced =
      layout.terminalPlacement === 'docked' || layout.terminalPlacement === 'floating'
    if (pending.kind === 'problems') {
      if (isPlaced && layout.panelView === 'problems') {
        problemsListRef.current?.focus()
        pendingFocus.current = null
      }
      return
    }
    if (pending.kind === 'output') {
      if (isPlaced && layout.panelView === 'output') {
        outputWrapRef.current?.focus()
        pendingFocus.current = null
      }
      return
    }
    const id = pending.id ?? layout.activePaneId ?? layout.activeTerminalId
    if (id === undefined || tabs.every((tab) => tab.id !== id)) {
      pendingFocus.current = null
      return
    }
    const handle = paneHandles.current.get(id)
    if (handle === undefined) return
    if (pending.kind === 'search') handle.openSearch()
    else handle.focusPane()
    pendingFocus.current = null
  })

  useEffect(() => {
    // A closed tab or dialog leaves focus on the body; return it to the
    // selected tab instead of stranding it. The first run is the load,
    // which takes no focus.
    if (firstFocusReturn.current) {
      firstFocusReturn.current = false
      return
    }
    if (document.activeElement !== document.body) return
    const id = layout.activeTerminalId
    if (id === undefined) return
    document.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)?.focus()
  }, [tabs, pendingClose, layout.activeTerminalId])

  const isWorkbenchChord: IsWorkbenchChord = useCallback((event) => {
    const binding = registry.commandForChord(chordFromEvent(event))
    return binding !== undefined && isBindingActive(binding, 'terminal')
  }, [])

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
          movePanel(current.terminalPlacement === 'hidden' ? 'show' : 'hide')
          break
        }
        case 'workbench.newTerminal': {
          void newTerminal(current.terminalPlacement === 'floating' ? 'window' : 'dock')
          break
        }
        case 'workbench.splitTerminal': {
          const id = current.activePaneId ?? current.activeTerminalId
          if (id !== undefined) void splitPane(id)
          break
        }
        case 'workbench.killTerminal': {
          const id = current.activeTerminalId
          if (id !== undefined) requestClose(id)
          break
        }
        case 'workbench.detachTerminal': {
          movePanel('detach')
          break
        }
        case 'workbench.dockTerminal': {
          movePanel('dock')
          break
        }
        case 'workbench.collapseTerminal': {
          movePanel('collapse')
          break
        }
        case 'workbench.pinTerminal': {
          togglePin()
          break
        }
        case 'workbench.panelTaller': {
          adjustPanelHeight(DESKTOP_PANEL_KEYBOARD_RESIZE_PX)
          break
        }
        case 'workbench.panelShorter': {
          adjustPanelHeight(-DESKTOP_PANEL_KEYBOARD_RESIZE_PX)
          break
        }
        case 'workbench.terminalSearch': {
          openSearch(current.activePaneId ?? current.activeTerminalId)
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
          focusTerminalPane()
          break
        }
        case 'workbench.focusProblems': {
          focusProblems()
          break
        }
        case 'workbench.focusOutput': {
          focusOutput()
          break
        }
        case 'workbench.focusSidebar': {
          sidebarRef.current?.focus()
          break
        }
        case 'workbench.saveFile': {
          const active = openFilesRef.current.find((file) => file.path === current.activeFile)
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
    [
      adjustPanelHeight,
      focusOutput,
      focusProblems,
      focusTerminalPane,
      movePanel,
      newTerminal,
      openSearch,
      persistLayout,
      requestClose,
      splitPane,
      togglePin,
    ],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // The exit dialog is modal: no chord fires while it asks.
      if (pendingCloseRef.current !== null) return
      const binding = registry.commandForChord(chordFromEvent(event))
      if (binding === undefined || !isBindingActive(binding, focusRef.current)) return
      const command = WORKBENCH_COMMANDS.find((entry) => entry === binding.command)
      if (command === undefined) return
      event.preventDefault()
      runCommand(command)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [runCommand])

  const onRootFocus = (event: FocusEvent): void => {
    // The dispatcher's `when`: the editor and the terminal regions say
    // so, everywhere else is other.
    const target = event.target
    const regionElement =
      target instanceof HTMLElement ? target.closest('[data-focus-region]') : null
    const region =
      regionElement instanceof HTMLElement ? regionElement.dataset['focusRegion'] : null
    let focus: WorkbenchFocus = 'other'
    if (region === 'editor') focus = 'editor'
    else if (region === 'terminal') focus = 'terminal'
    focusRef.current = focus
  }

  const onSeparatorPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    separatorDrag.current = {
      startY: event.clientY,
      startHeight: layoutRef.current.terminalHeightPx,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onSeparatorPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = separatorDrag.current
    if (drag === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    updateLayout({
      ...layoutRef.current,
      terminalHeightPx: resizePanelHeightPx(drag.startHeight, drag.startY - event.clientY),
    })
  }

  const onSeparatorPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (separatorDrag.current === null || !event.currentTarget.hasPointerCapture(event.pointerId)) {
      return
    }
    event.currentTarget.releasePointerCapture(event.pointerId)
    separatorDrag.current = null
    void persistLayout(layoutRef.current)
  }

  const onSeparatorKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      const action = webviewKey('desktop.panelResize', event)
      if (action === undefined) return
      const height = separatorHeight(action, layoutRef.current.terminalHeightPx)
      if (height === undefined) return
      event.preventDefault()
      event.stopPropagation()
      void persistLayout({ ...layoutRef.current, terminalHeightPx: height })
    },
    [persistLayout],
  )

  if (error !== null && workspace === null) {
    return (
      <main className="muse-desktop-setup" aria-label={UI_TEXT.desktop.workbenchSetupTitle}>
        <h1>{UI_TEXT.desktop.workbenchSetupTitle}</h1>
        <p role="alert">{error}</p>
      </main>
    )
  }

  const panelState: BottomPanelState = {
    tabs,
    activeTerminalId: layout.activeTerminalId,
    activePaneId: layout.activePaneId,
    splits: layout.splits ?? null,
    placement: layout.terminalPlacement,
    panelView: layout.panelView,
    terminalHeightPx: layout.terminalHeightPx,
    panelPinned: layout.panelPinned,
    floatingOnTop: layout.floatingOnTop ?? false,
    floatingBounds: layout.floatingBounds,
    problems,
    output,
    terminalCreateError,
    dialogOpen: pendingClose !== null,
  }

  const panelActions: BottomPanelActions = {
    selectTab,
    requestClose,
    newTerminal: (slot) => {
      void newTerminal(slot)
    },
    splitPane: (id) => {
      void splitPane(id)
    },
    openSearch,
    selectView,
    expandView,
    movePanel,
    togglePin,
    toggleOnTop,
    moveTab,
    splitsChanged,
    floatingBoundsChanged,
    openFile: openProblemFile,
    clearOutput,
    dismissCreateError,
    activateTab,
    returnTab,
  }

  const activeFile = openFiles.find((file) => file.path === layout.activeFile)
  const quickOpenResults = rankQuickOpen(quickOpenQuery, files).slice(
    0,
    DESKTOP_QUICK_OPEN_MAX_RESULTS,
  )
  const isDialogOpen = pendingClose !== null
  const windowTabs = tabsInSlot(tabs, 'window')
  const footerTabs = tabsInSlot(tabs, 'footer')

  return (
    <div
      className="muse-desktop"
      data-setup={workspace?.setupMode ? 'true' : undefined}
      onFocusCapture={onRootFocus}
    >
      <section
        ref={chatRef}
        tabIndex={-1}
        aria-label={UI_TEXT.desktop.workbenchChat}
        className="muse-desktop-chat"
        style={{ inlineSize: `${String(layout.chatWidthPx)}px` }}
        inert={isDialogOpen}
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

      <div className="muse-desktop-centre" inert={isDialogOpen}>
        <section
          ref={editorRef}
          tabIndex={-1}
          aria-label={UI_TEXT.desktop.workbenchEditor}
          data-focus-region="editor"
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

        {layout.terminalPlacement === 'docked' ? (
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={UI_TEXT.desktop.panelResizeHandle}
            aria-valuemin={DESKTOP_LAYOUT_BOUNDS.terminalHeightMinPx}
            aria-valuemax={DESKTOP_LAYOUT_BOUNDS.terminalHeightMaxPx}
            aria-valuenow={layout.terminalHeightPx}
            tabIndex={0}
            className="muse-panel-separator"
            onPointerDown={onSeparatorPointerDown}
            onPointerMove={onSeparatorPointerMove}
            onPointerUp={onSeparatorPointerUp}
            onPointerCancel={onSeparatorPointerUp}
            onKeyDown={onSeparatorKeyDown}
          />
        ) : null}

        {layout.terminalPlacement === 'docked' ? (
          <section
            data-focus-region="terminal"
            aria-label={UI_TEXT.desktop.panelRegion}
            className="muse-desktop-terminal"
            style={{ blockSize: `${String(layout.terminalHeightPx)}px` }}
          >
            <BottomPanel
              location="dock"
              state={panelState}
              actions={panelActions}
              problemsListRef={problemsListRef}
              outputWrapRef={outputWrapRef}
              registerPane={registerPane}
              isWorkbenchChord={isWorkbenchChord}
            />
          </section>
        ) : null}

        {layout.terminalPlacement === 'footer' || footerTabs.length > 0 ? (
          <footer className="muse-desktop-footer">
            <FooterPanelStrip state={panelState} actions={panelActions} />
          </footer>
        ) : null}

        {layout.terminalPlacement === 'floating' || windowTabs.length > 0 ? (
          <BottomPanel
            location="window"
            state={panelState}
            actions={panelActions}
            problemsListRef={problemsListRef}
            outputWrapRef={outputWrapRef}
            registerPane={registerPane}
            isWorkbenchChord={isWorkbenchChord}
          />
        ) : null}
      </div>

      {layout.railVisible ? (
        <nav
          aria-label={UI_TEXT.desktop.workbenchSidebar}
          className="muse-desktop-rail"
          inert={isDialogOpen}
        >
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
          inert={isDialogOpen}
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
              setQuickOpenQuery(event.currentTarget.value)
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

      <ExitConfirmDialog pending={pendingClose} onConfirm={confirmClose} onCancel={cancelClose} />
    </div>
  )
}
