// Muse Desktop (M111, D91.12) lane WB: layout persistence. One JSON record
// in the app's user-data folder, keyed per workspace and per compositor
// workspace. A record that no longer parses is dropped and said so on
// stderr; the renderer then shows that the default layout is in use.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DESKTOP_LAYOUT_FILE, DESKTOP_STATUS_HASH_CHARS } from '../../src/shared/constants'
import type { DesktopStatusItem, LayoutKey, WorkbenchLayout } from '../../src/shared/desktop/bridge'
import { isStoredLayout, layoutStorageKey } from '../../src/shared/desktop/workbench'

export class LayoutStore {
  private layouts = new Map<string, WorkbenchLayout>()
  private loaded = false

  public constructor(private readonly userDataDir: string) {}

  private get filePath(): string {
    return path.join(this.userDataDir, DESKTOP_LAYOUT_FILE)
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
      throw error
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      process.stderr.write('muse-desktop: layout record is not an object; starting empty\n')
      return
    }
    for (const [name, value] of Object.entries(parsed)) {
      if (isStoredLayout(value)) this.layouts.set(name, value)
      else process.stderr.write(`muse-desktop: dropped unreadable layout for ${name}\n`)
    }
  }

  public async get(key: LayoutKey): Promise<WorkbenchLayout | null> {
    await this.load()
    return this.layouts.get(layoutStorageKey(key, process.platform)) ?? null
  }

  public async set(key: LayoutKey, layout: WorkbenchLayout): Promise<void> {
    await this.load()
    this.layouts.set(layoutStorageKey(key, process.platform), layout)
    const record = Object.fromEntries(this.layouts)
    const tempPath = `${this.filePath}.next`
    await mkdir(this.userDataDir, { recursive: true })
    await writeFile(tempPath, `${JSON.stringify(record)}\n`, 'utf8')
    await rename(tempPath, this.filePath)
  }
}

// The status snapshot SH1's bar reads (D91.13, D91.30): the workbench
// publishes over the bridge, the main process orders and writes one file
// per workspace in the runtime folder, replaced atomically.
export async function writeStatusSnapshot(
  userDataDir: string,
  workspaceRoot: string,
  items: readonly DesktopStatusItem[],
): Promise<string> {
  const { createHash } = await import('node:crypto')
  const { orderStatusItems } = await import('../../src/shared/desktop/workbench')
  const hash = createHash('sha256')
    .update(workspaceRoot)
    .digest('hex')
    .slice(0, DESKTOP_STATUS_HASH_CHARS)
  const dir = path.join(userDataDir, 'status')
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `${hash}.json`)
  const tempPath = `${filePath}.next`
  await writeFile(
    tempPath,
    `${JSON.stringify({ workspaceRoot, items: orderStatusItems(items) })}\n`,
    'utf8',
  )
  await rename(tempPath, filePath)
  return filePath
}
