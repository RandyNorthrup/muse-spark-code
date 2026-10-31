// Muse Desktop (M111, D91.13) lane BP: the bottom panel's chrome. The
// docked panel, the floating window and the footer strip share this
// header (the panel views, the terminal tabs, the toolbar) over the
// terminal panes, Problems and Output. The terminal shells mount here;
// their emulators persist in terminalEngine, so a tab dragged between
// the dock, the window and the footer keeps its transcript. DesktopApp
// owns the state (tabs, layout, subscriptions) and the panel API;
// this module renders and reports back through BottomPanelActions.
import {
  type DragEvent,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  Component,
  Suspense,
  lazy,
  useRef,
  useState,
} from 'react'
import {
  DESKTOP_FLOATING_MIN_HEIGHT_PX,
  DESKTOP_FLOATING_MIN_WIDTH_PX,
  DESKTOP_PANEL_KEYBOARD_RESIZE_PX,
  DESKTOP_SPLIT_KEYBOARD_STEP,
  DESKTOP_SPLIT_MIN_FRACTION,
  UI_TEXT,
} from '../../../shared/constants'
import {
  FOOTER_TABS,
  type FloatingBounds,
  type OutputSnapshot,
  type PanelProblem,
  type SplitNode,
  type TerminalPlacement,
  type TerminalSlot,
} from '../../../shared/desktop/bridge'
import {
  floatingBoundsFromRect,
  paneTerminalIds,
  problemsCounts,
  resizeSplitSizes,
  tabsInSlot,
  type PanelTerminalTab,
  type PanelView,
} from '../../../shared/desktop/panel'
import type { TerminalMove } from '../../../shared/desktop/workbench'
import { webviewKey } from '../../../shared/keybindings'
import { fill, formatNumber } from '../../../shared/l10n/text'
import './panel.css'
import { OutputView } from './OutputView'
import { ProblemsView } from './ProblemsView'
import type { IsWorkbenchChord } from './terminalEngine'
import { type TerminalPaneHandle, type TerminalViewProps } from './TerminalView'

async function loadTerminalView(): Promise<{
  default: (properties: TerminalViewProps) => ReactNode
}> {
  const { TerminalView } = await import('./TerminalView')
  return { default: TerminalView }
}

/** A tab as the workbench knows it, plus the exit the renderer last saw. */
export type BottomPanelTab = PanelTerminalTab & {
  readonly exitCode: number | null | undefined
}

export interface BottomPanelState {
  readonly tabs: readonly BottomPanelTab[]
  readonly activeTerminalId: string | undefined
  readonly activePaneId: string | undefined
  readonly splits: SplitNode | null
  readonly placement: TerminalPlacement
  readonly panelView: PanelView
  readonly terminalHeightPx: number
  readonly panelPinned: boolean
  readonly floatingOnTop: boolean
  readonly floatingBounds: FloatingBounds | undefined
  readonly problems: readonly PanelProblem[]
  readonly output: OutputSnapshot
  readonly terminalCreateError: string | null
  readonly dialogOpen: boolean
}

export interface BottomPanelActions {
  readonly selectTab: (id: string) => void
  readonly activateTab: (id: string) => void
  readonly returnTab: (id: string) => void
  readonly requestClose: (id: string) => void
  readonly newTerminal: (slot: 'dock' | 'window') => void
  readonly splitPane: (id: string) => void
  readonly openSearch: (id: string | undefined) => void
  readonly selectView: (view: PanelView) => void
  readonly expandView: (view: PanelView) => void
  readonly movePanel: (move: TerminalMove) => void
  readonly togglePin: () => void
  readonly toggleOnTop: () => void
  readonly moveTab: (id: string, slot: TerminalSlot) => void
  readonly splitsChanged: (splits: SplitNode | null, shouldPersist: boolean) => void
  readonly floatingBoundsChanged: (bounds: FloatingBounds, shouldPersist: boolean) => void
  readonly openFile: (path: string, line: number) => void
  readonly clearOutput: (channel: string | undefined) => void
  readonly dismissCreateError: () => void
}

export interface BottomPanelProperties {
  readonly location: 'dock' | 'window'
  readonly state: BottomPanelState
  readonly actions: BottomPanelActions
  readonly problemsListRef: RefObject<HTMLUListElement | null>
  readonly outputWrapRef: RefObject<HTMLDivElement | null>
  readonly registerPane: (id: string, handle: TerminalPaneHandle | null) => void
  readonly isWorkbenchChord: IsWorkbenchChord
}

const TERMINAL_TAB_MIME = 'text/muse-terminal-tab'

function viewLabel(view: PanelView): string {
  switch (view) {
    case 'terminal': {
      return UI_TEXT.desktop.workbenchTerminal
    }
    case 'problems': {
      return UI_TEXT.desktop.workbenchProblems
    }
    case 'output': {
      return UI_TEXT.desktop.workbenchOutput
    }
  }
}

function agentTabText(tab: BottomPanelTab & { readonly source: 'agent' }): string {
  return `${tab.agent.label} · ${tab.agent.command}`
}

function tabText(tab: BottomPanelTab): string {
  return tab.source === 'agent'
    ? `${agentTabText(tab)} · ${UI_TEXT.desktop.panelReadOnly}`
    : tab.title
}

function tabAccessibleName(tab: BottomPanelTab): string | undefined {
  return tab.exitCode === undefined
    ? undefined
    : fill(UI_TEXT.desktop.panelTabExited, { title: tabText(tab), code: tab.exitCode ?? '—' })
}

