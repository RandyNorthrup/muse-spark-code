// Muse Code's memory over an in-memory tree (M49): the store's reads, writes
// and folder listings, over a file map keyed by absolute path with forward
// slashes (the map the Model API tool fakes share), with `links` from an
// absolute path to the folder it leads to, reported by a listing as neither
// a file nor a folder and followed by reads and `realPath` as the operating
// system would.

import path from 'node:path'
import {
  type MemoryDirectoryEntry,
  type MemoryIo,
  MemoryStore,
} from '../../../src/core/memory/memoryStore'

export interface MemoryIoOptions {
  readonly links?: Readonly<Record<string, string>>
  /** Paths whose read rejects (a file that is not UTF-8 text). */
  readonly unreadable?: ReadonlySet<string>
  /** Paths whose write rejects (a read-only file). */
  readonly unwritable?: ReadonlySet<string>
  /** `realPath` answers with this platform's separators. */
  readonly platform?: NodeJS.Platform
  /** A competing writer placed a file after the store's first read. */
  readonly beforeCreate?: (path: string, files: Map<string, string>) => void
}

function forward(absolutePath: string): string {
  return absolutePath.replaceAll('\\', '/')
}

export function memoryIoOver(files: Map<string, string>, options: MemoryIoOptions = {}): MemoryIo {
  const links = options.links ?? {}
  const through = (absolutePath: string): string => {
    const key = forward(absolutePath)
    for (const [link, target] of Object.entries(links)) {
      if (key === link || key.startsWith(`${link}/`)) {
        return `${target}${key.slice(link.length)}`
      }
    }
    return key
  }
  const native = (key: string) => (options.platform === 'win32' ? path.win32.normalize(key) : key)
  return {
    readFile: (absolutePath) => {
      const key = through(absolutePath)
      return options.unreadable?.has(key) === true
        ? Promise.reject(new Error(`${key} is not UTF-8 text`))
        : Promise.resolve(files.get(key))
    },
    writeFile: (absolutePath, content) => {
      const key = through(absolutePath)
      if (options.unwritable?.has(key) === true) {
        return Promise.reject(new Error(`EACCES: permission denied, open '${key}'`))
      }
      files.set(key, content)
      return Promise.resolve()
    },
    createFile: (absolutePath, content) => {
      const key = through(absolutePath)
      options.beforeCreate?.(key, files)
      if (files.has(key)) {
        return Promise.reject(
          Object.assign(new Error(`EEXIST: file already exists, open '${key}'`), {
            code: 'EEXIST',
          }),
        )
      }
      if (options.unwritable?.has(key) === true) {
        return Promise.reject(new Error(`EACCES: permission denied, open '${key}'`))
      }
      files.set(key, content)
      return Promise.resolve()
    },
    realPath: (absolutePath) => Promise.resolve(native(through(absolutePath))),
    listEntries: (absolutePath) => {
      const directory = forward(absolutePath)
      const prefix = `${through(directory)}/`
      const entries = new Map<string, MemoryDirectoryEntry['kind']>()
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) {
          continue
        }
        const [name, ...rest] = key.slice(prefix.length).split('/')
        if (name !== undefined) {
          entries.set(name, rest.length > 0 ? 'directory' : 'file')
        }
      }
      for (const link of Object.keys(links)) {
        if (link.slice(0, link.lastIndexOf('/')) === directory) {
          entries.set(link.slice(link.lastIndexOf('/') + 1), 'other')
        }
      }
      return Promise.resolve([...entries].map(([name, kind]) => ({ name, kind })))
    },
  }
}

export const HOME_DATA = '/home/u/.local/share/muse/memory'
export const PERSONAL = `${HOME_DATA}/personal`

export interface StoreOptions extends MemoryIoOptions {
  readonly workspaceRoot?: string | undefined
  readonly dataRoot?: string | undefined
}

/**
 * A store over `files` for the workspace `/ws` (Linux) and the data root
 * under `/home/u` unless a test says otherwise; its warnings are collected.
 */
export function memoryStoreOver(files: Map<string, string>, options: StoreOptions = {}) {
  const warnings: string[] = []
  const store = new MemoryStore({
    io: memoryIoOver(files, options),
    platform: options.platform ?? 'linux',
    dataRoot: () => ('dataRoot' in options ? options.dataRoot : HOME_DATA),
    workspaceRoot: 'workspaceRoot' in options ? options.workspaceRoot : '/ws',
    systemPath: (absolutePath) => Promise.resolve(absolutePath),
    warn: (message) => {
      warnings.push(message)
    },
  })
  return { store, warnings }
}
