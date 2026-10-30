import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import * as z from 'zod/mini'
import { UI_TEXT } from '../../shared/constants'
import {
  PREVIEW_DEVICES,
  previewViewportSchema,
  type PreviewViewport,
} from '../../shared/desktopContracts'
import { fill } from '../../shared/l10n/text'
import { useDismiss } from '../useDismiss'
import type { MountedEditor } from './codemirror.mjs'
import { Editor } from './Editor'
import {
  activatePane,
  activateTab,
  activeTabOf,
  breadcrumbsFor,
  closeOtherTabs,
  closeTab,
  closeUnpinnedTabs,
  cycleTab,
  moveTab,
  promoteTab,
  setMinimap,
  setTabPinned,
  splitTab,
  tabFilePath,
  type EditorGroupState,
  type EditorPane,
  type EditorTab,
} from './groupState'
import { EDITOR_LANGUAGES, languageIdForPath, languageName } from './languages'

export interface EditorBuffer {
  /** The current draft text. */
  readonly text: string
  /** The text as last saved; a tab is dirty while the two differ. */
  readonly savedText: string
  /** Bumped by the host whenever the buffer is replaced from outside
  (loaded, discarded, uploaded over) so the pane remounts. */
  readonly revision: number
}

export interface EditorGroupProps {
  readonly state: EditorGroupState
  readonly onStateChange: (next: EditorGroupState) => void
  readonly buffers: Readonly<Record<string, EditorBuffer>>
  readonly onBufferChange: (path: string, text: string) => void
  /** The host's dirty guard: false keeps the tab (the host says why). */
  readonly canClose: (tab: EditorTab) => boolean
  readonly onCloseRefused: (tab: EditorTab) => void
  readonly onBreadcrumb: (path: string) => void
  /** The preview slot's content: the desktop renders a browser view
  here (D91.23); the group owns the tab, the frame and the size. A
  surface with no browser views (the node's web UI) omits both props
  and never opens preview tabs. The entry that mounts the group also
  imports `./editor.css` (the node files page today, the desktop's
  workbench entry with lane WB), the way each surface owns its sheet. */
  readonly renderPreview?: (tab: EditorTab, viewport: PreviewViewport) => ReactNode
  readonly onPreviewViewport?: (tab: EditorTab, viewport: PreviewViewport) => void
}

interface Cursor {
  readonly line: number
  readonly column: number
}

function Icon({ path }: { readonly path: string }) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  )
}

const ICONS = {
  close: 'M6 6l12 12M18 6L6 18',
  pin: 'M9 4h6M10 4v6l-3 4h10l-3-4V4M12 14v7',
  splitRight: 'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM13 4v16',
  splitDown: 'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 13h16',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM20 20l-3.8-3.8',
} as const

function tabLabel(tab: EditorTab, hasUnsavedChanges: boolean): string {
  const text = UI_TEXT.editorGroup
  if (hasUnsavedChanges && tab.pinned) return fill(text.tabPinnedUnsaved, { title: tab.title })
  if (tab.pinned) return fill(text.tabPinned, { title: tab.title })
  if (hasUnsavedChanges) return fill(text.tabUnsaved, { title: tab.title })
  return tab.ephemeral ? fill(text.tabPreview, { title: tab.title }) : tab.title
}

const DEVICE_LABELS = (deviceId: PreviewViewport['deviceId']): string => {
  const text = UI_TEXT.editorGroup
  return {
    phone: text.devicePhone,
    tablet: text.deviceTablet,
    laptop: text.deviceLaptop,
    desktop: text.deviceDesktop,
  }[deviceId]
}

