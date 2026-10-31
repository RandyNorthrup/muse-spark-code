// A shipped native helper that is not there, or that the system will not
// start, said at the place that starts it (RLF-SMALLFIX1). The macOS signed
// .app (a gitignored output of native/darwin/build.sh, absent from a source
// checkout until built) and the Linux helpers are started by absolute path; a
// start that fails for the helper itself used to surface as the failure's bare
// name ("Error") or as "That did not work". The sentence says what is missing
// and what to do: reinstall for a packaged product, the build command for a
// source checkout.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { NATIVE_HELPER_BUILD, UI_TEXT, darwinDictationHelperSegments } from '../shared/constants'
import { fill } from '../shared/l10n/text'
import { NativeHelperError, type NativeHelperFault } from '../shared/nativeHelperError'
import { isFilledSentence } from './filledSentence'

/** The deepest cause chain read for a failed start: wrappers are shallow. */
const CAUSE_DEPTH = 16

/** The name a person knows the helper by: its signed app on macOS, else its file. */
function helperName(file: string): string {
  const parts = file.split(/[\\/]/u)
  return parts.findLast((part) => part.endsWith('.app')) ?? path.basename(file)
}

/** The product's folder (the one holding `native/`) for a helper's file, if it sits in one. */
function productRoot(file: string): string | undefined {
  const parts = file.split(/[\\/]/u)
  const native = parts.lastIndexOf('native')
  if (native <= 0) return undefined
  const above = parts.slice(0, native)
  if (above.at(-1) === 'dist') above.pop()
  return above.join('/')
}

/**
The sentence for a helper that cannot be used. A folder that still holds the
platform's build script is a source checkout (the packaged product ships none),
so it names the command that builds the helper; any other folder is an
installed product, and the answer is to reinstall.
*/
export function nativeHelperError(
  fault: NativeHelperFault,
  file: string,
  platform: NodeJS.Platform = process.platform,
  cause?: unknown,
): NativeHelperError {
  const build = NATIVE_HELPER_BUILD[platform]
  const root = productRoot(file)
  const isSource =
    build !== undefined && root !== undefined && existsSync(`${root}/${build.script}`)
  const text = UI_TEXT.nativeHelper
  const [source, installed] =
    fault === 'missing'
      ? [text.missingSource, text.missingInstalled]
      : [text.unloadableSource, text.unloadableInstalled]
  const template = isSource ? source : installed
  return new NativeHelperError(
    fault,
    fill(template, { helper: helperName(file), command: build?.command ?? '' }),
    cause === undefined ? undefined : { cause },
  )
}

/**
Whether the failed start is the start of `file` itself. Node's spawn failures
carry `spawn <program>` as `syscall` and the program as `path` (not found, not
executable); an errno Node does not name (a binary built for another processor
is -86 on macOS) is thrown at once with the bare `spawn` and no path. Either is
the one program `start` launches. A helper that started and then exited
non-zero is its own refusal, not a fault of the file.
*/
export function isNativeStartFailure(error: unknown, file: string): boolean {
  let current: unknown = error
  for (let depth = 0; depth < CAUSE_DEPTH && current instanceof Error; depth++) {
    if (
      'syscall' in current &&
      typeof current.syscall === 'string' &&
      current.syscall.startsWith('spawn') &&
      (!('path' in current) || current.path === file)
    )
      return true
    current = current.cause
  }
  return false
}

/**
Starts the helper at `file` through `start`. A file that is not there is
refused before any start; a start that fails for the file itself (not found,
not executable, not a program this computer can run) becomes the helper's
sentence; every other failure, including the helper's own non-zero exit, is
the caller's, untouched.
*/
export async function runNativeHelper<T>(
  file: string,
  start: () => Promise<T>,
  platform: NodeJS.Platform = process.platform,
): Promise<T> {
  if (!existsSync(file)) throw nativeHelperError('missing', file, platform)
  try {
    return await start()
  } catch (error: unknown) {
    if (!isNativeStartFailure(error, file)) throw error
    throw nativeHelperError(existsSync(file) ? 'unloadable' : 'missing', file, platform, error)
  }
}

/**
Whether `message` is exactly one of the helper sentences with its slots
filled by plain names (letters, digits, `. / : _ -` and spaces, at most 64).
A boundary that lets only fixed sentences leave uses this: the slots can hold
a file name or a command, never a prompt, a path with an account or a key.
*/
export function isNativeHelperSentence(message: string): boolean {
  return isFilledSentence(message, Object.values(UI_TEXT.nativeHelper))
}

/**
The native helper that creates and removes paths on POSIX: the macOS signed
app's executable (its `--created-directory` mode) or the Linux `muse-created`,
under the product's `native` folder. Undefined where the platform ships none
(Windows compiles its job helper instead).
*/
export function createdHelperFile(
  nativeRoot: string,
  platform: NodeJS.Platform,
  arch: string,
): string | undefined {
  if (arch !== 'x64' && arch !== 'arm64') return undefined
  switch (platform) {
    case 'darwin': {
      return path.join(nativeRoot, ...darwinDictationHelperSegments(arch))
    }
    case 'linux': {
      return path.join(nativeRoot, 'linux', arch, 'muse-created')
    }
    default: {
      return undefined
    }
  }
}
