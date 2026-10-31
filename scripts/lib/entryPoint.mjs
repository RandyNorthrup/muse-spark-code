// The one "am I the entry point" check for every script. A tooling script runs
// its main only when Node was started on it, and stays quiet when a test or
// another script imports it. Node names the module it started by its real path,
// so a start path that goes through a symlink or a Windows junction differs from
// `import.meta.url` as typed; a script that compares the two literally then ends
// without a word and a zero exit, a gate that passes by not running. Both sides
// are resolved through their links here, and without case on Windows.
import { realpathSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// A start argument that names nothing (`node -e ... word`) is not a script.
const NOTHING_THERE = new Set(['ENOENT', 'ENOTDIR'])

/** The real path of `file`, or undefined when nothing is there; any other failure is thrown. */
function realPath(file) {
  try {
    return realpathSync(file)
  } catch (error) {
    if (error instanceof Error && NOTHING_THERE.has(error.code)) return
    throw error
  }
}

/**
True when the module whose `import.meta.url` is `moduleUrl` is the script Node
was started on (`script`, the process's own start argument by default).
*/
export function isEntryPoint(moduleUrl, script = process.argv[1]) {
  if (script === undefined) return false
  const started = realPath(script)
  if (started === undefined) return false
  const own = realpathSync(fileURLToPath(moduleUrl))
  return process.platform === 'win32'
    ? started.toLowerCase() === own.toLowerCase()
    : started === own
}
