import { describe, expect, it } from 'vitest'
import { DIAGNOSTICS_MAX_ENTRIES } from '../../../src/shared/constants'
import {
  DEFAULT_WORKBENCH_LAYOUT,
  DEFAULT_WORKBENCH_LAYOUT_V2,
  isStoredLayoutV2,
  migrateLayoutV1ToV2,
  outputAppendedSchema,
  outputClearedSchema,
  panelProblemSchema,
  parseStoredLayoutV2,
  problemsChangedSchema,
  splitNodeSchema,
  terminalCreateRequestSchema,
  type SplitNode,
} from '../../../src/shared/desktop/bridge'
import {
  KeybindingRegistry,
  chordFromEvent,
  isBindingActive,
} from '../../../src/shared/desktop/keybindings'
import {
  applyOutputAppend,
  clipChannelTail,
  closePane,
  floatingBoundsFromRect,
  isTerminalWritable,
  moveTabToSlot,
  normalizeSplitSizes,
  paneTerminalIds,
  problemsCounts,
  pruneSplitTree,
  reconcileTerminalTabs,
  resizeFloatingHeightPx,
  resizePanelHeightPx,
  resizeSplitSizes,
  shouldConfirmTerminalClose,
  splitLeaf,
  tabsInSlot,
  type PanelTerminalTab,
} from '../../../src/shared/desktop/panel'

const personTab = (id: string): PanelTerminalTab => ({
  id,
  title: id,
  slot: 'dock',
  source: 'person',
})

const agentTab = (id: string): PanelTerminalTab => ({
  id,
  title: id,
  slot: 'dock',
  source: 'agent',
  agent: { label: 'web-eng', runId: 'run-1', command: 'vitest' },
})

