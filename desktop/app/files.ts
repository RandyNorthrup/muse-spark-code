// Muse Desktop (M111, D91.12) lane WB: workspace files for the workbench.
// Every path the renderer names is confined to the workspace root before it
// is touched. A path outside it, including one that leaves through a symlink
// or a Windows junction, is refused by name.

import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { confineToRoot } from '../../src/core/fs/confine'
import { DESKTOP_FILE_SCAN_IGNORED } from '../../src/shared/constants'
import type { FileEntry } from '../../src/shared/desktop/bridge'

export class DesktopFileError extends Error {
  public readonly kind: 'outside-workspace' | 'not-text'
  public constructor(kind: 'outside-workspace' | 'not-text', message: string) {
    super(message)
    this.kind = kind
  }
}

async function confinedPath(root: string, relative: string): Promise<string> {
  const confined = await confineToRoot(root, relative.replaceAll('\\', '/'))
  if (confined === undefined) {
    throw new DesktopFileError('outside-workspace', `Refused: ${relative} is outside the workspace`)
  }
  return confined
}

async function collectFiles(root: string, folder: string, entries: FileEntry[]): Promise<void> {
  const absolute = folder === '' ? root : path.join(root, folder)
  const children = await readdir(absolute, { withFileTypes: true })
  for (const child of children) {
    // A junction reports itself as a directory as well as a link. Skip the
    // link first so a name that points outside the workspace is not listed.
    if (
      (DESKTOP_FILE_SCAN_IGNORED as readonly string[]).includes(child.name) ||
      child.isSymbolicLink()
    )
      continue
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
  const absolute = await confinedPath(root, relative)
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
  const absolute = await confinedPath(root, relative)
  await writeFile(absolute, text, 'utf8')
}
