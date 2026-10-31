// Muse Desktop (M111, D91) lane WB: the desktop bridge's wire shapes.
// Every frame between the Electron main process, the preload and the
// workbench renderer is parsed with these schemas before use (AGENTS rule 7).
// The renderer never sees Node, Electron or a filesystem path it did not
// receive through one of these shapes.

import { z } from 'zod'
import {
  DESKTOP_FLOATING_MIN_HEIGHT_PX,
  DESKTOP_FLOATING_MIN_WIDTH_PX,
  DESKTOP_LAYOUT_BOUNDS,
  DESKTOP_OUTPUT_APPEND_MAX_CHARS,
  DESKTOP_OUTPUT_CHANNEL_NAME_MAX_CHARS,
  DESKTOP_TERMINAL_COMMAND_MAX_CHARS,
  DESKTOP_TERMINAL_LABEL_MAX_CHARS,
  DIAGNOSTIC_MESSAGE_MAX_CHARS,
  DIAGNOSTICS_MAX_ENTRIES,
} from '../constants'
import { COMPACT_PANES } from '../desktopContracts'

/** Channels the preload exposes; anything else is refused by name. */
export const DESKTOP_CHANNELS = [
  'muse-desktop:ready',
  'muse-desktop:workspace',
  'muse-desktop:layout:get',
  'muse-desktop:layout:set',
  'muse-desktop:files:list',
  'muse-desktop:files:read',
  'muse-desktop:files:write',
  'muse-desktop:status:publish',
  'muse-desktop:terminal:create',
  'muse-desktop:terminal:write',
  'muse-desktop:terminal:resize',
  'muse-desktop:terminal:close',
  'muse-desktop:terminal:list',
  'muse-desktop:terminal:children',
  'muse-desktop:terminal:data',
  'muse-desktop:terminal:exit',
  'muse-desktop:terminal:opened',
  'muse-desktop:problems:get',
  'muse-desktop:problems:changed',
  'muse-desktop:output:get',
  'muse-desktop:output:clear',
  'muse-desktop:output:appended',
  'muse-desktop:output:cleared',
  'muse-desktop:window:open-workspace',
  'muse-desktop:window:close',
  'muse-desktop:external:open',
] as const
export type DesktopChannel = (typeof DESKTOP_CHANNELS)[number]

export const desktopWorkspaceSchema = z.strictObject({
  root: z.string().min(1),
  name: z.string().min(1),
  setupMode: z.boolean(),
})
export type DesktopWorkspace = z.infer<typeof desktopWorkspaceSchema>

/** Where the terminal panel sits (D91.13): detached is always floating. */
export const TERMINAL_PLACEMENTS = ['docked', 'footer', 'floating', 'hidden'] as const
export type TerminalPlacement = (typeof TERMINAL_PLACEMENTS)[number]

export const FOOTER_TABS = ['terminal', 'problems', 'output'] as const
export type FooterTab = (typeof FOOTER_TABS)[number]

/** The persisted workbench layout, per workspace and per Hyprland workspace. */
export const workbenchLayoutSchema = z.strictObject({
  version: z.literal(1),
  chatWidthPx: z
    .number()
    .int()
    .min(DESKTOP_LAYOUT_BOUNDS.chatWidthMinPx)
    .max(DESKTOP_LAYOUT_BOUNDS.chatWidthMaxPx),
  sidebarWidthPx: z
    .number()
    .int()
    .min(DESKTOP_LAYOUT_BOUNDS.sidebarWidthMinPx)
    .max(DESKTOP_LAYOUT_BOUNDS.sidebarWidthMaxPx),
  sidebarVisible: z.boolean(),
  railVisible: z.boolean(),
  terminalPlacement: z.enum(TERMINAL_PLACEMENTS),
  terminalHeightPx: z
    .number()
    .int()
    .min(DESKTOP_LAYOUT_BOUNDS.terminalHeightMinPx)
    .max(DESKTOP_LAYOUT_BOUNDS.terminalHeightMaxPx),
  activeFooterTab: z.enum(FOOTER_TABS),
  activeTerminalId: z.string().min(1).optional(),
  openFiles: z.array(z.string().min(1)),
  activeFile: z.string().min(1).optional(),
})
export type WorkbenchLayout = z.infer<typeof workbenchLayoutSchema>

