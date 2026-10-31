// Muse Desktop (M111, D91.3) lane CP: the CompositorPort's TypeScript mirror.
// One Rust trait and one TypeScript mirror; nothing above either names
// Hyprland. The Rust adapter (desktop/crates/compositor) executes; this
// module is pure contracts and policy: zod shapes, the port interface, the
// agents' desktop tools with their approval classes, and the placement,
// ownership and thumbnail rules. Lane 0's row assigns this file; lane 0
// landed only desktopContracts.ts, so CP defines the port here.

import { z } from 'zod'
import {
  DESKTOP_PLACEMENT_DEFAULT,
  DESKTOP_THUMBNAIL_FPS,
  MILLISECONDS_PER_SECOND,
} from '../constants'
import { type ResourceLevel } from '../resources'

// A desktop: one workspace with its windows, on one monitor (D91.15).
export const desktopInfoSchema = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  monitor: z.string(),
  monitorId: z.number().int(),
  windows: z.number().int().min(0),
  fullscreen: z.boolean(),
  lastWindow: z.string(),
})
export type DesktopInfo = z.infer<typeof desktopInfoSchema>

// One window on a desktop.
export const windowInfoSchema = z.strictObject({
  address: z.string(),
  class: z.string(),
  title: z.string(),
  pid: z.number().int(),
  desktopId: z.number().int(),
  desktopName: z.string(),
  floating: z.boolean(),
  fullscreen: z.boolean(),
  pinned: z.boolean(),
  monitor: z.string(),
})
export type WindowInfo = z.infer<typeof windowInfoSchema>

// One output with its mode and position.
export const monitorInfoSchema = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  description: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  refreshRate: z.number(),
  x: z.number().int(),
  y: z.number().int(),
  scale: z.number(),
  activeDesktop: z.number().int(),
})
export type MonitorInfo = z.infer<typeof monitorInfoSchema>

// A tiling layout the port can pick per desktop (D91.15).
export const layoutSchema = z.union([
  z.enum(['dwindle', 'master', 'scrolling']),
  z.strictObject({ custom: z.string().min(1) }),
])
export type Layout = z.infer<typeof layoutSchema>

// An input device: a keyboard, pointer, tablet or switch.
export const inputDeviceSchema = z.strictObject({
  name: z.string(),
  kind: z.string(),
  layout: z.string(),
})
export type InputDevice = z.infer<typeof inputDeviceSchema>

// Where a headed app opens (`desktop.placement`; D91.15's amendment).
export const placementSchema = z.enum(['new-desktop', 'current-desktop', 'ask'])
export type Placement = z.infer<typeof placementSchema>

// The placement in force: the person's setting, or a new desktop.
export function effectivePlacement(setting: Placement | undefined): Placement {
  return setting ?? DESKTOP_PLACEMENT_DEFAULT
}

// Whether opening asks where the app should go, every time.
export function shouldAskPlacement(setting: Placement | undefined): boolean {
  return effectivePlacement(setting) === 'ask'
}

// Who owns a desktop: the person, an agent, or a session (D91.15).
export const desktopOwnerSchema = z.union([
  z.strictObject({ type: z.literal('user') }),
  z.strictObject({ type: z.literal('agent'), name: z.string().min(1) }),
  z.strictObject({ type: z.literal('session'), name: z.string().min(1) }),
])
export type DesktopOwner = z.infer<typeof desktopOwnerSchema>

// The pill label: the agent or session name, or nothing for the user.
export function ownerLabel(owner: DesktopOwner): string | undefined {
  return owner.type === 'user' ? undefined : owner.name
}

// A workspace bound to a project folder (D91.15).
export const desktopBindingSchema = z.strictObject({
  desktop: z.string().min(1),
  project: z.string().min(1),
})
export type DesktopBinding = z.infer<typeof desktopBindingSchema>

// The bindings section of `desktop.json`, for the settings lane to embed:
// desktop ids to absolute project folders. The desktop is Linux-only, so
// every project is an absolute POSIX path.
export const workspaceBindingsSchema = z.record(
  z.string().min(1),
  z
    .string()
    .min(1)
    .refine((project) => project.startsWith('/'), 'project must be absolute'),
)
export type WorkspaceBindings = z.infer<typeof workspaceBindingsSchema>

// A monitor arrangement applied live through the port (D91.15).
export const monitorSpecSchema = z.strictObject({
  output: z.string().min(1),
  mode: z.string().min(1),
  position: z.string().min(1),
  scale: z.number(),
})
export type MonitorSpec = z.infer<typeof monitorSpecSchema>

// Which window a call targets. Neutral shapes; the adapter renders the
// compositor's selector syntax, so callers never write it.
export const windowSelectorSchema = z.union([
  z.strictObject({ kind: z.literal('active') }),
  z.strictObject({ kind: z.enum(['address', 'class', 'title']), value: z.string().min(1) }),
])
export type WindowSelector = z.infer<typeof windowSelectorSchema>

// Fullscreen modes for `setFullscreen`.
export const fullscreenModeSchema = z.enum(['maximize', 'fullscreen'])
export type FullscreenMode = z.infer<typeof fullscreenModeSchema>