export function EditorGroup(props: EditorGroupProps) {
  const { state, onStateChange } = props
  const [cursors, setCursors] = useState<Readonly<Record<string, Cursor>>>({})
  const [languageOverrides, setLanguageOverrides] = useState<
    Readonly<Record<string, string | null>>
  >({})
  const [failedLanguages, setFailedLanguages] = useState<Readonly<Record<string, string>>>({})
  const [viewports, setViewports] = useState<Readonly<Record<string, PreviewViewport>>>({})
  const [menuPaneId, setMenuPaneId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const handles = useRef(new Map<string, MountedEditor | null>())
  const tabElements = useRef(new Map<string, HTMLElement>())
  const setHandle = useCallback((id: string, handle: MountedEditor | null) => {
    handles.current.set(id, handle)
  }, [])
  const onMenuBlur = useDismiss(menuRef, menuPaneId !== null, () => {
    setMenuPaneId(null)
  })

  const change = useCallback(
    (next: EditorGroupState) => {
      if (next !== state) onStateChange(next)
    },
    [state, onStateChange],
  )

  const bufferFor = (tab: EditorTab): EditorBuffer | undefined => {
    const path = tabFilePath(tab)
    return path === undefined ? undefined : props.buffers[path]
  }

  const isDirty = (tab: EditorTab): boolean => {
    const buffer = bufferFor(tab)
    return buffer !== undefined && buffer.text !== buffer.savedText
  }

  const requestClose = (tab: EditorTab): void => {
    if (!props.canClose(tab)) {
      props.onCloseRefused(tab)
      return
    }
    change(closeTab(state, tab.id))
  }

  const closeMany = (keep: EditorTab, bulk: (from: EditorGroupState) => EditorGroupState): void => {
    const pane = state.panes.find((candidate) => candidate.tabs.some((tab) => tab.id === keep.id))
    if (pane === undefined) return
    const targets = pane.tabs.filter((tab) => tab.id !== keep.id && !tab.pinned)
    const refused = targets.filter((tab) => !props.canClose(tab))
    if (refused.length === 0) {
      change(bulk(state))
      return
    }
    let next = state
    for (const tab of targets) {
      if (props.canClose(tab)) next = closeTab(next, tab.id)
    }
    change(next)
    const first = refused[0]
    if (first !== undefined) props.onCloseRefused(first)
  }

  const languageFor = (path: string): string | null => {
    const override = languageOverrides[path]
    return override === undefined ? languageIdForPath(path) : override
  }

  const viewportFor = (tab: EditorTab): PreviewViewport => {
    const stored = viewports[tab.id]
    if (stored !== undefined) return stored
    const device = PREVIEW_DEVICES[3]
    return { deviceId: device.id, widthPx: device.widthPx, heightPx: device.heightPx }
  }

  const focusTab = (paneId: string, tabId: string): void => {
    tabElements.current.get(`${paneId}:${tabId}`)?.focus()
  }

  const onTabListKeyDown = (event: ReactKeyboardEvent, pane: EditorPane): void => {
    const active = activeTabOf(pane)
    if (active === undefined) return
    const index = pane.tabs.findIndex((tab) => tab.id === active.id)
    let nextIndex: number | undefined
    switch (event.key) {
      case 'ArrowRight': {
        nextIndex = (index + 1) % pane.tabs.length
        break
      }
      case 'ArrowLeft': {
        nextIndex = (index - 1 + pane.tabs.length) % pane.tabs.length
        break
      }
      case 'Home': {
        nextIndex = 0
        break
      }
      case 'End': {
        nextIndex = pane.tabs.length - 1
        break
      }
      default: {
        break
      }
    }
    if (nextIndex === undefined) return
    const next = pane.tabs[nextIndex]
    if (next === undefined) return
    event.preventDefault()
    change(activateTab(state, pane.id, next.id))
    focusTab(pane.id, next.id)
  }

  const onGroupKeyDown = (event: ReactKeyboardEvent): void => {
    if (!event.ctrlKey || event.altKey || event.metaKey) return
    if (event.key === 'PageDown') {
      event.preventDefault()
      change(cycleTab(state, 1))
    } else if (event.key === 'PageUp') {
      event.preventDefault()
      change(cycleTab(state, -1))
    } else if (/^[1-9]$/u.test(event.key) && state.panes.length > 1) {
      const pane = state.panes[Number(event.key) - 1]
      if (pane === undefined) return
      event.preventDefault()
      change(activatePane(state, pane.id))
      const active = activeTabOf(pane)
      if (active !== undefined) focusTab(pane.id, active.id)
    }
  }

  const activePane = state.panes.find((pane) => pane.id === state.activePaneId) ?? state.panes[0]
  const activeTab = activePane === undefined ? undefined : activeTabOf(activePane)
  const activePath = activeTab === undefined ? undefined : tabFilePath(activeTab)
  const activeLanguageId = activePath === undefined ? null : languageFor(activePath)
  const activeFailed = activePath === undefined ? undefined : failedLanguages[activePath]
  const text = UI_TEXT.editorGroup

  const renderTab = (pane: EditorPane, tab: EditorTab, index: number) => {
    const isSelected = pane.activeId === tab.id
    const hasUnsavedChanges = isDirty(tab)
    return (
      <div
        key={tab.id}
        role="tab"
        ref={(element) => {
          if (element === null) {
            tabElements.current.delete(`${pane.id}:${tab.id}`)
          } else {
            tabElements.current.set(`${pane.id}:${tab.id}`, element)
          }
        }}
        aria-selected={isSelected}
        aria-label={tabLabel(tab, hasUnsavedChanges)}
        title={tabFilePath(tab) ?? tab.title}
        tabIndex={isSelected ? 0 : -1}
        draggable
        className={tab.ephemeral ? 'ms-editor-tab ms-editor-tab-preview' : 'ms-editor-tab'}
        onClick={() => {
          change(activateTab(state, pane.id, tab.id))
        }}
        onDoubleClick={() => {
          change(promoteTab(state, tab.id))
        }}
        onAuxClick={(event) => {
          if (event.button === 1) requestClose(tab)
        }}
        onKeyDown={(event) => {
          if (!(event.key === 'Enter' || event.key === ' ')) {
            return
          }

          event.preventDefault()
          change(activateTab(state, pane.id, tab.id))
        }}
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', tab.id)
          event.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(event) => {
          event.preventDefault()
          const draggedId = event.dataTransfer.getData('text/plain')
          if (draggedId !== '' && draggedId !== tab.id) change(moveTab(state, draggedId, index))
        }}
      >
        <span className="ms-editor-tab-title">{tab.title}</span>
        {tab.pinned && (
          <span className="ms-editor-tab-pin" aria-hidden="true">
            <Icon path={ICONS.pin} />
          </span>
        )}
        {!tab.pinned && hasUnsavedChanges && (
          <span className="ms-editor-tab-dirty" aria-hidden="true" />
        )}
        {!tab.pinned && !hasUnsavedChanges && (
          <button
            type="button"
            className="ms-editor-tab-close"
            aria-label={fill(text.closeTab, { title: tab.title })}
            tabIndex={-1}
            onClick={(event) => {
              event.stopPropagation()
              requestClose(tab)
            }}
          >
            <Icon path={ICONS.close} />
          </button>
        )}
      </div>
    )
  }

  const renderMenu = (pane: EditorPane, tab: EditorTab) => (
    <div className="ms-editor-menu-anchor" ref={menuPaneId === pane.id ? menuRef : undefined}>
      <button
        type="button"
        className="ms-editor-tool"
        aria-label={text.moreActions}
        aria-haspopup="menu"
        aria-expanded={menuPaneId === pane.id}
        onClick={() => {
          setMenuPaneId(menuPaneId === pane.id ? null : pane.id)
        }}
        onBlur={onMenuBlur}
      >
        <Icon path={ICONS.more} />
      </button>
      {menuPaneId === pane.id && (
        <div
          role="menu"
          aria-label={text.moreActions}
          className="ms-editor-menu"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setMenuPaneId(null)
          }}
          onBlur={onMenuBlur}
        >
          {tab.ephemeral && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                change(promoteTab(state, tab.id))
                setMenuPaneId(null)
              }}
            >
              {text.keepTabOpen}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              change(setTabPinned(state, tab.id, !tab.pinned))
              setMenuPaneId(null)
            }}
          >
            {tab.pinned ? text.unpinTab : text.pinTab}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMany(tab, (from) => closeOtherTabs(from, tab.id))
              setMenuPaneId(null)
            }}
          >
            {text.closeOtherTabs}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMany(tab, (from) => closeUnpinnedTabs(from, pane.id))
              setMenuPaneId(null)
            }}
          >
            {text.closeUnpinnedTabs}
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={state.minimap}
            onClick={() => {
              change(setMinimap(state, !state.minimap))
              setMenuPaneId(null)
            }}
          >
            {text.minimap}
          </button>
        </div>
      )}
    </div>
  )

  const renderPane = (pane: EditorPane, paneIndex: number) => {
    const tab = activeTabOf(pane)
    const path = tab === undefined ? undefined : tabFilePath(tab)
    const buffer = tab === undefined ? undefined : bufferFor(tab)
    const canSplit = tab !== undefined && !(state.panes.length === 1 && pane.tabs.length === 1)
    return (
      <section
        key={pane.id}
        className="ms-editor-pane"
        data-active={pane.id === state.activePaneId}
        onFocus={() => {
          if (state.activePaneId !== pane.id) change(activatePane(state, pane.id))
        }}
      >
        <div className="ms-editor-strip">
          <div
            role="tablist"
            aria-label={
              state.panes.length > 1 ? fill(text.tabsInGroup, { group: paneIndex + 1 }) : text.tabs
            }
            className="ms-editor-tablist"
            onKeyDown={(event) => {
              onTabListKeyDown(event, pane)
            }}
          >
            {pane.tabs.map((candidate, index) => renderTab(pane, candidate, index))}
          </div>
          <div className="ms-editor-tools">
            {tab?.kind === 'file' && (
              <button
                type="button"
                className="ms-editor-tool"
                aria-label={text.findLabel}
                onClick={() => {
                  handles.current.get(pane.id)?.openSearch()
                }}
              >
                <Icon path={ICONS.search} />
              </button>
            )}
            <button
              type="button"
              className="ms-editor-tool"
              aria-label={text.splitRight}
              disabled={!canSplit}
              onClick={() => {
                if (tab !== undefined) change(splitTab(state, tab.id, 'right'))
              }}
            >
              <Icon path={ICONS.splitRight} />
            </button>
            <button
              type="button"
              className="ms-editor-tool"
              aria-label={text.splitDown}
              disabled={!canSplit}
              onClick={() => {
                if (tab !== undefined) change(splitTab(state, tab.id, 'down'))
              }}
            >
              <Icon path={ICONS.splitDown} />
            </button>
            {tab !== undefined && renderMenu(pane, tab)}
          </div>
        </div>
        {tab?.kind === 'file' && path !== undefined && (
          <nav aria-label={text.breadcrumbs} className="ms-editor-breadcrumbs">
            {breadcrumbsFor(path).map((crumb, index, crumbs) =>
              index === crumbs.length - 1 ? (
                <span key={crumb.path} aria-current="page">
                  {crumb.label}
                </span>
              ) : (
                <span key={crumb.path} className="ms-editor-crumb">
                  <button
                    type="button"
                    onClick={() => {
                      props.onBreadcrumb(crumb.path)
                    }}
                  >
                    {crumb.label}
                  </button>
                  <span aria-hidden="true">/</span>
                </span>
              ),
            )}
          </nav>
        )}
        {tab?.kind === 'preview' && (
          <div className="ms-editor-breadcrumbs">
            <label>
              {text.previewSize}
              <select
                value={viewportFor(tab).deviceId}
                onChange={(event) => {
                  const device = PREVIEW_DEVICES.find(
                    (candidate) => candidate.id === event.target.value,
                  )
                  if (device === undefined) return
                  const viewport = z.parse(previewViewportSchema, {
                    deviceId: device.id,
                    widthPx: device.widthPx,
                    heightPx: device.heightPx,
                  })
                  setViewports({ ...viewports, [tab.id]: viewport })
                  props.onPreviewViewport?.(tab, viewport)
                }}
              >
                {PREVIEW_DEVICES.map((device) => (
                  <option key={device.id} value={device.id}>
                    {DEVICE_LABELS(device.id)} · {device.widthPx}×{device.heightPx}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="ms-editor-body">
          {tab === undefined && <p className="ms-editor-empty">{text.noFileOpen}</p>}
          {tab?.kind === 'preview' && (
            <div className="ms-editor-preview">
              <div
                className="ms-editor-preview-frame"
                style={{
                  width: `${String(viewportFor(tab).widthPx)}px`,
                  height: `${String(viewportFor(tab).heightPx)}px`,
                }}
              >
                {props.renderPreview?.(tab, viewportFor(tab))}
              </div>
            </div>
          )}
          {tab?.kind === 'file' && path !== undefined && buffer === undefined && (
            <p className="ms-editor-empty" data-deferred-loading="true">
              {text.loading}
            </p>
          )}
          {tab?.kind === 'file' && path !== undefined && buffer !== undefined && (
            <Editor
              key={`${tab.id}:${String(buffer.revision)}`}
              text={buffer.text}
              label={UI_TEXT.nodeLabels.editor}
              languageId={languageFor(path)}
              minimap={state.minimap}
              handleId={pane.id}
              onHandle={setHandle}
              onChange={(nextText) => {
                if (tab.ephemeral) change(promoteTab(state, tab.id))
                props.onBufferChange(path, nextText)
              }}
              onCursor={(cursor) => {
                setCursors((previous) =>
                  previous[pane.id]?.line === cursor.line &&
                  previous[pane.id]?.column === cursor.column
                    ? previous
                    : { ...previous, [pane.id]: cursor },
                )
              }}
              onLanguageFailed={(languageId) => {
                setFailedLanguages((previous) =>
                  previous[path] === languageId ? previous : { ...previous, [path]: languageId },
                )
              }}
            />
          )}
        </div>
      </section>
    )
  }

  return (
    <div className="ms-editor-group" onKeyDown={onGroupKeyDown}>
      <div className={`ms-editor-panes ms-editor-panes-${state.split}`}>
        {state.panes.map((pane, index) => renderPane(pane, index))}
      </div>
      {activeTab?.kind === 'file' && activePath !== undefined && (
        <div className="ms-editor-status">
          <span>
            {fill(text.lineColumn, {
              line: cursors[state.activePaneId]?.line ?? 1,
              column: cursors[state.activePaneId]?.column ?? 1,
            })}
          </span>
          {activeFailed !== undefined && (
            <span role="status">
              {fill(text.languageFailed, {
                language: languageName(activeFailed) ?? activeFailed,
              })}
            </span>
          )}
          <label>
            {text.language}
            <select
              value={activeLanguageId ?? 'plain'}
              onChange={(event) => {
                const value = event.target.value
                setLanguageOverrides({
                  ...languageOverrides,
                  [activePath]: value === 'plain' ? null : value,
                })
              }}
            >
              <option value="plain">{text.plainText}</option>
              {EDITOR_LANGUAGES.map((language) => (
                <option key={language.id} value={language.id}>
                  {language.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-pressed={state.minimap}
            onClick={() => {
              change(setMinimap(state, !state.minimap))
            }}
          >
            {text.minimap}
          </button>
        </div>
      )}
    </div>
  )
}
