// Muse Desktop (M111, D91.13) lane BP: the bottom panel's pure model,
// shared by the Electron main process and the renderer. Tabs with per-tab
// slots (the dock, the floating window, the footer), split panes, the
// read-only rule for agents' tabs, and the resize and badge rules. Wire
// shapes (the layout's version 2, splits, slots) live in bridge.ts. No
// platform API lives here, so every function is exercised directly by the
// unit suites.

import {
  DESKTOP_FLOATING_MIN_HEIGHT_PX,
  DESKTOP_FLOATING_MIN_WIDTH_PX,
  DESKTOP_LAYOUT_BOUNDS,
  DESKTOP_OUTPUT_CHANNEL_MAX_CHARS,
  DESKTOP_SPLIT_MIN_FRACTION,
} from '../constants'
import {
  type FOOTER_TABS,
  type FloatingBounds,
  type OutputAppended,
  type OutputSnapshot,
  type SplitDirection,
  type SplitNode,
  type TerminalAgent,
  type TerminalSlot,
} from './bridge'

/** The panel's views; Live peek is SB2's tab and joins this union with it. */
export type PanelView = (typeof FOOTER_TABS)[number]

export type TerminalSource = 'person' | 'agent'

interface PanelTerminalTabBase {
  readonly id: string
  readonly title: string
  readonly slot: TerminalSlot
}

export interface PanelPersonTab extends PanelTerminalTabBase {
  readonly source: 'person'
}

/**
An agent's command (D91.13, H13): labelled, read-only, linked to Live
peek by its run id. Agents never type into the person's terminals, and
the person never types into these: the surface and the session both
refuse input.
*/
export interface PanelAgentTab extends PanelTerminalTabBase {
  readonly source: 'agent'
  readonly agent: TerminalAgent
}

export type PanelTerminalTab = PanelPersonTab | PanelAgentTab

export function isTerminalWritable(tab: PanelTerminalTab): boolean {
  return tab.source === 'person'
}

/**
Whether closing the tab asks first (D91.13: "after asking if a command
is running"). A tab whose process already exited closes silently; a live
shell at its prompt does too. Anything unknown answers "ask": the
caller passes true for hasChildren when the probe cannot tell.
*/
export function shouldConfirmTerminalClose(isExited: boolean, hasChildren: boolean): boolean {
  return !isExited && hasChildren
}

export function tabsInSlot<Tab extends PanelTerminalTab>(
  tabs: readonly Tab[],
  slot: TerminalSlot,
): Tab[] {
  return tabs.filter((tab) => tab.slot === slot)
}

export function moveTabToSlot<Tab extends PanelTerminalTab>(
  tabs: readonly Tab[],
  id: string,
  slot: TerminalSlot,
): readonly Tab[] {
  const next = tabs.map((tab) => (tab.id !== id || tab.slot === slot ? tab : { ...tab, slot }))
  return next.every((tab, index) => tab === tabs[index]) ? tabs : next
}

/** Reconciles the renderer's tabs with main's sessions after a remount. */
export function reconcileTerminalTabs(
  tabs: readonly PanelTerminalTab[],
  listed: readonly { readonly id: string; readonly title: string }[],
): readonly PanelTerminalTab[] {
  const live = new Set(listed.map((session) => session.id))
  return tabs.filter((tab) => live.has(tab.id))
}

/** Splits one leaf into two panes side by side; no-ops on an unknown leaf. */
export function splitLeaf(
  tree: SplitNode,
  leafId: string,
  newTerminalId: string,
  direction: SplitDirection,
): SplitNode {
  if (tree.kind === 'leaf') {
    if (tree.terminalId !== leafId) return tree
    return {
      kind: 'split',
      direction,
      children: [tree, { kind: 'leaf', terminalId: newTerminalId }],
      sizes: normalizeSplitSizes([1, 1], 2),
    }
  }
  const children = tree.children.map((child) => splitLeaf(child, leafId, newTerminalId, direction))
  return children.every((child, index) => child === tree.children[index])
    ? tree
    : { ...tree, children, sizes: normalizeSplitSizes(tree.sizes, children.length) }
}

/**
Closes one pane. A split left with a single child collapses into it;
closing the last pane leaves no tree. Sizes renormalize to fill.
*/
export function closePane(tree: SplitNode, terminalId: string): SplitNode | null {
  if (tree.kind === 'leaf') return tree.terminalId === terminalId ? null : tree
  const children: SplitNode[] = []
  const sizes: number[] = []
  let isChanged = false
  for (const [index, child] of tree.children.entries()) {
    const kept = closePane(child, terminalId)
    if (kept === null) {
      isChanged = true
      continue
    }
    if (kept !== child) isChanged = true
    children.push(kept)
    sizes.push(...tree.sizes.slice(index, index + 1))
  }
  if (!isChanged) return tree
  if (children.length === 0) return null
  if (children.length === 1) {
    const [only = null] = children
    return only
  }
  return { ...tree, children, sizes: normalizeSplitSizes(sizes, children.length) }
}