describe('M111 lane BP panel model', () => {
  it('stored layouts parse, migrate from version 1, and refuse the rest by name', () => {
    expect(parseStoredLayoutV2(DEFAULT_WORKBENCH_LAYOUT_V2)).toEqual(DEFAULT_WORKBENCH_LAYOUT_V2)
    expect(isStoredLayoutV2(DEFAULT_WORKBENCH_LAYOUT_V2)).toBe(true)
    expect(isStoredLayoutV2({ ...DEFAULT_WORKBENCH_LAYOUT_V2, version: 3 })).toBe(false)
    expect(isStoredLayoutV2(null)).toBe(false)

    const migrated = migrateLayoutV1ToV2({
      ...DEFAULT_WORKBENCH_LAYOUT,
      activeFooterTab: 'problems',
    })
    expect(migrated.version).toBe(2)
    expect(migrated.panelView).toBe('problems')
    expect(migrated.panelPinned).toBe(true)
    expect(migrated.tabSlots).toEqual({})
    expect(migrated.floatingOnTop).toBe(false)
    expect(parseStoredLayoutV2(DEFAULT_WORKBENCH_LAYOUT)).toEqual(
      migrateLayoutV1ToV2(DEFAULT_WORKBENCH_LAYOUT),
    )
    // Refused by name: the callers say "unreadable" on exactly this name.
    for (const garbage of [{ version: 1 }, null, { version: 2, panelView: 'peek' }]) {
      try {
        parseStoredLayoutV2(garbage)
        expect.unreachable('a corrupt layout must be refused')
      } catch (error: unknown) {
        if (error instanceof Error) {
          expect(error.name).toBe('ZodError')
        } else {
          expect.unreachable('a refusal is an Error')
        }
      }
    }
  })

  it('split trees validate: leaves and nested splits pass, degenerate splits refuse', () => {
    expect(splitNodeSchema.parse({ kind: 'leaf', terminalId: 'a' })).toEqual({
      kind: 'leaf',
      terminalId: 'a',
    })
    const tree: SplitNode = {
      kind: 'split',
      direction: 'right',
      children: [
        { kind: 'leaf', terminalId: 'a' },
        {
          kind: 'split',
          direction: 'down',
          children: [
            { kind: 'leaf', terminalId: 'b' },
            { kind: 'leaf', terminalId: 'c' },
          ],
          sizes: [1, 2],
        },
      ],
      sizes: [0.5, 0.5],
    }
    expect(splitNodeSchema.parse(tree)).toEqual(tree)
    expect(() =>
      splitNodeSchema.parse({
        kind: 'split',
        direction: 'right',
        children: [{ kind: 'leaf', terminalId: 'a' }],
        sizes: [1],
      }),
    ).toThrow()
    expect(() =>
      splitNodeSchema.parse({
        kind: 'split',
        direction: 'right',
        children: [
          { kind: 'leaf', terminalId: 'a' },
          { kind: 'leaf', terminalId: 'b' },
        ],
        sizes: [1, 0],
      }),
    ).toThrow()
  })

  it('tabs move between the dock, the window and the footer', () => {
    const tabs = [personTab('a'), personTab('b')]
    const moved = moveTabToSlot(tabs, 'a', 'window')
    expect(tabsInSlot(moved, 'window').map((tab) => tab.id)).toEqual(['a'])
    expect(tabsInSlot(moved, 'dock').map((tab) => tab.id)).toEqual(['b'])
    expect(moveTabToSlot(moved, 'missing', 'footer')).toBe(moved)
    expect(moveTabToSlot(moved, 'a', 'window')).toBe(moved)
  })

  it('remounts drop tabs whose sessions are gone and keep the live ones', () => {
    const tabs = [personTab('a'), personTab('b'), agentTab('c')]
    expect(
      reconcileTerminalTabs(tabs, [
        { id: 'b', title: 'b' },
        { id: 'c', title: 'c' },
      ]).map((tab) => tab.id),
    ).toEqual(['b', 'c'])
  })

  it('agents tabs are read-only and close-asks only when a command runs', () => {
    expect(isTerminalWritable(personTab('a'))).toBe(true)
    expect(isTerminalWritable(agentTab('b'))).toBe(false)
    expect(shouldConfirmTerminalClose(false, true)).toBe(true)
    expect(shouldConfirmTerminalClose(false, false)).toBe(false)
    expect(shouldConfirmTerminalClose(true, true)).toBe(false)
  })

  it('split panes open, close, collapse and prune with their sizes', () => {
    const leaf: SplitNode = { kind: 'leaf', terminalId: 'a' }
    const split = splitLeaf(leaf, 'a', 'b', 'right')
    expect(split).toEqual({
      kind: 'split',
      direction: 'right',
      children: [leaf, { kind: 'leaf', terminalId: 'b' }],
      sizes: [0.5, 0.5],
    })
    expect(splitLeaf(leaf, 'missing', 'b', 'right')).toBe(leaf)
    expect(paneTerminalIds(split)).toEqual(['a', 'b'])

    const nested = splitLeaf(split, 'b', 'c', 'down')
    expect(paneTerminalIds(nested)).toEqual(['a', 'b', 'c'])
    // Closing a nested pane collapses its parent split into the sibling.
    expect(closePane(nested, 'c')).toEqual(split)
    // Closing the dock's last pane leaves no tree.
    expect(closePane(leaf, 'a')).toBeNull()
    expect(closePane(leaf, 'missing')).toBe(leaf)

    const pruned = pruneSplitTree(nested, new Set(['a', 'c']))
    expect(pruned === null ? [] : paneTerminalIds(pruned)).toEqual(['a', 'c'])
    expect(pruneSplitTree(nested, new Set())).toBeNull()

    expect(normalizeSplitSizes([1, 3], 2)).toEqual([0.25, 0.75])
    expect(normalizeSplitSizes([2], 2)).toEqual([2 / 3, 1 / 3])
    expect(normalizeSplitSizes([], 2)).toEqual([0.5, 0.5])
  })

  it('split sizes resize along a path, clamped and renormalized', () => {
    const leaf: SplitNode = { kind: 'leaf', terminalId: 'a' }
    const split = splitLeaf(leaf, 'a', 'b', 'right')
    expect(resizeSplitSizes(split, [], [0.8, 0.2])).toEqual({ ...split, sizes: [0.8, 0.2] })
    // A sliver clamps to the minimum pane fraction, then fills to one.
    const clamped = resizeSplitSizes(split, [], [0.99, 0.01])
    const [first = 0, second = 0] = clamped.kind === 'split' ? clamped.sizes : []
    expect(first).toBeGreaterThan(second)
    expect(second).toBeGreaterThanOrEqual(0.09)
    expect(first + second).toBeCloseTo(1)
    // Unknown paths, leaves and wrong counts return the same tree.
    expect(resizeSplitSizes(split, [5], [0.5, 0.5])).toBe(split)
    expect(resizeSplitSizes(split, [0, 0], [0.5, 0.5])).toBe(split)
    expect(resizeSplitSizes(leaf, [], [0.5, 0.5])).toBe(leaf)
    expect(resizeSplitSizes(split, [], [0.5])).toBe(split)
    // A nested path resizes only that split.
    const nested = splitLeaf(split, 'b', 'c', 'down')
    const resized = resizeSplitSizes(nested, [1], [0.25, 0.75])
    if (resized.kind === 'split') {
      expect(resized.sizes).toEqual([0.5, 0.5])
      const inner = resized.children.find((child) => child.kind === 'split')
      expect(inner?.kind === 'split' ? inner.sizes : []).toEqual([0.25, 0.75])
    } else {
      expect.unreachable('a split stays a split')
    }
  })

  it('keyboard resizing clamps into the dock and window bounds', () => {
    expect(resizePanelHeightPx(176, 40)).toBe(216)
    expect(resizePanelHeightPx(80, -40)).toBe(80)
    expect(resizePanelHeightPx(1200, 40)).toBe(1200)
    expect(resizePanelHeightPx(100.4, 0)).toBe(100)
    expect(resizeFloatingHeightPx(400, -80)).toBe(320)
    expect(resizeFloatingHeightPx(160, -80)).toBe(160)
  })

  it('output channels clip oldest-first, count the drop, keep pairs whole', () => {
    expect(clipChannelTail('hello', 10)).toEqual({ text: 'hello', dropped: 0 })
    expect(clipChannelTail('hello', 3)).toEqual({ text: 'llo', dropped: 2 })
    // U+1F600 is a surrogate pair; the clip must not strand its low half.
    expect(clipChannelTail('ab\u{1F600}cd', 4)).toEqual({ text: '\u{1F600}cd', dropped: 2 })
    expect(clipChannelTail('ab\u{1F600}cd', 3)).toEqual({ text: 'cd', dropped: 4 })
  })

  it('appended frames grow channels, clip by the shared rule, keep main counts', () => {
    const empty = { channels: [] }
    const first = applyOutputAppend(empty, { channel: 'vite', text: 'ready', truncatedChars: 0 })
    expect(first).toEqual({ channels: [{ channel: 'vite', text: 'ready', truncatedChars: 0 }] })
    const second = applyOutputAppend(first, { channel: 'vite', text: '!', truncatedChars: 0 })
    expect(second.channels).toEqual([{ channel: 'vite', text: 'ready!', truncatedChars: 0 }])
    // Another channel joins; main's truncated count is authoritative.
    const third = applyOutputAppend(second, { channel: 'tsc', text: 'ok', truncatedChars: 41 })
    expect(third.channels).toHaveLength(2)
    expect(third.channels[1]).toEqual({ channel: 'tsc', text: 'ok', truncatedChars: 41 })
    // A megabyte channel clips oldest-first on the renderer too.
    const wide = applyOutputAppend(first, {
      channel: 'vite',
      text: 'x'.repeat(1_048_576),
      truncatedChars: 5,
    })
    expect(wide.channels[0]?.text).toBe('x'.repeat(1_048_576))
    expect(wide.channels[0]?.truncatedChars).toBe(5)
  })

  it('measured floating bounds round, clamp and meet the minimums', () => {
    expect(floatingBoundsFromRect({ left: 10.4, top: 20.6, width: 720, height: 400 })).toEqual({
      x: 10,
      y: 21,
      widthPx: 720,
      heightPx: 400,
    })
    expect(floatingBoundsFromRect({ left: -4, top: -2, width: 100, height: 60 })).toEqual({
      x: 0,
      y: 0,
      widthPx: 320,
      heightPx: 160,
    })
  })

  it('the Problems badge counts errors and warnings, not information', () => {
    expect(
      problemsCounts([
        { severity: 'error' },
        { severity: 'warning' },
        { severity: 'warning' },
        { severity: 'information' },
        { severity: 'hint' },
      ]),
    ).toEqual({ errors: 1, warnings: 2 })
  })

  it('the registry binds the panel chords without conflicts and honours focus', () => {
    const registry = new KeybindingRegistry()
    expect(registry.commandForChord('ctrl+shift+5')?.command).toBe('workbench.splitTerminal')
    expect(registry.commandForChord('ctrl+alt+d')?.command).toBe('workbench.detachTerminal')
    expect(registry.commandForChord('ctrl+alt+c')?.command).toBe('workbench.collapseTerminal')
    expect(registry.commandForChord('ctrl+alt+arrowup')?.command).toBe('workbench.panelTaller')
    expect(registry.chordForCommand('workbench.killTerminal')).toBeUndefined()
    expect(registry.labelForCommand('workbench.killTerminal')).toBeUndefined()
    // A real US Shift+5 press reports `%` in `key`: the chord matches
    // through `code`, as does Shift+Backquote for the new terminal.
    expect(
      registry.commandForChord(
        chordFromEvent({
          ctrlKey: true,
          altKey: false,
          shiftKey: true,
          metaKey: false,
          key: '%',
          code: 'Digit5',
        }),
      )?.command,
    ).toBe('workbench.splitTerminal')
    expect(
      chordFromEvent({
        ctrlKey: true,
        altKey: false,
        shiftKey: true,
        metaKey: false,
        key: '~',
        code: 'Backquote',
      }),
    ).toBe('ctrl+shift+`')
    expect(
      chordFromEvent({
        ctrlKey: true,
        altKey: true,
        shiftKey: false,
        metaKey: false,
        key: 'ArrowUp',
        code: 'ArrowUp',
      }),
    ).toBe('ctrl+alt+arrowup')

    const search = registry.commandForChord('ctrl+f')
    expect(search?.command).toBe('workbench.terminalSearch')
    expect(isBindingActive(search!, 'terminal')).toBe(true)
    expect(isBindingActive(search!, 'editor')).toBe(false)
    expect(isBindingActive(search!, 'other')).toBe(false)
    const save = registry.commandForChord('ctrl+s')
    expect(isBindingActive(save!, 'editor')).toBe(true)
    expect(isBindingActive(save!, 'terminal')).toBe(false)
    const open = registry.commandForChord('ctrl+p')
    expect(isBindingActive(open!, 'terminal')).toBe(true)
    expect(isBindingActive({ command: 'x', chord: 'ctrl+x', when: 'never' }, 'other')).toBe(false)
  })

  it('terminal creation carries agent tabs, bounded and strictly shaped', () => {
    const request = terminalCreateRequestSchema.parse({
      cwd: '/work/app',
      cols: 80,
      rows: 24,
      agent: { label: 'web-eng', runId: 'run-1', command: 'vitest run' },
    })
    expect(request.agent?.runId).toBe('run-1')
    expect(() => terminalCreateRequestSchema.parse({ cwd: '/w', cols: 1, rows: 24 })).toThrow()
    expect(() =>
      terminalCreateRequestSchema.parse({
        cwd: '/w',
        cols: 80,
        rows: 24,
        agent: { label: 'x'.repeat(121), runId: 'r', command: 'c' },
      }),
    ).toThrow()
  })

  it('Problems rows keep M68 shapes and bounds; Output frames are bounded', () => {
    expect(
      panelProblemSchema.parse({
        path: 'src/a.ts',
        severity: 'error',
        line: 3,
        column: 7,
        message: "Cannot find name 'x'.",
        source: 'ts',
      }).severity,
    ).toBe('error')
    expect(() =>
      panelProblemSchema.parse({
        path: 'src/a.ts',
        severity: 'fatal',
        line: 3,
        column: 7,
        message: 'x',
      }),
    ).toThrow()
    expect(() =>
      problemsChangedSchema.parse({
        problems: Array.from({ length: DIAGNOSTICS_MAX_ENTRIES + 1 }, () => ({
          path: 'a.ts',
          severity: 'error',
          line: 1,
          column: 0,
          message: 'x',
        })),
      }),
    ).toThrow()
    expect(
      outputAppendedSchema.parse({ channel: 'vite', text: 'ready', truncatedChars: 0 }).channel,
    ).toBe('vite')
    expect(outputClearedSchema.parse({}).channel).toBeUndefined()
    expect(() => outputClearedSchema.parse({ channel: '' })).toThrow()
  })
})
