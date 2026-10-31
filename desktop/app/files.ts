// Muse Desktop (M111, D91.12) lane WB: workspace files for the workbench.
// Every path the renderer names is confined to the workspace root before it
// is touched; a path outside it is refused by name.

import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DESKTOP_FILE_SCAN_IGNORED } from '../../src/shared/constants'
import type { FileEntry } from '../../src/shared/desktop/bridge'

export class DesktopFileError extends Error {
  public readonly kind: 'outside-workspace' | 'not-text'
  public constructor(kind: 'outside-workspace' | 'not-text', message: string) {
    super(message)
    this.kind = kind
  }
}

function confinedPath(root: string, relative: string): string {
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, relative.replaceAll('\\', '/'))
  const prefix = `${resolvedRoot}${path.sep}`
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) {
    throw new DesktopFileError('outside-workspace', `Refused: ${relative} is outside the workspace`)
  }
  return resolved
}

async function collectFiles(root: string, folder: string, entries: FileEntry[]): Promise<void> {
  const absolute = folder === '' ? root : path.join(root, folder)
  const children = await readdir(absolute, { withFileTypes: true })
  for (const child of children) {
    if ((DESKTOP_FILE_SCAN_IGNORED as readonly string[]).includes(child.name)) continue
    const relative = folder === '' ? child.name : `${folder}/${child.name}`
    if (child.isDirectory()) await collectFiles(root, relative, entries)
    else if (child.isFile()) entries.push({ path: relative, name: child.name })
  }
}

/**
A terminal's working directory, confined to the workspace root like
every path the renderer names. Absolute or root-relative; anything
outside is refused by name.
*/
export function confineTerminalCwd(root: string, cwd: string): string {
  return confinedPath(root, cwd)
}

export async function listWorkspaceFiles(root: string): Promise<FileEntry[]> {
  const entries: FileEntry[] = []
  await collectFiles(root, '', entries)
  return entries.toSorted((a, b) => a.path.localeCompare(b.path))
}

export async function readWorkspaceFile(
  root: string,
  relative: string,
): Promise<{ path: string; text: string }> {
  const absolute = confinedPath(root, relative)
  const bytes = await readFile(absolute)
  if (bytes.includes(0)) {
    throw new DesktopFileError('not-text', `Refused: ${relative} is not a text file`)
  }
  return { path: relative.replaceAll('\\', '/'), text: bytes.toString('utf8') }
}

export async function writeWorkspaceFile(
  root: string,
  relative: string,
  text: string,
): Promise<void> {
  const absolute = confinedPath(root, relative)
  await writeFile(absolute, text, 'utf8')
}
