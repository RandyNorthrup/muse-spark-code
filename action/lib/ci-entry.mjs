// Ownership precedes even loading the proposal launcher: a failed module
// import, malformed facts or failed workspace resolution still cleans the
// bootstrap directory. The exit fallback is bounded and credential-free.
import { spawnSync } from 'node:child_process'
import { lstatSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import process from 'node:process'
import { readCiKey } from './ci-key.mjs'

function cleanup() {
  const candidate = process.env.MUSE_CI_TEMP
  const clone =
    process.env.CI_PROJECT_DIR ??
    process.env.BUILD_SOURCESDIRECTORY ??
    process.env.WORKSPACE ??
    process.env.BITBUCKET_CLONE_DIR
  if (candidate === undefined || clone === undefined || !path.isAbsolute(candidate)) return
  try {
    const stat = lstatSync(candidate)
    const real = realpathSync(candidate)
    const relative = path.relative(path.resolve(clone), real)
    const reverse = path.relative(real, path.resolve(clone))
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) ||
      (reverse !== '..' && !reverse.startsWith(`..${path.sep}`) && !path.isAbsolute(reverse))
    )
      return
    if (
      process.platform !== 'win32' &&
      ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
    )
      return
    spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import { rm } from 'node:fs/promises'; await rm(process.argv[1], { recursive: true, force: true })",
        real,
      ],
      {
        env: {},
        stdio: ['pipe', 'ignore', 'ignore'],
        timeout: 5000,
        killSignal: 'SIGKILL',
      },
    )
  } catch {
    /* Missing directory is already clean; invalid ownership is never deleted. */
  }
}

async function start(held) {
  try {
    const { main } = await import('./ci-run.mjs')
    await main(held)
  } catch {
    process.stderr.write('muse-spark: the launcher could not start\n')
    process.exitCode = 1
  } finally {
    held.key = undefined
  }
}

const script = process.argv[1]
if (script !== undefined && pathToFileURL(realpathSync(script)).href === import.meta.url) {
  process.once('exit', cleanup)
  const held = { key: readCiKey(process.env) }
  // start owns its rejection and finally; imports may fail after key intake.
  void start(held)
}