// A tab strip with roving tabindex: arrows move at the strip level and
// focus the newly selected tab by data-tab-id (no per-tab ref map), and
// Ctrl+Up/Down moves a terminal tab between the window, the dock and the
// footer for pointer-free dragging.
function TabStrip(properties: {
  readonly label: string
  readonly ids: readonly string[]
  readonly onSelect: (id: string) => void
  readonly onMoveSlot?: (id: string, direction: 'up' | 'down') => void
  readonly children: ReactNode
}): ReactNode {
  const { ids, onSelect, onMoveSlot } = properties
  const onStripKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // The closest tab owns the key even from a button inside it (Stop,
    // the close button), so arrows move from anywhere on the tab.
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return
    const tab = active.closest('[data-tab-id]')
    const tabId = tab instanceof HTMLElement ? tab.dataset['tabId'] : undefined
    if (tabId === undefined || ids.length === 0) return
    const action = webviewKey('desktop.panelTabs', event)
    if (action === undefined) return
    if (action === 'moveUp' || action === 'moveDown') {
      if (onMoveSlot === undefined) return
      event.preventDefault()
      event.stopPropagation()
      onMoveSlot(tabId, action === 'moveUp' ? 'up' : 'down')
      return
    }
    const index = ids.indexOf(tabId)
    if (index === -1) return
    let next: number
    switch (action) {
      case 'next': {
        next = (index + 1) % ids.length
        break
      }
      case 'previous': {
        next = (index + ids.length - 1) % ids.length
        break
      }
      case 'first': {
        next = 0
        break
      }
      default: {
        next = ids.length - 1
      }
    }
    event.preventDefault()
    event.stopPropagation()
    const id = ids[next]
    if (id === undefined) return
    onSelect(id)
    const strip = event.currentTarget
    globalThis.queueMicrotask(() => {
      strip.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)?.focus()
    })
  }
  return (
    <div role="tablist" aria-label={properties.label} onKeyDown={onStripKeyDown}>
      {properties.children}
    </div>
  )
}

// The lazy chunk's honest failure: what went wrong and a retry that
// remounts the loader, so the chunk fetch runs again (a remount of the
// same lazy component would reuse its rejected promise).
class TerminalChunkBoundary extends Component<
  { readonly title: string; readonly onRetry: () => void; readonly children: ReactNode },
  { readonly failed: boolean }
> {
  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true }
  }

  override state = { failed: false }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <div role="alert" className="muse-panel-chunk-failed">
          <p>
            {this.props.title}: {UI_TEXT.desktop.panelTerminalFailed}
          </p>
          <button
            type="button"
            onClick={() => {
              this.props.onRetry()
              this.setState({ failed: false })
            }}
          >
            {UI_TEXT.desktop.panelRetry}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function TerminalViewLoader(properties: TerminalViewProps): ReactNode {
  const [View] = useState(() => lazy(loadTerminalView))
  return <View {...properties} />
}

function TerminalPaneShell(properties: {
  readonly tab: BottomPanelTab
  readonly registerPane: (id: string, handle: TerminalPaneHandle | null) => void
  readonly isWorkbenchChord: IsWorkbenchChord
  readonly onFocusPane: (id: string) => void
}): ReactNode {
  const { tab, registerPane, isWorkbenchChord, onFocusPane } = properties
  const [attempt, setAttempt] = useState(0)
  return (
    <div className="muse-panel-terminal-shell" data-shell-id={tab.id}>
      <TerminalChunkBoundary
        title={tabText(tab)}
        onRetry={() => {
          setAttempt((count) => count + 1)
        }}
      >
        <Suspense
          fallback={
            <p role="status" className="muse-panel-terminal-loading">
              {UI_TEXT.desktop.panelTerminalLoading}
            </p>
          }
        >
          <TerminalViewLoader
            key={attempt}
            tabId={tab.id}
            title={tabText(tab)}
            isReadOnly={tab.source === 'agent'}
            isWorkbenchChord={isWorkbenchChord}
            onFocusPane={onFocusPane}
            registerPane={registerPane}
          />
        </Suspense>
      </TerminalChunkBoundary>
    </div>
  )
}

function clampPair(total: number, value: number): number {
  return Math.min(Math.max(value, DESKTOP_SPLIT_MIN_FRACTION), total - DESKTOP_SPLIT_MIN_FRACTION)
}

function percentOf(fraction: number): number {
  return Math.round(fraction * 100)
}

function capturePointer(event: ReactPointerEvent<HTMLDivElement>): void {
  event.currentTarget.setPointerCapture(event.pointerId)
}

