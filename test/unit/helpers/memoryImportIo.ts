// The import's file access (M83) over an in-memory tree, for the scan, the
// plan and the apply: files as text keyed by absolute POSIX path, folders
// inferred from the files beneath them, links from a path to the folder or
// file it leads to (reads, listings and `realPath` go through them as the
// operating system would), and paths that fail with a code. Writes land in
// the same tree, so a test reads back what the import wrote.

import type {
  ImportDirEntry,
  ImportIo,
  ImportProjectRoot,
  ImportRead,
  ImportWriter,
} from '../../../src/core/import/agentImport'
import { AGENT_IMPORT_ROOT_CHANGED_CODE } from '../../../src/shared/constants'

export interface MemoryImportTree {
  readonly files?: Record<string, string>
  /** A link's path and where it leads. */
  readonly links?: Record<string, string>
  /** Paths whose read or listing fails with this code. */
  readonly failing?: Record<string, string>
}

export interface MemoryImportIo extends ImportIo, ImportWriter {
  readonly files: Map<string, string>
  /** A link's path and where it leads; a test may plant one later. */
  readonly links: Map<string, string>
  readonly reads: string[]
  readonly isPresent: (absolutePath: string) => Promise<boolean>
  /** The paths of the files held at or beneath a folder. */
  readonly pathsUnder: (folder: string) => readonly string[]
}

function coded(code: string): Error {
  return Object.assign(new Error(`${code}: failed`), { code })
}

export function memoryImportIo(tree: MemoryImportTree = {}): MemoryImportIo {
  const files = new Map(Object.entries(tree.files ?? {}))
  const links = new Map(Object.entries(tree.links ?? {}))
  const failing = tree.failing ?? {}
  const reads: string[] = []
  const resolve = (absolutePath: string): string => {
    for (const [at, target] of links) {
      if (absolutePath === at || absolutePath.startsWith(`${at}/`)) {
        return `${target}${absolutePath.slice(at.length)}`
      }
    }
    return absolutePath
  }
  const isDirectory = (absolutePath: string): boolean => {
    const prefix = `${resolve(absolutePath)}/`
    for (const key of files.keys()) {
      if (key.startsWith(prefix)) {
        return true
      }
    }
    return false
  }
  const failure = (absolutePath: string): void => {
    const code = failing[absolutePath]
    if (code !== undefined) {
      throw coded(code)
    }
  }
  /** As the real writer does: the root must still lead where the plan saw it lead. */
  const assertRoot = (project: ImportProjectRoot | undefined): void => {
    if (project !== undefined && resolve(project.path) !== project.identity.canonical) {
      throw coded(AGENT_IMPORT_ROOT_CHANGED_CODE)
    }
  }
  return {
    files,
    links,
    reads,
    pathsUnder(folder) {
      const held: string[] = []
      for (const path of files.keys()) {
        if (path === folder || path.startsWith(`${folder}/`)) {
          held.push(path)
        }
      }
      return held
    },
    identifyRoot(absolutePath) {
      return Promise.resolve({ canonical: resolve(absolutePath), fileId: '' })
    },
    assertSafePath(absolutePath, project) {
      assertRoot(project)
      for (const at of links.keys()) {
        if (
          at.startsWith(`${project.path}/`) &&
          (absolutePath === at || absolutePath.startsWith(`${at}/`))
        ) {
          return Promise.reject(coded('ELOOP'))
        }
      }
      return Promise.resolve()
    },
    readFile(absolutePath, maxBytes): Promise<ImportRead> {
      failure(absolutePath)
      const real = resolve(absolutePath)
      const text = files.get(real)
      if (text === undefined) {
        return Promise.resolve({ status: isDirectory(real) ? 'notFile' : 'missing' })
      }
      const bytes = Buffer.from(text, 'utf8')
      if (bytes.length > maxBytes) {
        return Promise.resolve({ status: 'tooLarge' })
      }
      reads.push(absolutePath)
      return Promise.resolve({ status: 'read', bytes })
    },
    listDirectory(absolutePath) {
      failure(absolutePath)
      const real = resolve(absolutePath)
      if (!isDirectory(real)) {
        return Promise.resolve(undefined)
      }
      const names = new Map<string, boolean>()
      for (const key of files.keys()) {
        if (!key.startsWith(`${real}/`)) {
          continue
        }
        const [name = '', ...rest] = key.slice(real.length + 1).split('/')
        names.set(name, rest.length > 0 || names.get(name) === true)
      }
      for (const [at] of links) {
        const parent = at.slice(0, at.lastIndexOf('/'))
        if (resolve(parent) === real) {
          names.set(at.slice(parent.length + 1), isDirectory(at))
        }
      }
      return Promise.resolve(
        [...names].map(([name, isDir]): ImportDirEntry => ({ name, isDirectory: isDir })),
      )
    },
    realPath(absolutePath) {
      return Promise.resolve(resolve(absolutePath))
    },
    isPresent(absolutePath) {
      const real = resolve(absolutePath)
      return Promise.resolve(files.has(real) || isDirectory(real))
    },
    createFile(absolutePath, content, project, beforePublish) {
      failure(absolutePath)
      assertRoot(project)
      const real = resolve(absolutePath)
      if (files.has(real)) {
        return Promise.resolve('exists')
      }
      beforePublish?.()
      files.set(real, content)
      return Promise.resolve('created')
    },
    readText(absolutePath, project) {
      assertRoot(project)
      return Promise.resolve(files.get(resolve(absolutePath)))
    },
    appendText(absolutePath, content, options) {
      failure(absolutePath)
      assertRoot(options?.project)
      options?.beforePublish?.()
      const real = resolve(absolutePath)
      files.set(real, `${files.get(real) ?? ''}${content}`)
      return Promise.resolve()
    },
  }
}
