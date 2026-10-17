// The workspace context loaders' file access over an in-memory tree: files
// as text (read back as UTF-8 bytes) or as raw bytes, and links from an
// absolute path to the absolute directory it leads to, which reads, listings
// and `realPath` go through as the operating system would.

import type { ContextIo } from '../../../src/core/context/contextFiles'

type FileContent = string | Uint8Array

function forward(absolutePath: string): string {
  return absolutePath.replaceAll('\\', '/')
}

/** The names of the subdirectories of `directory`, derived from the file paths beneath it. */
function subdirectoryNames(paths: Iterable<string>, directory: string): readonly string[] {
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
    readFile: (absolutePath, maxBytes) => {
      const content = files.get(through(absolutePath))
      const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
      // The contract of a capped read: one byte past the cap, never the whole file.
      return Promise.resolve(
        bytes === undefined || maxBytes === undefined ? bytes : bytes.subarray(0, maxBytes + 1),
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
