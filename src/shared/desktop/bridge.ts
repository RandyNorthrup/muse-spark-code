// Muse Desktop (M111, D91) lane WB: the desktop bridge's wire shapes.
// Every frame between the Electron main process, the preload and the
// workbench renderer is parsed with these schemas before use (AGENTS rule 7).
// The renderer never sees Node, Electron or a filesystem path it did not
// receive through one of these shapes.

import { z } from 'zod'
import { DESKTOP_LAYOUT_BOUNDS } from '../constants'
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
  'muse-desktop:terminal:data',
  'muse-desktop:terminal:exit',
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

export const layoutKeySchema = z.strictObject({
  workspaceRoot: z.string().min(1),
  compositorWorkspace: z.string().min(1).optional(),
})
export type LayoutKey = z.infer<typeof layoutKeySchema>

export const layoutSetRequestSchema = z.strictObject({
  key: layoutKeySchema,
  layout: workbenchLayoutSchema,
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

export const terminalCreateRequestSchema = z.strictObject({
  cwd: z.string().min(1),
  cols: z.number().int().min(2).max(DESKTOP_LAYOUT_BOUNDS.terminalDimensionMax),
  rows: z.number().int().min(2).max(DESKTOP_LAYOUT_BOUNDS.terminalDimensionMax),
})
export type TerminalCreateRequest = z.infer<typeof terminalCreateRequestSchema>

export const terminalCreatedSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
})
export type TerminalCreated = z.infer<typeof terminalCreatedSchema>

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

export const openWorkspaceRequestSchema = z.strictObject({
  root: z.string().min(1),
})
export const externalOpenRequestSchema = z.strictObject({
  url: z.string().min(1),
})

/** The typed surface the preload puts on `window.museDesktop`. */
export interface MuseDesktopBridge {
  workspace(): Promise<DesktopWorkspace>
  getLayout(key: LayoutKey): Promise<WorkbenchLayout | null>
  setLayout(request: LayoutSetRequest): Promise<void>
  listFiles(): Promise<readonly FileEntry[]>
  readFile(path: string): Promise<FileReadResult>
  writeFile(path: string, text: string): Promise<void>
  publishStatus(request: StatusPublishRequest): Promise<void>
  createTerminal(request: TerminalCreateRequest): Promise<TerminalCreated>
  writeTerminal(id: string, data: string): void
  resizeTerminal(id: string, cols: number, rows: number): void
  closeTerminal(id: string): void
  onTerminalData(listener: (frame: { id: string; data: string }) => void): () => void
  onTerminalExit(listener: (frame: { id: string; code: number | null }) => void): () => void
  openWorkspace(root: string): Promise<void>
  openExternal(url: string): Promise<void>
  closeWindow(): Promise<void>
}