// A dragged terminal tab hovers a drop zone: the drop is allowed (each
// zone owns its highlight state through its enter and leave handlers).
function acceptTabDrag(event: DragEvent<HTMLDivElement>): void {
  if (!event.dataTransfer.types.includes(TERMINAL_TAB_MIME)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
}

// One divider between two split panes: pointer drags resize live (the
// layout persists on release), and the arrow keys step by twentieths
// (persisting at once, as discrete moves). The value is the leading
// pane's percentage of the split.
function SplitSash(properties: {
  readonly direction: 'right' | 'down'
  readonly sizes: readonly number[]
  readonly index: number
  readonly path: readonly number[]
  readonly onSash: (
    path: readonly number[],
    sizes: readonly number[],
    shouldPersist: boolean,
  ) => void
}): ReactNode {
  const { direction, sizes, index, path, onSash } = properties
  const latest = useRef<readonly number[]>(sizes)
  const pairTotal = (sizes[index] ?? 0) + (sizes[index + 1] ?? 0)

  const resizePair = (leading: number): void => {
    const next = sizes.map((size, at) => {
      if (at === index) return leading
      return at === index + 1 ? pairTotal - leading : size
    })
    latest.current = next
    onSash(path, next, false)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const container = event.currentTarget.parentElement
    if (container === null) return
    const rect = container.getBoundingClientRect()
    const length = direction === 'right' ? rect.width : rect.height
    if (length <= 0) return
    const at = direction === 'right' ? event.clientX - rect.left : event.clientY - rect.top
    const before = sizes.slice(0, index).reduce((sum, size) => sum + size, 0)
    resizePair(clampPair(pairTotal, at / length - before))
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    onSash(path, latest.current, true)
  }

  const onSashKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const action = webviewKey('desktop.panelResize', event)
    if (action === undefined) return
    const isHorizontal = direction === 'right'
    const leading = sizes[index] ?? 0
    let next: number | undefined
    if (action === 'first') next = DESKTOP_SPLIT_MIN_FRACTION
    else if (action === 'last') next = pairTotal - DESKTOP_SPLIT_MIN_FRACTION
    else if (isHorizontal && action === 'narrower') next = leading - DESKTOP_SPLIT_KEYBOARD_STEP
    else if (isHorizontal && action === 'wider') next = leading + DESKTOP_SPLIT_KEYBOARD_STEP
    else if (!isHorizontal && action === 'increase') next = leading - DESKTOP_SPLIT_KEYBOARD_STEP
    else if (!isHorizontal && action === 'decrease') next = leading + DESKTOP_SPLIT_KEYBOARD_STEP
    if (next === undefined) return
    event.preventDefault()
    event.stopPropagation()
    const target = clampPair(pairTotal, next)
    const resized = sizes.map((size, at) => {
      if (at === index) return target
      return at === index + 1 ? pairTotal - target : size
    })
    onSash(path, resized, true)
  }

  return (
    <div
      role="separator"
      aria-orientation={direction === 'right' ? 'vertical' : 'horizontal'}
      aria-label={UI_TEXT.desktop.panelSash}
      aria-valuemin={percentOf(DESKTOP_SPLIT_MIN_FRACTION)}
      aria-valuemax={percentOf(1 - DESKTOP_SPLIT_MIN_FRACTION)}
      aria-valuenow={percentOf(sizes[index] ?? 0)}
      tabIndex={0}
      className="muse-panel-sash"
      onPointerDown={capturePointer}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onSashKeyDown}
    />
  )
}

function SplitView(properties: {
  readonly node: SplitNode
  readonly path: readonly number[]
  readonly tabs: ReadonlyMap<string, BottomPanelTab>
  readonly registerPane: (id: string, handle: TerminalPaneHandle | null) => void
  readonly isWorkbenchChord: IsWorkbenchChord
  readonly onFocusPane: (id: string) => void
  readonly onSash: (
    path: readonly number[],
    sizes: readonly number[],
    shouldPersist: boolean,
  ) => void
}): ReactNode {
  const { node, path, tabs, registerPane, isWorkbenchChord, onFocusPane, onSash } = properties
  if (node.kind === 'leaf') {
    const tab = tabs.get(node.terminalId)
    if (tab === undefined) return null
    return (
      <TerminalPaneShell
        tab={tab}
        registerPane={registerPane}
        isWorkbenchChord={isWorkbenchChord}
        onFocusPane={onFocusPane}
      />
    )
  }
  return (
    <div
      className={node.direction === 'right' ? 'muse-panel-split-row' : 'muse-panel-split-column'}
    >
      {node.children.flatMap((child, index) => {
        // Keys follow the leaves, never the position: a pane closing
        // beside a split must not move its sashes' drag state.
        const cellKey =
          child.kind === 'leaf' ? child.terminalId : `split:${paneTerminalIds(child).join('+')}`
        const cell = (
          <div
            key={cellKey}
            className="muse-panel-split-cell"
            style={{ flexGrow: node.sizes[index] ?? 1, flexBasis: 0 }}
          >
            <SplitView
              node={child}
              path={[...path, index]}
              tabs={tabs}
              registerPane={registerPane}
              isWorkbenchChord={isWorkbenchChord}
              onFocusPane={onFocusPane}
              onSash={onSash}
            />
          </div>
        )
        if (index === node.children.length - 1) return [cell]
        return [
          cell,
          <SplitSash
            key={`sash:${cellKey}`}
            direction={node.direction}
            sizes={node.sizes}
            index={index}
            path={path}
            onSash={onSash}
          />,
        ]
      })}
    </div>
  )
}