// Keyboard-layout switch commands for `switchKeyboardLayout`.
export const keyboardLayoutCommandSchema = z.union([
  z.strictObject({ command: z.literal('next') }),
  z.strictObject({ command: z.literal('previous') }),
  z.strictObject({ command: z.literal('index'), index: z.number().int().min(0) }),
])
export type KeyboardLayoutCommand = z.infer<typeof keyboardLayoutCommandSchema>

// Compositor health: reachable, its version, and the probe round trip.
export const healthSchema = z.strictObject({
  version: z.string(),
  pingMs: z.number().int().min(0),
})
export type Health = z.infer<typeof healthSchema>

// Every event the port reports, as the compositor sent it. Anything the
// wire adds later arrives as `unknown`, never dropped (D36).
export const compositorEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('desktop-changed'), id: z.number().int(), name: z.string() }),
  z.strictObject({ type: z.literal('desktop-created'), id: z.number().int(), name: z.string() }),
  z.strictObject({ type: z.literal('desktop-destroyed'), id: z.number().int(), name: z.string() }),
  z.strictObject({ type: z.literal('desktop-renamed'), id: z.number().int(), name: z.string() }),
  z.strictObject({
    type: z.literal('desktop-monitor-changed'),
    id: z.number().int(),
    name: z.string(),
    monitor: z.string(),
  }),
  z.strictObject({ type: z.literal('monitor-focused'), monitor: z.string(), desktop: z.string() }),
  z.strictObject({ type: z.literal('monitor-added'), id: z.number().int(), name: z.string() }),
  z.strictObject({ type: z.literal('monitor-removed'), id: z.number().int(), name: z.string() }),
  z.strictObject({
    type: z.literal('window-opened'),
    address: z.string(),
    desktop: z.string(),
    class: z.string(),
    title: z.string(),
  }),
  z.strictObject({ type: z.literal('window-closed'), address: z.string() }),
  z.strictObject({ type: z.literal('window-focused'), address: z.string() }),
  z.strictObject({ type: z.literal('window-title'), address: z.string(), title: z.string() }),
  z.strictObject({
    type: z.literal('window-moved'),
    address: z.string(),
    desktopId: z.number().int(),
    desktopName: z.string(),
  }),
  z.strictObject({
    type: z.literal('window-floating'),
    address: z.string(),
    floating: z.boolean(),
  }),
  z.strictObject({ type: z.literal('window-urgent'), address: z.string() }),
  z.strictObject({ type: z.literal('window-pinned'), address: z.string(), pinned: z.boolean() }),
  z.strictObject({ type: z.literal('fullscreen-changed'), fullscreen: z.boolean() }),
  z.strictObject({
    type: z.literal('screencast-changed'),
    active: z.boolean(),
    owner: z.string(),
    target: z.string(),
  }),
  z.strictObject({
    type: z.literal('input-layout-changed'),
    keyboard: z.string(),
    layout: z.string(),
  }),
  z.strictObject({ type: z.literal('group-changed'), active: z.boolean(), members: z.string() }),
  z.strictObject({ type: z.literal('window-grouped'), address: z.string() }),
  z.strictObject({ type: z.literal('window-ungrouped'), address: z.string() }),
  z.strictObject({ type: z.literal('group-lock-changed'), locked: z.boolean() }),
  z.strictObject({ type: z.literal('submap-changed'), name: z.string() }),
  z.strictObject({ type: z.literal('layer-opened'), namespace: z.string() }),
  z.strictObject({ type: z.literal('layer-closed'), namespace: z.string() }),
  z.strictObject({ type: z.literal('special-changed'), name: z.string(), monitor: z.string() }),
  z.strictObject({ type: z.literal('bell'), address: z.string() }),
  z.strictObject({ type: z.literal('minimized'), address: z.string(), minimized: z.boolean() }),
  z.strictObject({ type: z.literal('config-reloaded') }),
  z.strictObject({ type: z.literal('unknown'), name: z.string(), data: z.string() }),
])
export type CompositorEvent = z.infer<typeof compositorEventSchema>

// The agents' desktop tools (D91.15): opening an app on its own desktop,
// sending a window, and merging. The Model API tool table and the `ide`
// MCP server register them with their owners at merge; the names and
// argument shapes are fixed here.
export const DESKTOP_TOOLS = {
  open: 'desktop_open',
  send: 'desktop_send',
  merge: 'desktop_merge',
} as const
export type DesktopToolName = (typeof DESKTOP_TOOLS)[keyof typeof DESKTOP_TOOLS]

// The tools' approval class: `edit`. An agent rearranges its own desktops
// freely and asks before touching any other, which is the `edit` rule with
// another's desktop counting as protected (`permissions.ts`).
export const DESKTOP_TOOL_CLASS = 'edit' as const

// `desktop_open`: a headed app on a desktop, never stealing focus.
export const desktopOpenArgsSchema = z.strictObject({
  command: z.string().min(1),
  desktop: z.string().min(1).optional(),
  focus: z.boolean().optional(),
})
export type DesktopOpenArgs = z.infer<typeof desktopOpenArgsSchema>

