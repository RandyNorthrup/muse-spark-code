import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKBENCH_LAYOUT,
  desktopStatusItemSchema,
  statusPublishRequestSchema,
  workbenchLayoutSchema,
} from '../../../src/shared/desktop/bridge'
import {
  KeybindingRegistry,
  chordFromEvent,
  normaliseChord,
} from '../../../src/shared/desktop/keybindings'
import {
  isDesktopPermissionGranted,
  isExternalUrlAllowed,
  freshLayout,
  isStoredLayout,
  layoutStorageKey,
  moveTerminal,
  nextTerminalAfterClose,
  orderStatusItems,
  parseStoredLayout,
  quickOpenScore,
  rankQuickOpen,
  workspaceKey,
} from '../../../src/shared/desktop/workbench'

describe('M111 lane WB workbench logic', () => {
  it('one window per workspace: roots normalise across separators and case', () => {
    expect(workspaceKey('C:\\Users\\Dev\\App\\', 'win32')).toBe('c:/users/dev/app')
    expect(workspaceKey('c:/users/dev/app', 'win32')).toBe('c:/users/dev/app')
    expect(workspaceKey('/home/dev/App/', 'linux')).toBe('/home/dev/App')
    expect(workspaceKey('/', 'linux')).toBe('/')
    expect(layoutStorageKey({ workspaceRoot: '/p/App' }, 'linux')).toBe('/p/App')
    expect(layoutStorageKey({ workspaceRoot: '/p/App', compositorWorkspace: '2' }, 'linux')).toBe(
      '/p/App::2',
    )
  })

  it('stored layouts round-trip and corrupt records are refused by name', () => {
    expect(parseStoredLayout(DEFAULT_WORKBENCH_LAYOUT)).toEqual(DEFAULT_WORKBENCH_LAYOUT)
    expect(isStoredLayout(DEFAULT_WORKBENCH_LAYOUT)).toBe(true)
    expect(isStoredLayout({ ...DEFAULT_WORKBENCH_LAYOUT, version: 2 })).toBe(false)
    expect(isStoredLayout(null)).toBe(false)
    expect(() => workbenchLayoutSchema.parse({ ...DEFAULT_WORKBENCH_LAYOUT, extra: 1 })).toThrow()
    expect(freshLayout().openFiles).toEqual([])
  })

  it('terminal placement moves follow D91.13 (detached floats)', () => {
    expect(moveTerminal(freshLayout(), 'detach').terminalPlacement).toBe('floating')
    const collapsed = moveTerminal(freshLayout(), 'collapse')
    expect(collapsed.terminalPlacement).toBe('footer')
    expect(collapsed.activeFooterTab).toBe('terminal')
    const hidden = moveTerminal(freshLayout(), 'hide')
    expect(hidden.terminalPlacement).toBe('hidden')
    expect(moveTerminal(hidden, 'show').terminalPlacement).toBe('docked')
    expect(moveTerminal(freshLayout(), 'show').terminalPlacement).toBe('docked')
  })

  it('closing the active terminal selects its neighbour', () => {
    const tabs = [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C' },
    ]
    expect(nextTerminalAfterClose(tabs, 'b', 'b').activeId).toBe('c')
    expect(nextTerminalAfterClose(tabs, 'c', 'c').activeId).toBe('b')
    expect(nextTerminalAfterClose(tabs, 'a', 'c').activeId).toBe('c')
    expect(nextTerminalAfterClose([tabs[0]!], 'a', 'a').activeId).toBeUndefined()
  })

  it('status items are uniquely ordered for SH1\u{2019}s bar and strictly shaped', () => {
    const items = orderStatusItems([
      { id: 'b', side: 'right', text: 'B', priority: 10 },
      { id: 'a', side: 'left', text: 'A', priority: 20 },
      { id: 'c', side: 'left', text: 'C', priority: 5 },
    ])
    expect(items.map((item) => item.id)).toEqual(['c', 'a', 'b'])
    expect(() =>
      desktopStatusItemSchema.parse({ id: 'x', side: 'mid', text: 'X', priority: 1 }),
    ).toThrow()
    expect(statusPublishRequestSchema.parse({ workspaceRoot: '/p', items }).workspaceRoot).toBe(
      '/p',
    )
  })

  it('quick open ranks names before paths and refuses non-matches', () => {
    expect(quickOpenScore('main.ts', 'src/main.ts')).toBe(1000)
    expect(quickOpenScore('mai', 'src/main.ts')).toBeGreaterThan(
      quickOpenScore('mai', 'src/domain.ts'),
    )
    expect(quickOpenScore('zzz', 'src/main.ts')).toBe(-1)
    const ranked = rankQuickOpen('app', [
      { path: 'src/the-app-store.ts' },
      { path: 'src/App.tsx' },
      { path: 'README.md' },
    ])
    expect(ranked.map((entry) => entry.path)).toEqual(['src/App.tsx', 'src/the-app-store.ts'])
  })

  it('the permission policy grants only sanitised clipboard writes', () => {
    expect(isDesktopPermissionGranted('clipboard-sanitized-write')).toBe(true)
    for (const denied of ['media', 'geolocation', 'notifications', 'midi', 'usb', 'serial']) {
      expect(isDesktopPermissionGranted(denied)).toBe(false)
    }
  })

  it('only http, https and mailto may leave the app', () => {
    expect(isExternalUrlAllowed('https://example.test/')).toBe(true)
    expect(isExternalUrlAllowed('mailto:a@example.test')).toBe(true)
    expect(isExternalUrlAllowed('file:///etc/passwd')).toBe(false)
    expect(isExternalUrlAllowed('javascript:alert(1)')).toBe(false)
    expect(isExternalUrlAllowed('not a url')).toBe(false)
  })

  it('the keybinding registry resolves chords, labels and conflicts', () => {
    const registry = new KeybindingRegistry()
    expect(registry.commandForChord('Ctrl+P')?.command).toBe('workbench.quickOpen')
    expect(registry.chordForCommand('workbench.toggleTerminal')).toBe('ctrl+`')
    expect(registry.labelForCommand('workbench.quickOpen')).toBe('Ctrl+P')
    expect(normaliseChord('Shift+Ctrl+P')).toBe('ctrl+shift+p')
    expect(
      chordFromEvent({ ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, key: 'p' }),
    ).toBe('ctrl+p')
    expect(
      chordFromEvent({ ctrlKey: true, altKey: false, shiftKey: true, metaKey: false, key: '`' }),
    ).toBe('ctrl+shift+`')
    expect(() => {
      registry.register({ command: 'workbench.saveFile', chord: 'ctrl+p' })
    }).toThrow(/already bound/)
  })
})