function TerminalArea(properties: {
  readonly locationTabs: readonly BottomPanelTab[]
  readonly displayedId: string | undefined
  readonly splits: SplitNode | null
  readonly registerPane: (id: string, handle: TerminalPaneHandle | null) => void
  readonly isWorkbenchChord: IsWorkbenchChord
  readonly onFocusPane: (id: string) => void
  readonly onSash: (
    path: readonly number[],
    sizes: readonly number[],
    shouldPersist: boolean,
  ) => void
  readonly onNewTerminal: () => void
}): ReactNode {
  const { locationTabs, displayedId, splits, registerPane, isWorkbenchChord, onFocusPane, onSash } =
    properties
  if (locationTabs.length === 0) {
    return (
      <div className="muse-panel-terminal-empty">
        <p>{UI_TEXT.desktop.panelNoTerminals}</p>
        <button type="button" onClick={properties.onNewTerminal}>
          {UI_TEXT.desktop.workbenchNewTerminal}
        </button>
      </div>
    )
  }
  const displayed = locationTabs.find((tab) => tab.id === displayedId) ?? locationTabs[0]
  if (displayed === undefined) return null
  if (splits !== null && paneTerminalIds(splits).includes(displayed.id)) {
    return (
      <SplitView
        node={splits}
        path={[]}
        tabs={new Map(locationTabs.map((tab) => [tab.id, tab]))}
        registerPane={registerPane}
        isWorkbenchChord={isWorkbenchChord}
        onFocusPane={onFocusPane}
        onSash={onSash}
      />
    )
  }
  return (
    <TerminalPaneShell
      tab={displayed}
      registerPane={registerPane}
      isWorkbenchChord={isWorkbenchChord}
      onFocusPane={onFocusPane}
    />
  )
}

function agentTabClass(isSelected: boolean, isRunning: boolean): string {
  const classes = ['muse-panel-tab', 'muse-panel-tab-agent']
  if (isSelected) classes.push('muse-panel-tab-active')
  if (!isRunning) classes.push('muse-panel-tab-exited')
  return classes.join(' ')
}

function personTabClass(isSelected: boolean, isRunning: boolean): string {
  const classes = ['muse-panel-tab']
  if (isSelected) classes.push('muse-panel-tab-active')
  if (!isRunning) classes.push('muse-panel-tab-exited')
  return classes.join(' ')
}

function TerminalTabButton(properties: {
  readonly tab: BottomPanelTab
  readonly selected: boolean
  readonly onActivate: (id: string) => void
  readonly onClose: (id: string) => void
}): ReactNode {
  const { tab, selected, onActivate, onClose } = properties
  const onDragStart = (event: DragEvent<HTMLDivElement>): void => {
    event.dataTransfer.setData(TERMINAL_TAB_MIME, tab.id)
    event.dataTransfer.effectAllowed = 'move'
  }
  if (tab.source === 'agent') {
    return (
      <div
        role="tab"
        aria-selected={selected}
        aria-label={tabAccessibleName(tab)}
        tabIndex={selected ? 0 : -1}
        data-tab-id={tab.id}
        draggable
        onDragStart={onDragStart}
        onClick={() => {
          onActivate(tab.id)
        }}
        className={agentTabClass(selected, tab.exitCode === undefined)}
      >
        <span aria-hidden="true" className="muse-panel-tab-glyph">
          @
        </span>
        <span dir="ltr">{agentTabText(tab)}</span>
        <span className="muse-panel-readonly"> · {UI_TEXT.desktop.panelReadOnly}</span>
        <button
          type="button"
          className="muse-panel-stop"
          aria-label={`${UI_TEXT.desktop.panelStop} ${tab.agent.label}`}
          onClick={(event) => {
            event.stopPropagation()
            onClose(tab.id)
          }}
        >
          <span aria-hidden="true">■ </span>
          {UI_TEXT.desktop.panelStop}
        </button>
      </div>
    )
  }
  return (
    <div
      role="tab"
      aria-selected={selected}
      aria-label={tabAccessibleName(tab)}
      tabIndex={selected ? 0 : -1}
      data-tab-id={tab.id}
      draggable
      onDragStart={onDragStart}
      onClick={() => {
        onActivate(tab.id)
      }}
      className={personTabClass(selected, tab.exitCode === undefined)}
    >
      <span aria-hidden="true" className="muse-panel-tab-glyph">
        ›
      </span>
      <span dir="ltr">{tab.title}</span>
      <button
        type="button"
        className="muse-panel-tab-close"
        aria-label={`${UI_TEXT.desktop.workbenchCloseTerminal}: ${tab.title}`}
        onClick={(event) => {
          event.stopPropagation()
          onClose(tab.id)
        }}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  )
}

function ToolbarButton(properties: {
  readonly label: string
  readonly glyph: string
  readonly pressed?: boolean
  readonly onPress: () => void
}): ReactNode {
  return (
    <button
      type="button"
      className="muse-panel-tool"
      title={properties.label}
      aria-label={properties.label}
      aria-pressed={properties.pressed}
      onClick={properties.onPress}
    >
      <span aria-hidden="true">{properties.glyph}</span>
    </button>
  )
}