export const DEFAULT_WORKBENCH_LAYOUT: WorkbenchLayout = {
  version: 1,
  chatWidthPx: COMPACT_PANES.chatWidthPx,
  sidebarWidthPx: COMPACT_PANES.sidebarWidthPx,
  sidebarVisible: true,
  railVisible: true,
  terminalPlacement: 'docked',
  terminalHeightPx: COMPACT_PANES.terminalHeightPx,
  activeFooterTab: 'terminal',
  openFiles: [],
}

/** Where one terminal tab sits: the dock, the floating window, the footer. */
export const TERMINAL_SLOTS = ['dock', 'window', 'footer'] as const
export type TerminalSlot = (typeof TERMINAL_SLOTS)[number]

export type SplitDirection = 'right' | 'down'

export type SplitNode =
  | { readonly kind: 'leaf'; readonly terminalId: string }
  | {
      readonly kind: 'split'
      readonly direction: SplitDirection
      readonly children: readonly SplitNode[]
      readonly sizes: readonly number[]
    }

const splitLeafSchema = z.strictObject({
  kind: z.literal('leaf'),
  terminalId: z.string().min(1),
})

export const splitNodeSchema: z.ZodType<SplitNode> = z.union([
  splitLeafSchema,
  z.strictObject({
    kind: z.literal('split'),
    direction: z.enum(['right', 'down']),
    children: z.array(z.lazy(() => splitNodeSchema)).min(2),
    sizes: z.array(z.number().positive()).min(2),
  }),
])

export const floatingBoundsSchema = z.strictObject({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  widthPx: z.number().int().min(DESKTOP_FLOATING_MIN_WIDTH_PX),
  heightPx: z.number().int().min(DESKTOP_FLOATING_MIN_HEIGHT_PX),
})
export type FloatingBounds = z.infer<typeof floatingBoundsSchema>

const v1Shape = workbenchLayoutSchema.shape

/**
The persisted layout, version 2 (lane BP). WB's `activeFooterTab`
becomes the panel's view; pinning, per-tab slots, splits, the
floating bounds and its always-on-top join it. Strict: anything else
stored is refused.
*/
export const workbenchLayoutV2Schema = z.strictObject({
  version: z.literal(2),
  chatWidthPx: v1Shape.chatWidthPx,
  sidebarWidthPx: v1Shape.sidebarWidthPx,
  sidebarVisible: v1Shape.sidebarVisible,
  railVisible: v1Shape.railVisible,
  terminalPlacement: v1Shape.terminalPlacement,
  terminalHeightPx: v1Shape.terminalHeightPx,
  activeTerminalId: v1Shape.activeTerminalId,
  openFiles: v1Shape.openFiles,
  activeFile: v1Shape.activeFile,
  panelView: z.enum(FOOTER_TABS),
  panelPinned: z.boolean(),
  tabSlots: z.record(z.string(), z.enum(TERMINAL_SLOTS)),
  splits: splitNodeSchema.optional(),
  floatingBounds: floatingBoundsSchema.optional(),
  floatingOnTop: z.boolean().optional(),
  activePaneId: z.string().min(1).optional(),
})
export type WorkbenchLayoutV2 = z.infer<typeof workbenchLayoutV2Schema>

export const DEFAULT_WORKBENCH_LAYOUT_V2: WorkbenchLayoutV2 = {
  version: 2,
  chatWidthPx: COMPACT_PANES.chatWidthPx,
  sidebarWidthPx: COMPACT_PANES.sidebarWidthPx,
  sidebarVisible: true,
  railVisible: true,
  terminalPlacement: 'docked',
  terminalHeightPx: COMPACT_PANES.terminalHeightPx,
  openFiles: [],
  panelView: 'terminal',
  panelPinned: true,
  tabSlots: {},
  floatingOnTop: false,
}

export function migrateLayoutV1ToV2(v1: WorkbenchLayout): WorkbenchLayoutV2 {
  return {
    version: 2,
    chatWidthPx: v1.chatWidthPx,
    sidebarWidthPx: v1.sidebarWidthPx,
    sidebarVisible: v1.sidebarVisible,
    railVisible: v1.railVisible,
    terminalPlacement: v1.terminalPlacement,
    terminalHeightPx: v1.terminalHeightPx,
    ...(v1.activeTerminalId !== undefined && { activeTerminalId: v1.activeTerminalId }),
    openFiles: v1.openFiles,
    ...(v1.activeFile !== undefined && { activeFile: v1.activeFile }),
    panelView: v1.activeFooterTab,
    panelPinned: true,
    tabSlots: {},
    floatingOnTop: false,
  }
}

