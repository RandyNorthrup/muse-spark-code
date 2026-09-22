// Tool I/O stand-ins for the Model API backend tests: an in-memory file
// system with a recording shell, and a do-nothing one for tests that never
// touch a tool.

import type { SearchHit, ShellResult, ToolIo } from '../../../src/core/backends/modelapi/tools'

export interface MemoryToolIo extends ToolIo {
  readonly files: Map<string, string>
  readonly shellCalls: { command: string; cwd: string; timeoutMs: number }[]
}

/** Files keyed by `${root}/${name}`; paths are compared with forward slashes. */
export function memoryToolIo(
  initial: Record<string, string>,
  root: string,
  shell: (command: string) => ShellResult = (command) => ({
    stdout: `ran ${command}`,
    stderr: '',
    exitCode: 0,
    isTimedOut: false,
  }),
): MemoryToolIo {
  const files = new Map(Object.entries(initial).map(([name, text]) => [`${root}/${name}`, text]))
  const shellCalls: MemoryToolIo['shellCalls'] = []
  return {
    files,
    shellCalls,
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
  readFile: () => Promise.resolve(undefined),
  writeFile: () => Promise.resolve(),
  listFiles: () => Promise.resolve([]),
  searchFiles: () => Promise.resolve({ ok: true, hits: [] }),
  runShell: () => Promise.resolve({ stdout: '', stderr: '', exitCode: 0, isTimedOut: false }),
}