/** Keeps only the leaves whose terminal is still in the given set. */
export function pruneSplitTree(tree: SplitNode, keep: ReadonlySet<string>): SplitNode | null {
  if (tree.kind === 'leaf') return keep.has(tree.terminalId) ? tree : null
  const children: SplitNode[] = []
  const sizes: number[] = []
  for (const [index, child] of tree.children.entries()) {
    const kept = pruneSplitTree(child, keep)
    if (kept === null) continue
    children.push(kept)
    sizes.push(...tree.sizes.slice(index, index + 1))
  }
  if (children.length === 0) return null
  if (children.length === 1) {
    const [only = null] = children
    return only
  }
  return { ...tree, children, sizes: normalizeSplitSizes(sizes, children.length) }
}

export function paneTerminalIds(tree: SplitNode): string[] {
  return tree.kind === 'leaf'
    ? [tree.terminalId]
    : tree.children.flatMap((child) => paneTerminalIds(child))
}

/** Fractions that fill the split: truncated or padded, then summing to 1. */
export function normalizeSplitSizes(sizes: readonly number[], count: number): number[] {
  const kept = sizes.slice(0, count)
  while (kept.length < count) kept.push(1)
  const total = kept.reduce((sum, size) => sum + size, 0)
  return total > 0 ? kept.map((size) => size / total) : kept.map(() => 1 / count)
}

/**
Resizes one split node's children: the sizes at the index path (empty for
the root) become the given fractions, each clamped to at least the
minimum pane fraction, renormalized to fill. An unknown path is a
no-op returning the same tree.
*/
export function resizeSplitSizes(
  tree: SplitNode,
  path: readonly number[],
  sizes: readonly number[],
): SplitNode {
  if (path.length === 0) {
    if (tree.kind === 'leaf' || tree.children.length !== sizes.length) return tree
    const clamped = sizes.map((size) => Math.max(DESKTOP_SPLIT_MIN_FRACTION, size))
    return { ...tree, sizes: normalizeSplitSizes(clamped, tree.children.length) }
  }
  if (tree.kind === 'leaf') return tree
  const [at = -1, ...rest] = path
  const child = tree.children[at]
  if (child === undefined) return tree
  const resized = resizeSplitSizes(child, rest, sizes)
  if (resized === child) return tree
  return {
    ...tree,
    children: tree.children.map((entry, index) => (index === at ? resized : entry)),
  }
}

/** The keyboard resize step, clamped into the dock's height bounds. */
export function resizePanelHeightPx(currentPx: number, deltaPx: number): number {
  return Math.min(
    DESKTOP_LAYOUT_BOUNDS.terminalHeightMaxPx,
    Math.max(DESKTOP_LAYOUT_BOUNDS.terminalHeightMinPx, Math.round(currentPx + deltaPx)),
  )
}

/** The keyboard resize step for the floating window's height. */
export function resizeFloatingHeightPx(currentPx: number, deltaPx: number): number {
  return Math.max(DESKTOP_FLOATING_MIN_HEIGHT_PX, Math.round(currentPx + deltaPx))
}

const LOW_SURROGATE = /^[\uDC00-\uDFFF]/u

/**
An Output channel's tail after an append: at most `maxChars`, oldest
dropped first and counted, never splitting a surrogate pair (a cut
between halves strands the low one, which is dropped too). Main and
the renderer apply the same rule, so their texts cannot diverge.
*/
export function clipChannelTail(
  text: string,
  maxChars: number,
): {
  readonly text: string
  readonly dropped: number
} {
  if (text.length <= maxChars) return { text, dropped: 0 }
  let kept = text.slice(text.length - maxChars)
  if (LOW_SURROGATE.test(kept)) kept = kept.slice(1)
  return { text: kept, dropped: text.length - kept.length }
}

/**
An Output snapshot after one appended frame: the channel's text grows
by the frame and clips by the same rule main applies, while the
truncated count stays main's authoritative one.
*/
export function applyOutputAppend(snapshot: OutputSnapshot, frame: OutputAppended): OutputSnapshot {
  const found = snapshot.channels.find((entry) => entry.channel === frame.channel)
  const text = clipChannelTail(
    `${found?.text ?? ''}${frame.text}`,
    DESKTOP_OUTPUT_CHANNEL_MAX_CHARS,
  ).text
  const entry = { channel: frame.channel, text, truncatedChars: frame.truncatedChars }
  return {
    channels:
      found === undefined
        ? [...snapshot.channels, entry]
        : snapshot.channels.map((candidate) =>
            candidate.channel === frame.channel ? entry : candidate,
          ),
  }
}

/**
Floating bounds measured from a rendered window: rounded, kept on the
positive axes and at least the minimum size, so the layout store's
schema always accepts them.
*/
export function floatingBoundsFromRect(rect: {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}): FloatingBounds {
  return {
    x: Math.max(0, Math.round(rect.left)),
    y: Math.max(0, Math.round(rect.top)),
    widthPx: Math.max(DESKTOP_FLOATING_MIN_WIDTH_PX, Math.round(rect.width)),
    heightPx: Math.max(DESKTOP_FLOATING_MIN_HEIGHT_PX, Math.round(rect.height)),
  }
}

/** How many errors and warnings the Problems badge counts (M68's rule: information and hints are not what an edit breaks). */
export function problemsCounts(entries: readonly { readonly severity: string }[]): {
  readonly errors: number
  readonly warnings: number
} {
  let errors = 0
  let warnings = 0
  for (const entry of entries) {
    if (entry.severity === 'error') errors += 1
    else if (entry.severity === 'warning') warnings += 1
  }
  return { errors, warnings }
}