function PanelToolbar(properties: {
  readonly variant: 'dock' | 'floating' | 'detached'
  readonly pinned: boolean
  readonly onTop: boolean
  readonly displayedId: string | undefined
  readonly slot: 'dock' | 'window'
  readonly actions: BottomPanelActions
}): ReactNode {
  const { variant, pinned, onTop, displayedId, slot, actions } = properties
  return (
    <div className="muse-panel-toolbar" role="toolbar" aria-label={UI_TEXT.desktop.panelRegion}>
      <ToolbarButton
        label={UI_TEXT.desktop.workbenchNewTerminal}
        glyph="+"
        onPress={() => {
          actions.newTerminal(slot)
        }}
      />
      <ToolbarButton
        label={UI_TEXT.desktop.panelSplitTerminal}
        glyph="◫"
        onPress={() => {
          if (displayedId === undefined) actions.newTerminal(slot)
          else actions.splitPane(displayedId)
        }}
      />
      <button
        type="button"
        className="muse-panel-tool-text"
        disabled={displayedId === undefined}
        onClick={() => {
          actions.openSearch(displayedId)
        }}
      >
        {UI_TEXT.desktop.panelFind}
      </button>
      {variant === 'detached' ? null : (
        <ToolbarButton
          label={UI_TEXT.desktop.panelPin}
          glyph="⌖"
          pressed={pinned}
          onPress={actions.togglePin}
        />
      )}
      {variant === 'floating' ? (
        <ToolbarButton
          label={UI_TEXT.desktop.panelOnTop}
          glyph="⇑"
          pressed={onTop}
          onPress={actions.toggleOnTop}
        />
      ) : null}
      {variant === 'dock' ? (
        <ToolbarButton
          label={UI_TEXT.desktop.workbenchDetachTerminal}
          glyph="⧉"
          onPress={() => {
            actions.movePanel('detach')
          }}
        />
      ) : null}
      {variant === 'floating' ? (
        <ToolbarButton
          label={UI_TEXT.desktop.workbenchDockTerminal}
          glyph="⧉"
          onPress={() => {
            actions.movePanel('dock')
          }}
        />
      ) : null}
      {variant === 'detached' ? null : (
        <ToolbarButton
          label={UI_TEXT.desktop.workbenchCollapseTerminal}
          glyph="⌄"
          onPress={() => {
            actions.movePanel('collapse')
          }}
        />
      )}
      {variant === 'detached' ? null : (
        <ToolbarButton
          label={UI_TEXT.desktop.panelHide}
          glyph="×"
          onPress={() => {
            actions.movePanel('hide')
          }}
        />
      )}
    </div>
  )
}

// The slots from top to bottom: Ctrl+Up/Down on a tab moves it one step.
const SLOT_ORDER: readonly TerminalSlot[] = ['window', 'dock', 'footer']

function chromeVariant(
  location: 'dock' | 'window',
  placement: TerminalPlacement,
): 'dock' | 'floating' | 'detached' {
  if (location === 'dock') return 'dock'
  return placement === 'floating' ? 'floating' : 'detached'
}

function chromeTabs(
  tabs: readonly BottomPanelTab[],
  variant: 'dock' | 'floating' | 'detached',
): readonly BottomPanelTab[] {
  if (variant === 'detached') return tabsInSlot(tabs, 'window')
  return variant === 'floating'
    ? [...tabsInSlot(tabs, 'dock'), ...tabsInSlot(tabs, 'window')]
    : tabsInSlot(tabs, 'dock')
}