/**
Parses a stored layout: version 2 as stored, version 1 migrated. A
record that is neither is refused with the version 2 failure, so the
caller can say the layout is unreadable instead of keeping a broken one.
*/
export function parseStoredLayoutV2(raw: unknown): WorkbenchLayoutV2 {
  const v2 = workbenchLayoutV2Schema.safeParse(raw)
  if (v2.success) return v2.data
  const v1 = workbenchLayoutSchema.safeParse(raw)
  if (v1.success) return migrateLayoutV1ToV2(v1.data)
  throw v2.error
}

export function isStoredLayoutV2(raw: unknown): raw is WorkbenchLayoutV2 {
  return workbenchLayoutV2Schema.safeParse(raw).success
}

export const layoutKeySchema = z.strictObject({
  workspaceRoot: z.string().min(1),
  compositorWorkspace: z.string().min(1).optional(),
})
export type LayoutKey = z.infer<typeof layoutKeySchema>

export const layoutSetRequestSchema = z.strictObject({
  key: layoutKeySchema,
  layout: workbenchLayoutV2Schema,
})
export type LayoutSetRequest = z.infer<typeof layoutSetRequestSchema>

/** One item the workbench publishes to SH1's status bar (D91.13, D91.30). */
export const desktopStatusItemSchema = z.strictObject({
  id: z.string().min(1),
  side: z.enum(['left', 'right']),
  text: z.string().min(1),
  tooltip: z.string().optional(),
  command: z.string().min(1).optional(),
  priority: z.number().int(),
})
export type DesktopStatusItem = z.infer<typeof desktopStatusItemSchema>

export const statusPublishRequestSchema = z.strictObject({
  workspaceRoot: z.string().min(1),
  items: z.array(desktopStatusItemSchema),
})
export type StatusPublishRequest = z.infer<typeof statusPublishRequestSchema>

export const fileEntrySchema = z.strictObject({
  path: z.string().min(1),
  name: z.string().min(1),
})
export type FileEntry = z.infer<typeof fileEntrySchema>

export const fileReadRequestSchema = z.strictObject({ path: z.string().min(1) })
export const fileReadResultSchema = z.strictObject({
  path: z.string().min(1),
  text: z.string(),
})
export type FileReadResult = z.infer<typeof fileReadResultSchema>

export const fileWriteRequestSchema = z.strictObject({
  path: z.string().min(1),
  text: z.string(),
})

/**
An agent's command (D91.13, H13): the label the tab shows, the command
it names, and the run id Live peek keys on. The session is read-only:
main refuses every write to it, and the surface never sends one.
*/
export const terminalAgentSchema = z.strictObject({
  label: z.string().min(1).max(DESKTOP_TERMINAL_LABEL_MAX_CHARS),
  runId: z.string().min(1),
  command: z.string().min(1).max(DESKTOP_TERMINAL_COMMAND_MAX_CHARS),
})
export type TerminalAgent = z.infer<typeof terminalAgentSchema>

export const terminalCreateRequestSchema = z.strictObject({
  cwd: z.string().min(1),
  cols: z.number().int().min(2).max(DESKTOP_LAYOUT_BOUNDS.terminalDimensionMax),
  rows: z.number().int().min(2).max(DESKTOP_LAYOUT_BOUNDS.terminalDimensionMax),
  agent: terminalAgentSchema.optional(),
})
export type TerminalCreateRequest = z.infer<typeof terminalCreateRequestSchema>

export const terminalCreatedSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  agent: terminalAgentSchema.optional(),
})
export type TerminalCreated = z.infer<typeof terminalCreatedSchema>

export const terminalSessionSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  agent: terminalAgentSchema.optional(),
})
export type TerminalSessionInfo = z.infer<typeof terminalSessionSchema>

/** Emitted on every create, so agent tabs opened outside the renderer appear. */
export const terminalOpenedSchema = terminalSessionSchema
export type TerminalOpened = z.infer<typeof terminalOpenedSchema>

export const terminalChildrenSchema = z.strictObject({
  id: z.string().min(1),
  hasChildren: z.boolean(),
})
export type TerminalChildren = z.infer<typeof terminalChildrenSchema>

