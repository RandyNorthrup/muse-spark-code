// Tool I/O stand-ins for the Model API backend tests: an in-memory file
// system with a recording shell, and a do-nothing one for tests that never
// touch a tool.

import type { SearchHit, ShellResult, ToolIo } from '../../../src/core/backends/modelapi/tools'

export interface MemoryToolIo extends ToolIo {
  readonly files: Map<string, string>
  /** Files created as bytes (M34's images), by the same keys. */
  readonly binaries: Map<string, Uint8Array>
  readonly shellCalls: { command: string; cwd: string; timeoutMs: number }[]
  /** Absolute paths an "editor" holds unsaved changes to (D27). */
  readonly unsaved: Set<string>
}

/**
 * Files keyed by `${root}/${name}`; paths are compared with forward slashes.
 * `links` maps a workspace-relative directory to the absolute directory it
 * really is (a symbolic link or junction), which `realPath` resolves.
 */
/** The map key of a path: forward slashes, as the memory files are keyed. */
function keyOf(absolutePath: string): string {
  return absolutePath.replaceAll('\\', '/')
}

export function memoryToolIo(
  initial: Record<string, string>,
  root: string,
  shell: (command: string) => ShellResult = (command) => ({
    stdout: `ran ${command}`,
    stderr: '',
    exitCode: 0,
    isTimedOut: false,
    isCancelled: false,
  }),
  links: Record<string, string> = {},
): MemoryToolIo {
  const files = new Map(Object.entries(initial).map(([name, text]) => [`${root}/${name}`, text]))
  const shellCalls: MemoryToolIo['shellCalls'] = []
  const unsaved = new Set<string>()
  const binaries = new Map<string, Uint8Array>()
  const isTaken = (key: string) =>
    files.has(key) ||
    binaries.has(key) ||
    [...files.keys(), ...binaries.keys()].some((name) => name.startsWith(`${key}/`))
  return {
    files,
    binaries,
    pathExists: (absolutePath) => Promise.resolve(isTaken(keyOf(absolutePath))),
    reserveFile: (absolutePath) => {
      const key = keyOf(absolutePath)
      if (isTaken(key)) {
        return Promise.reject(new Error(`EEXIST: file already exists, open '${absolutePath}'`))
      }
      binaries.set(key, new Uint8Array())
      return Promise.resolve({
        fill: (bytes) => {
          binaries.set(key, bytes)
          return Promise.resolve()
        },
        release: () => {
          binaries.delete(key)
          return Promise.resolve()
        },
      })
    },
    shellCalls,
    unsaved,
    hasUnsavedChanges: (absolutePath) => unsaved.has(absolutePath.replaceAll('\\', '/')),
    realPath: (absolutePath) => {
      const forward = absolutePath.replaceAll('\\', '/')
      for (const [relative, target] of Object.entries(links)) {
        const link = `${root}/${relative}`
        if (forward === link || forward.startsWith(`${link}/`)) {
          return Promise.resolve(`${target}${forward.slice(link.length)}`)
        }
      }
      return Promise.resolve(forward)
    },
    readFile: (absolutePath) => Promise.resolve(files.get(absolutePath.replaceAll('\\', '/'))),
    writeFile: (absolutePath, content) => {
      files.set(absolutePath.replaceAll('\\', '/'), content)
      return Promise.resolve()
    },
    listFiles: () =>
      Promise.resolve(Array.from(files.keys(), (absolute) => absolute.slice(root.length + 1))),
    // A literal-substring matcher stands in for the worker; `(` is the one
    // pattern it calls invalid, as the real one would.
    searchFiles: (job) => {
      if (job.pattern === '(') {
        return Promise.resolve({ ok: false, reason: 'invalid pattern: Unterminated group' })
      }
      const hits: SearchHit[] = []
      for (const file of job.files) {
        const text = files.get(file.absolute.replaceAll('\\', '/'))
        if (text === undefined || text.includes('\0')) {
          continue
        }
        for (const [index, line] of text.split('\n').entries()) {
          if (line.includes(job.pattern)) {
            hits.push({ file: file.relative, line: index + 1, text: line })
          }
        }
      }
      return Promise.resolve({ ok: true, hits })
    },
    runShell: (command, cwd, timeoutMs) => {
      shellCalls.push({ command, cwd, timeoutMs })
      return Promise.resolve(shell(command))
    },
  }
}

export const noopToolIo: ToolIo = {
  realPath: (absolutePath) => Promise.resolve(absolutePath),
  readFile: () => Promise.resolve(undefined),
  writeFile: () => Promise.resolve(),
  pathExists: () => Promise.resolve(false),
  reserveFile: () =>
    Promise.resolve({ fill: () => Promise.resolve(), release: () => Promise.resolve() }),
  hasUnsavedChanges: () => false,
  listFiles: () => Promise.resolve([]),
  searchFiles: () => Promise.resolve({ ok: true, hits: [] }),
  runShell: () =>
    Promise.resolve({ stdout: '', stderr: '', exitCode: 0, isTimedOut: false, isCancelled: false }),
}