export function BottomPanel(properties: BottomPanelProperties): ReactNode {
  const {
    location,
    state,
    actions,
    problemsListRef,
    outputWrapRef,
    registerPane,
    isWorkbenchChord,
  } = properties
  const variant = chromeVariant(location, state.placement)
  const locationTabs = chromeTabs(state.tabs, variant)
  const displayedId = locationTabs.some((tab) => tab.id === state.activeTerminalId)
    ? state.activeTerminalId
    : locationTabs[0]?.id
  const counts = problemsCounts(state.problems)
  const problemTotal = counts.errors + counts.warnings
  const [dropActive, setDropActive] = useState(false)
  const dragDepth = useRef(0)
  const windowRef = useRef<HTMLDivElement>(null)
  const floatDrag = useRef<{
    startX: number
    startY: number
    origin: FloatingBounds
    latest: FloatingBounds
  } | null>(null)
  const resizeDrag = useRef<{
    startX: number
    startY: number
    origin: FloatingBounds
    latest: FloatingBounds
  } | null>(null)

  const zoneSlot: TerminalSlot = location === 'dock' ? 'dock' : 'window'

  const onDragEnter = (event: DragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes(TERMINAL_TAB_MIME)) return
    event.preventDefault()
    dragDepth.current += 1
    setDropActive(true)
  }

  const onDragLeave = (): void => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDropActive(false)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    dragDepth.current = 0
    setDropActive(false)
    const id = event.dataTransfer.getData(TERMINAL_TAB_MIME)
    if (id === '') return
    event.preventDefault()
    actions.moveTab(id, zoneSlot)
  }

  const onPanelBlur = (event: FocusEvent<HTMLDivElement>): void => {
    // Unpinned, the panel collapses into the footer when focus leaves
    // it; the exit dialog holds focus while it asks, so no collapse.
    if (state.panelPinned || state.dialogOpen) return
    const { currentTarget, relatedTarget } = event
    if (relatedTarget instanceof Node && currentTarget.contains(relatedTarget)) return
    actions.movePanel('collapse')
  }

  const onMoveSlot = (id: string, direction: 'up' | 'down'): void => {
    const tab = state.tabs.find((entry) => entry.id === id)
    if (tab === undefined) return
    const at = SLOT_ORDER.indexOf(tab.slot)
    const next = SLOT_ORDER[at + (direction === 'up' ? -1 : 1)]
    if (next !== undefined) actions.moveTab(id, next)
  }

  const onSash = (
    path: readonly number[],
    sizes: readonly number[],
    shouldPersist: boolean,
  ): void => {
    if (state.splits === null) return
    actions.splitsChanged(resizeSplitSizes(state.splits, path, sizes), shouldPersist)
  }

  // The floating window's bounds: persisted, else measured from the CSS
  // default position, always schema-valid for the layout store.
  const windowBounds = (): FloatingBounds | null => {
    if (state.floatingBounds !== undefined) return state.floatingBounds
    const rect = windowRef.current?.getBoundingClientRect()
    return rect === undefined ? null : floatingBoundsFromRect(rect)
  }

  const onHeaderPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (location !== 'window' || event.button !== 0) return
    const isOnChrome = event.nativeEvent
      .composedPath()
      .some(
        (node) =>
          node instanceof HTMLElement && node.matches('button, input, [role="tab"], select'),
      )
    if (isOnChrome) return
    const bounds = windowBounds()
    if (bounds === null) return
    floatDrag.current = {
      startX: event.clientX,
      startY: event.clientY,
      origin: bounds,
      latest: bounds,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onHeaderPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = floatDrag.current
    if (drag === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const latest: FloatingBounds = {
      ...drag.origin,
      x: Math.round(
        Math.min(
          Math.max(0, drag.origin.x + event.clientX - drag.startX),
          Math.max(0, window.innerWidth - DESKTOP_FLOATING_MIN_WIDTH_PX),
        ),
      ),
      y: Math.round(
        Math.min(
          Math.max(0, drag.origin.y + event.clientY - drag.startY),
          Math.max(0, window.innerHeight - DESKTOP_FLOATING_MIN_HEIGHT_PX),
        ),
      ),
    }
    drag.latest = latest
    actions.floatingBoundsChanged(latest, false)
  }

  const onHeaderPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = floatDrag.current
    if (drag === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    floatDrag.current = null
    actions.floatingBoundsChanged(drag.latest, true)
  }

  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (location !== 'window' || event.button !== 0) return
    const bounds = windowBounds()
    if (bounds === null) return
    resizeDrag.current = {
      startX: event.clientX,
      startY: event.clientY,
      origin: bounds,
      latest: bounds,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = resizeDrag.current
    if (drag === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const latest: FloatingBounds = {
      ...drag.origin,
      widthPx: Math.round(
        Math.max(
          DESKTOP_FLOATING_MIN_WIDTH_PX,
          Math.min(
            drag.origin.widthPx + event.clientX - drag.startX,
            window.innerWidth - drag.origin.x,
          ),
        ),
      ),
      heightPx: Math.round(
        Math.max(
          DESKTOP_FLOATING_MIN_HEIGHT_PX,
          Math.min(
            drag.origin.heightPx + event.clientY - drag.startY,
            window.innerHeight - drag.origin.y,
          ),
        ),
      ),
    }
    drag.latest = latest
    actions.floatingBoundsChanged(latest, false)
  }

  const onResizePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = resizeDrag.current
    if (drag === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    resizeDrag.current = null
    actions.floatingBoundsChanged(drag.latest, true)
  }

  const onResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const action = webviewKey('desktop.panelResize', event)
    if (action === undefined) return
    const origin = windowBounds()
    if (origin === null) return
    const step = DESKTOP_PANEL_KEYBOARD_RESIZE_PX
    let bounds: FloatingBounds | undefined
    switch (action) {
      case 'increase': {
        bounds = { ...origin, heightPx: origin.heightPx + step }

        break
      }
      case 'decrease': {
        bounds = {
          ...origin,
          heightPx: Math.max(DESKTOP_FLOATING_MIN_HEIGHT_PX, origin.heightPx - step),
        }

        break
      }
      case 'wider': {
        bounds = { ...origin, widthPx: origin.widthPx + step }

        break
      }
      case 'narrower': {
        bounds = {
          ...origin,
          widthPx: Math.max(DESKTOP_FLOATING_MIN_WIDTH_PX, origin.widthPx - step),
        }

        break
      }
      case 'first': {
        bounds = {
          ...origin,
          widthPx: DESKTOP_FLOATING_MIN_WIDTH_PX,
          heightPx: DESKTOP_FLOATING_MIN_HEIGHT_PX,
        }

        break
      }
      default: {
        bounds = {
          ...origin,
          widthPx: Math.max(DESKTOP_FLOATING_MIN_WIDTH_PX, window.innerWidth - origin.x),
          heightPx: Math.max(DESKTOP_FLOATING_MIN_HEIGHT_PX, window.innerHeight - origin.y),
        }
      }
    }
    event.preventDefault()
    event.stopPropagation()
    actions.floatingBoundsChanged(bounds, true)
  }

  const isShowViews = variant !== 'detached'
  const header = (
    <div
      className="muse-panel-head"
      onPointerDown={location === 'window' ? onHeaderPointerDown : undefined}
      onPointerMove={location === 'window' ? onHeaderPointerMove : undefined}
      onPointerUp={location === 'window' ? onHeaderPointerUp : undefined}
      onPointerCancel={location === 'window' ? onHeaderPointerUp : undefined}
    >
      {isShowViews ? (
        <TabStrip
          label={UI_TEXT.desktop.panelViews}
          ids={FOOTER_TABS}
          onSelect={(id) => {
            const view = FOOTER_TABS.find((entry) => entry === id)
            if (view !== undefined) actions.selectView(view)
          }}
        >
          {FOOTER_TABS.map((view) => (
            <button
              key={view}
              type="button"
              role="tab"
              data-tab-id={view}
              aria-selected={state.panelView === view}
              tabIndex={state.panelView === view ? 0 : -1}
              className={
                state.panelView === view
                  ? 'muse-panel-view muse-panel-view-active'
                  : 'muse-panel-view'
              }
              onClick={() => {
                actions.selectView(view)
              }}
            >
              {viewLabel(view)}
              {view === 'problems' && problemTotal > 0 ? (
                <span className="muse-panel-badge">{formatNumber(problemTotal)}</span>
              ) : null}
            </button>
          ))}
        </TabStrip>
      ) : null}
      <span className="muse-panel-head-spacer" />
      <TabStrip
        label={UI_TEXT.desktop.panelTerminals}
        ids={locationTabs.map((tab) => tab.id)}
        onSelect={actions.selectTab}
        onMoveSlot={onMoveSlot}
      >
        {locationTabs.map((tab) => (
          <TerminalTabButton
            key={tab.id}
            tab={tab}
            selected={tab.id === state.activeTerminalId}
            onActivate={actions.activateTab}
            onClose={actions.requestClose}
          />
        ))}
      </TabStrip>
      <PanelToolbar
        variant={variant}
        pinned={state.panelPinned}
        onTop={state.floatingOnTop}
        displayedId={displayedId}
        slot={location}
        actions={actions}
      />
    </div>
  )

  const notice =
    state.terminalCreateError === null ? null : (
      <div role="alert" className="muse-panel-notice">
        <span>{state.terminalCreateError}</span>
        <button type="button" onClick={actions.dismissCreateError}>
          {UI_TEXT.bannerDismiss}
        </button>
      </div>
    )

  let body: ReactNode
  if (isShowViews && state.panelView === 'problems') {
    body = (
      <ProblemsView
        problems={state.problems}
        listRef={problemsListRef}
        onOpenFile={actions.openFile}
      />
    )
  } else if (isShowViews && state.panelView === 'output') {
    body = (
      <div
        ref={outputWrapRef}
        tabIndex={-1}
        role="region"
        aria-label={UI_TEXT.desktop.workbenchOutput}
        className="muse-panel-output-wrap"
      >
        <OutputView snapshot={state.output} onClear={actions.clearOutput} />
      </div>
    )
  } else {
    body = (
      <TerminalArea
        locationTabs={locationTabs}
        displayedId={displayedId}
        splits={variant === 'detached' ? null : state.splits}
        registerPane={registerPane}
        isWorkbenchChord={isWorkbenchChord}
        onFocusPane={actions.selectTab}
        onSash={onSash}
        onNewTerminal={() => {
          actions.newTerminal(location)
        }}
      />
    )
  }

  if (location === 'window') {
    const { floatingBounds } = state
    const windowClasses = ['muse-panel-floating']
    if (state.floatingOnTop) windowClasses.push('muse-panel-floating-ontop')
    if (dropActive) windowClasses.push('muse-panel-drop')
    return (
      <div
        ref={windowRef}
        role="dialog"
        aria-label={UI_TEXT.desktop.panelFloating}
        data-focus-region="terminal"
        className={windowClasses.join(' ')}
        style={
          floatingBounds === undefined
            ? { height: `${String(state.terminalHeightPx)}px` }
            : {
                left: `${String(floatingBounds.x)}px`,
                top: `${String(floatingBounds.y)}px`,
                width: `${String(floatingBounds.widthPx)}px`,
                height: `${String(floatingBounds.heightPx)}px`,
              }
        }
        onBlur={variant === 'detached' ? undefined : onPanelBlur}
        onDragEnter={onDragEnter}
        onDragOver={acceptTabDrag}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {header}
        {notice}
        <div className="muse-panel-body">{body}</div>
        <div
          role="separator"
          aria-label={UI_TEXT.desktop.panelResizeHandle}
          tabIndex={0}
          className="muse-panel-float-resize"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
          onKeyDown={onResizeKeyDown}
        />
      </div>
    )
  }

  return (
    <div
      className={dropActive ? 'muse-panel muse-panel-drop' : 'muse-panel'}
      onBlur={onPanelBlur}
      onDragEnter={onDragEnter}
      onDragOver={acceptTabDrag}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {header}
      {notice}
      <div className="muse-panel-body">{body}</div>
    </div>
  )
}

