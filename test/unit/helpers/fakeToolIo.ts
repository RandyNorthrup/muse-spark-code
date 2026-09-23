// Tool I/O stand-ins for the Model API backend tests: an in-memory file
// system with a recording shell, and a do-nothing one for tests that never
// touch a tool.

import type { SearchHit, ShellResult, ToolIo } from '../../../src/core/backends/modelapi/tools'

export interface MemoryToolIo extends ToolIo {
  readonly files: Map<string, string>
  readonly shellCalls: { command: string; cwd: string; timeoutMs: number }[]
}

/**
 * Files keyed by `${root}/${name}`; paths are compared with forward slashes.
 * `links` maps a workspace-relative directory to the absolute directory it
 * really is (a symbolic link or junction), which `realPath` resolves.
 */
export function memoryToolIo(
  initial: Record<string, string>,
  root: string,
  shell: (command: string) => ShellResult = (command) => ({
    stdout: `ran ${command}`,
    stderr: '',
    exitCode: 0,
    isTimedOut: false,
  }),
  links: Record<string, string> = {},
): MemoryToolIo {
  const files = new Map(Object.entries(initial).map(([name, text]) => [`${root}/${name}`, text]))
  const shellCalls: MemoryToolIo['shellCalls'] = []
  return {
    files,
    shellCalls,
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
    // The subdirectories of a directory, derived from the file keys beneath it.
    listDirectory: (absolutePath) => {
      const prefix = `${absolutePath.replaceAll('\\', '/')}/`
      const names = new Set<string>()
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) {
          continue
        }
        const rest = key.slice(prefix.length).split('/')
        if (rest.length > 1 && rest[0] !== undefined) {
          names.add(rest[0])
        }
      }
      return Promise.resolve([...names])
    },
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
  listFiles: () => Promise.resolve([]),
  listDirectory: () => Promise.resolve([]),
  searchFiles: () => Promise.resolve({ ok: true, hits: [] }),
  runShell: () => Promise.resolve({ stdout: '', stderr: '', exitCode: 0, isTimedOut: false }),
}

/** The `{ io, workspaceRoot, platform }` the context loaders take, over an in-memory tree. */
export function loaderDeps(
  files: Record<string, string>,
  root: string,
  platform: NodeJS.Platform = 'linux',
) {
  return { io: memoryToolIo(files, root), workspaceRoot: root, platform }
}