// `desktop_send`: a window to a desktop, or a new desktop past the top.
export const desktopSendArgsSchema = z.strictObject({
  window: windowSelectorSchema,
  desktop: z.string().min(1).optional(),
  follow: z.boolean().optional(),
})
export type DesktopSendArgs = z.infer<typeof desktopSendArgsSchema>

// `desktop_merge`: every client from one desktop into another.
export const desktopMergeArgsSchema = z.strictObject({
  source: z.string().min(1),
  target: z.string().min(1),
})
export type DesktopMergeArgs = z.infer<typeof desktopMergeArgsSchema>

// Whether a desktop tool call runs free or asks first (D91.15): free when
// every desktop it touches is the caller's own, asking otherwise. Unknown
// ownership asks: failing closed is the rule.
export function judgeDesktopTool(
  targets: readonly { desktop: string; owner: DesktopOwner | undefined }[],
  caller: DesktopOwner,
): 'allow' | 'ask' {
  if (caller.type === 'user') return 'allow'
  const isOwn = (owner: DesktopOwner | undefined): boolean =>
    owner?.type === caller.type && ownerLabel(owner) === ownerLabel(caller)
  return targets.every((target) => isOwn(target.owner)) ? 'allow' : 'ask'
}

// Whether a live thumbnail may capture now: only under no governor
// pressure, and at most `DESKTOP_THUMBNAIL_FPS` frames per second (D91.15).
// Mirrors `thumbnails_live` in the port crate.
export function canCaptureThumbnail(
  level: ResourceLevel,
  lastMs: number | undefined,
  nowMs: number,
): boolean {
  return (
    level === 'normal' &&
    (lastMs === undefined || (nowMs - lastMs) * DESKTOP_THUMBNAIL_FPS >= MILLISECONDS_PER_SECOND)
  )
}

// One row of the generated desktop key table (`os/desktop/hyprland/keys.json`,
// D91.15): every binding in effect, with its command and where it applies.
// `/report keybindings` reads this shape at M113.
export const desktopKeybindingSchema = z.strictObject({
  binding: z.string().min(1),
  action: z.string().min(1),
  command: z.string().min(1),
  applies: z.literal('desktop'),
})
export type DesktopKeybinding = z.infer<typeof desktopKeybindingSchema>

// The port every desktop caller programs against, mirrored for
// TypeScript: desktops are workspaces; a merge moves every client; an
// agent's new desktop never takes focus. Execution lives in the Rust
// adapter; this interface pins the calls for the bridge lanes.
export interface CompositorPort {
  desktops(): Promise<DesktopInfo[]>
  activeDesktop(): Promise<DesktopInfo>
  switchDesktop(desktop: string): Promise<void>
  moveWindow(window: WindowSelector, desktop: string, shouldFollow: boolean): Promise<void>
  bindDesktop(desktop: string, project: string): Promise<void>
  unbindDesktop(desktop: string): Promise<void>
  desktopBindings(): Promise<DesktopBinding[]>
  windows(): Promise<WindowInfo[]>
  activeWindow(): Promise<WindowInfo | undefined>
  focusWindow(window: WindowSelector): Promise<void>
  closeWindow(window: WindowSelector): Promise<void>
  floatWindow(window: WindowSelector, shouldFloat: boolean): Promise<void>
  setFullscreen(window: WindowSelector, mode: FullscreenMode | undefined): Promise<void>
  pinWindow(window: WindowSelector, shouldPin: boolean): Promise<void>
  centerWindow(window: WindowSelector): Promise<void>
  toggleGroup(window: WindowSelector): Promise<void>
  openOnDesktop(command: string, desktop: string, shouldFocus: boolean): Promise<void>
  labelDesktop(desktop: string, label: string): Promise<void>
  sendToNewDesktop(window: WindowSelector, shouldFollow: boolean): Promise<string>
  mergeDesktops(source: string, target: string): Promise<number>
  setLayout(desktop: string | undefined, layout: Layout): Promise<void>
  setSplitRatio(ratio: number): Promise<void>
  setMasterFactor(mfact: number): Promise<void>
  setGaps(innerPx: number, outerPx: number): Promise<void>
  monitors(): Promise<MonitorInfo[]>
  arrangeMonitor(spec: MonitorSpec): Promise<void>
  moveDesktopToMonitor(desktop: string, monitor: string): Promise<void>
  moveWindowToMonitor(window: WindowSelector, monitor: string, shouldFollow: boolean): Promise<void>
  inputDevices(): Promise<InputDevice[]>
  switchKeyboardLayout(device: string, command: KeyboardLayoutCommand): Promise<void>
  setRepeat(rate: number, delayMs: number): Promise<void>
  applyAppearance(mode: 'light' | 'dark' | 'hc-light' | 'hc-dark'): Promise<void>
  setReducedMotion(shouldReduce: boolean): Promise<void>
  subscribe(): AsyncIterable<CompositorEvent>
  ping(): Promise<Health>
}