function FooterViewButton(properties: {
  readonly view: PanelView
  readonly selected: boolean
  readonly detail: ReactNode
  readonly dot: 'info' | 'success' | null
  readonly onExpand: (view: PanelView) => void
}): ReactNode {
  const { view, selected, detail, dot, onExpand } = properties
  return (
    <button
      type="button"
      role="tab"
      data-tab-id={view}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      className={selected ? 'muse-panel-foot-tab muse-panel-tab-active' : 'muse-panel-foot-tab'}
      onClick={() => {
        onExpand(view)
      }}
    >
      <span aria-hidden="true" className="muse-panel-tab-glyph">
        ⌃
      </span>
      {viewLabel(view)}
      {detail}
      {dot === null ? null : (
        <span aria-hidden="true" className={`muse-panel-dot muse-panel-dot-${dot}`} />
      )}
    </button>
  )
}

// The footer strip: while the panel is collapsed into the footer it
// shows the three views (expanding on activation, as the mockup draws
// them); otherwise it shows the footer-slot tabs, which return to the
// dock on activation. Both are a drop zone for the footer slot.
export function FooterPanelStrip(properties: {
  readonly state: BottomPanelState
  readonly actions: BottomPanelActions
}): ReactNode {
  const { state, actions } = properties
  const [dropActive, setDropActive] = useState(false)
  const dragDepth = useRef(0)

  const onDragEnter = (event: DragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes(TERMINAL_TAB_MIME)) return
    event.preventDefault()
    dragDepth.current += 1
    setDropActive(true)
  }

  const onDragLeave = (): void => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDropActive(false)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    dragDepth.current = 0
    setDropActive(false)
    const id = event.dataTransfer.getData(TERMINAL_TAB_MIME)
    if (id === '') return
    event.preventDefault()
    actions.moveTab(id, 'footer')
  }

  if (state.placement === 'footer') {
    const counts = problemsCounts(state.problems)
    const problemTotal = counts.errors + counts.warnings
    const active = state.tabs.find((tab) => tab.id === state.activeTerminalId) ?? state.tabs[0]
    const outputChannels = state.output.channels
    return (
      <div
        className={dropActive ? 'muse-panel-foot muse-panel-drop' : 'muse-panel-foot'}
        onDragEnter={onDragEnter}
        onDragOver={acceptTabDrag}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <TabStrip
          label={UI_TEXT.desktop.panelViews}
          ids={FOOTER_TABS}
          onSelect={(id) => {
            const view = FOOTER_TABS.find((entry) => entry === id)
            if (view !== undefined) actions.expandView(view)
          }}
        >
          <FooterViewButton
            view="terminal"
            selected={state.panelView === 'terminal'}
            detail={
              active === undefined ? null : (
                <>
                  {' · '}
                  <span dir="ltr">
                    {active.source === 'agent' ? agentTabText(active) : active.title}
                  </span>
                  {state.tabs.length > 1 ? ` (${formatNumber(state.tabs.length)})` : null}
                </>
              )
            }
            dot={state.tabs.some((tab) => tab.exitCode === undefined) ? 'info' : null}
            onExpand={actions.expandView}
          />
          <FooterViewButton
            view="problems"
            selected={state.panelView === 'problems'}
            detail={problemTotal > 0 ? ` ${formatNumber(problemTotal)}` : null}
            dot={null}
            onExpand={actions.expandView}
          />
          <FooterViewButton
            view="output"
            selected={state.panelView === 'output'}
            detail={
              outputChannels.length === 0 ? null : (
                <>
                  {' · '}
                  <span dir="ltr">{outputChannels[0]?.channel ?? ''}</span>
                  {outputChannels.length > 1
                    ? ` (+${formatNumber(outputChannels.length - 1)})`
                    : null}
                </>
              )
            }
            dot={outputChannels.some((channel) => channel.text !== '') ? 'success' : null}
            onExpand={actions.expandView}
          />
        </TabStrip>
      </div>
    )
  }

  const onMoveSlot = (id: string, direction: 'up' | 'down'): void => {
    const tab = state.tabs.find((entry) => entry.id === id)
    if (tab === undefined) return
    const at = SLOT_ORDER.indexOf(tab.slot)
    const next = SLOT_ORDER[at + (direction === 'up' ? -1 : 1)]
    if (next !== undefined) actions.moveTab(id, next)
  }

  const footerTabs = tabsInSlot(state.tabs, 'footer')
  if (footerTabs.length === 0) return null
  return (
    <div
      className={dropActive ? 'muse-panel-foot muse-panel-drop' : 'muse-panel-foot'}
      onDragEnter={onDragEnter}
      onDragOver={acceptTabDrag}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <TabStrip
        label={UI_TEXT.desktop.panelCollapsedPanels}
        ids={footerTabs.map((tab) => tab.id)}
        onSelect={actions.selectTab}
        onMoveSlot={onMoveSlot}
      >
        {footerTabs.map((tab) => (
          <TerminalTabButton
            key={tab.id}
            tab={tab}
            selected={tab.id === state.activeTerminalId}
            onActivate={actions.returnTab}
            onClose={actions.requestClose}
          />
        ))}
      </TabStrip>
    </div>
  )
}