export const terminalWriteSchema = z.strictObject({
  id: z.string().min(1),
  data: z.string(),
})
export const terminalResizeSchema = z.strictObject({
  id: z.string().min(1),
  cols: z.number().int().min(2).max(DESKTOP_LAYOUT_BOUNDS.terminalDimensionMax),
  rows: z.number().int().min(2).max(DESKTOP_LAYOUT_BOUNDS.terminalDimensionMax),
})
export const terminalDataSchema = z.strictObject({
  id: z.string().min(1),
  data: z.string(),
})
export const terminalExitSchema = z.strictObject({
  id: z.string().min(1),
  code: z.number().int().nullable(),
})
export const terminalIdSchema = z.strictObject({ id: z.string().min(1) })

/**
One Problems row: M68's `DiagnosticEntry` over the bridge (the severity
union re-declared, as every bridge shape re-declares what it carries).
Paths are workspace-relative with forward slashes; the list is bounded
by the product's own `DIAGNOSTICS_MAX_ENTRIES`.
*/
export const panelProblemSchema = z.strictObject({
  path: z.string().min(1),
  severity: z.enum(['error', 'warning', 'information', 'hint']),
  line: z.number().int().min(1),
  column: z.number().int().min(0),
  message: z.string().min(1).max(DIAGNOSTIC_MESSAGE_MAX_CHARS),
  source: z.string().min(1).optional(),
})
export type PanelProblem = z.infer<typeof panelProblemSchema>

export const problemsChangedSchema = z.strictObject({
  problems: z.array(panelProblemSchema).max(DIAGNOSTICS_MAX_ENTRIES),
})
export type ProblemsChanged = z.infer<typeof problemsChangedSchema>

/** One Output channel's appended text, as the event carries it. */
export const outputAppendedSchema = z.strictObject({
  channel: z.string().min(1).max(DESKTOP_OUTPUT_CHANNEL_NAME_MAX_CHARS),
  text: z.string().max(DESKTOP_OUTPUT_APPEND_MAX_CHARS),
  truncatedChars: z.number().int().min(0),
})
export type OutputAppended = z.infer<typeof outputAppendedSchema>

export const outputClearedSchema = z.strictObject({
  channel: z.string().min(1).max(DESKTOP_OUTPUT_CHANNEL_NAME_MAX_CHARS).optional(),
})
export type OutputCleared = z.infer<typeof outputClearedSchema>

export const outputSnapshotSchema = z.strictObject({
  channels: z.array(
    z.strictObject({
      channel: z.string().min(1),
      text: z.string(),
      truncatedChars: z.number().int().min(0),
    }),
  ),
})
export type OutputSnapshot = z.infer<typeof outputSnapshotSchema>

export const openWorkspaceRequestSchema = z.strictObject({
  root: z.string().min(1),
})
export const externalOpenRequestSchema = z.strictObject({
  url: z.string().min(1),
})

/** The typed surface the preload puts on `window.museDesktop`. */
export interface MuseDesktopBridge {
  workspace(): Promise<DesktopWorkspace>
  getLayout(key: LayoutKey): Promise<WorkbenchLayoutV2 | null>
  setLayout(request: LayoutSetRequest): Promise<void>
  listFiles(): Promise<readonly FileEntry[]>
  readFile(path: string): Promise<FileReadResult>
  writeFile(path: string, text: string): Promise<void>
  publishStatus(request: StatusPublishRequest): Promise<void>
  createTerminal(request: TerminalCreateRequest): Promise<TerminalCreated>
  writeTerminal(id: string, data: string): void
  resizeTerminal(id: string, cols: number, rows: number): void
  closeTerminal(id: string): void
  listTerminals(): Promise<readonly TerminalSessionInfo[]>
  hasTerminalChildren(id: string): Promise<TerminalChildren>
  onTerminalData(listener: (frame: { id: string; data: string }) => void): () => void
  onTerminalExit(listener: (frame: { id: string; code: number | null }) => void): () => void
  onTerminalOpened(listener: (frame: TerminalOpened) => void): () => void
  getProblems(): Promise<ProblemsChanged>
  onProblemsChanged(listener: (frame: ProblemsChanged) => void): () => void
  getOutput(): Promise<OutputSnapshot>
  clearOutput(channel?: string): void
  onOutputAppended(listener: (frame: OutputAppended) => void): () => void
  onOutputCleared(listener: (frame: OutputCleared) => void): () => void
  openWorkspace(root: string): Promise<void>
  openExternal(url: string): Promise<void>
  closeWindow(): Promise<void>
}
