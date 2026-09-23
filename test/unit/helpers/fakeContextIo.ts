// The workspace context loaders' file access over an in-memory tree: files
// as text (read back as UTF-8 bytes) or as raw bytes, and links from an
// absolute path to the absolute directory it leads to, which reads, listings
// and `realPath` go through as the operating system would.

import type { ContextIo } from '../../../src/core/context/contextFiles'

type FileContent = string | Uint8Array

function forward(absolutePath: string): string {
  return absolutePath.replaceAll('\\', '/')
}

/** `text` as the bytes an editor or a shell would write in each encoding. */
export const encoded = {
  utf8Bom: (text: string) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]),
  utf16le: (text: string) =>
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]),
  utf16be: (text: string) =>
    Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()]),
  /** UTF-16LE without its byte-order mark: every other byte of ASCII text is NUL. */
  utf16leWithoutBom: (text: string) => Buffer.from(text, 'utf16le'),
  /** Latin-1: an accented letter is one byte of 0x80 or more, which alone is not UTF-8. */
  latin1: (text: string) => Buffer.from(text, 'latin1'),
}

/** The names of the subdirectories of `directory`, derived from the file paths beneath it. */
export function subdirectoryNames(paths: Iterable<string>, directory: string): readonly string[] {
  const prefix = `${forward(directory)}/`
  const names = new Set<string>()
  for (const key of paths) {
    if (!key.startsWith(prefix)) {
      continue
    }
    const rest = key.slice(prefix.length).split('/')
    if (rest.length > 1 && rest[0] !== undefined) {
      names.add(rest[0])
    }
  }
  return [...names]
}

/**
 * Files keyed by absolute path with forward slashes; `links` maps an
 * absolute link path to the directory it leads to. A shared map sees later
 * changes, so a test can add or remove a file between loads.
 */
export function memoryContextIo(
  files: ReadonlyMap<string, FileContent>,
  links: Readonly<Record<string, string>> = {},
): ContextIo {
  const through = (absolutePath: string): string => {
    const path = forward(absolutePath)
    for (const [link, target] of Object.entries(links)) {
      if (path === link || path.startsWith(`${link}/`)) {
        return `${target}${path.slice(link.length)}`
      }
    }
    return path
  }
  return {
    readFile: (absolutePath) => {
      const content = files.get(through(absolutePath))
      return Promise.resolve(
        typeof content === 'string' ? new TextEncoder().encode(content) : content,
      )
    },
    listDirectory: (absolutePath) => {
      const directory = forward(absolutePath)
      const linked = Object.keys(links)
        .filter((link) => link.slice(0, link.lastIndexOf('/')) === directory)
        .map((link) => link.slice(link.lastIndexOf('/') + 1))
      return Promise.resolve([...subdirectoryNames(files.keys(), through(directory)), ...linked])
    },
    realPath: (absolutePath) => Promise.resolve(through(absolutePath)),
  }
}

/** Workspace-relative names keyed as absolute paths below `root`. */
export function memoryTree(
  files: Record<string, FileContent>,
  root: string,
): Map<string, FileContent> {
  return new Map(Object.entries(files).map(([name, content]) => [`${root}/${name}`, content]))
}

/**
 * The `{ io, workspaceRoot, platform }` the context loaders take, over
 * `memoryTree(files, root)`; the root is `/ws` and the platform Linux unless
 * a test says otherwise.
 */
export function loaderDeps(
  files: Record<string, FileContent>,
  { root = '/ws', platform = 'linux' }: { root?: string; platform?: NodeJS.Platform } = {},
) {
  return { io: memoryContextIo(memoryTree(files, root)), workspaceRoot: root, platform }
}