export interface PendingTabClose {
  readonly id: string
  readonly title: string
}

// The exit question, rendered at the workbench root (outside the regions
// DesktopApp marks inert while it asks): focus starts on the safe side,
// Escape cancels, and Tab cycles the two buttons without escaping.
export function ExitConfirmDialog(properties: {
  readonly pending: PendingTabClose | null
  readonly onConfirm: () => void
  readonly onCancel: () => void
}): ReactNode {
  const { pending, onConfirm, onCancel } = properties
  if (pending === null) return null

  const onDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const action = webviewKey('modal.focus', event)
    if (action === undefined) return
    if (action === 'close') {
      event.preventDefault()
      onCancel()
      return
    }
    const buttons = [...event.currentTarget.querySelectorAll('button')]
    const at = buttons.findIndex((button) => button.isSameNode(document.activeElement))
    if (action === 'focusNext' && (at === -1 || at === buttons.length - 1)) {
      event.preventDefault()
      buttons[0]?.focus()
    } else if (action === 'focusPrevious' && (at === -1 || at === 0)) {
      event.preventDefault()
      buttons.at(-1)?.focus()
    }
  }

  return (
    <div className="muse-panel-dialog-wrap">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="muse-panel-close-title"
        aria-describedby="muse-panel-close-body"
        className="muse-panel-dialog"
        onKeyDown={onDialogKeyDown}
      >
        <h2 id="muse-panel-close-title">
          {UI_TEXT.desktop.workbenchCloseTerminal}: <span dir="ltr">{pending.title}</span>
        </h2>
        <p id="muse-panel-close-body">{UI_TEXT.desktop.panelCloseRunning}</p>
        <div className="muse-panel-dialog-buttons">
          <button type="button" autoFocus onClick={onCancel}>
            {UI_TEXT.desktop.panelCancel}
          </button>
          <button type="button" onClick={onConfirm}>
            {UI_TEXT.desktop.panelCloseConfirm}
          </button>
        </div>
      </div>
    </div>
  )
}
