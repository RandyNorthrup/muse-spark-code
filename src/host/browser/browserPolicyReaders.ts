// The reads behind the browser check's managed-policy refusal (M81, PLAN.md
// D49; browserManagedPolicy.ts), in the browser's bundle: folders and files
// with Node's fs, macOS property lists with plutil and Windows policy keys
// with reg.exe, each by its absolute path through `runProgram` (execFile, an
// argument array, never a shell string). A location that does not exist is
// told apart from one that cannot be read.

import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { userInfo } from 'node:os'
import path from 'node:path'
import type { ManagedPolicyReaders } from '../../core/browser/browserManagedPolicy'
import {
  BROWSER_POLICY_FILE_MAX_BYTES,
  MACOS_PLUTIL_PATH,
  WINDOWS_REG_RELATIVE_PATH,
} from '../../shared/constants'
import { type RunProgram, runProgram } from '../processTree'

export interface PolicyReaderDeps {
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  /** `%SystemRoot%`; undefined off Windows. */
  readonly systemRoot: string | undefined
  /** `runProgram` unless a test stands in plutil or reg.exe. */
  readonly run?: RunProgram
}

// A path that does not exist, or one whose parent is a file: nothing is there.
const MISSING_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR'])

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && MISSING_CODES.has(String(error.code))
}

/** The names of a folder's files (and links), not its folders; undefined when it does not exist. */
async function listFiles(folder: string): Promise<readonly string[] | undefined> {
  let entries: Dirent[]
  try {
    entries = await readdir(folder, { withFileTypes: true })
  } catch (error: unknown) {
    if (isMissing(error)) {
      return undefined
    }
    throw error
  }
  return entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name)
}

async function isPresent(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch (error: unknown) {
    if (isMissing(error)) {
      return false
    }
    throw error
  }
}

async function readText(file: string): Promise<string | undefined> {
  let size: number
  try {
    const info = await stat(file)
    size = info.size
  } catch (error: unknown) {
    if (isMissing(error)) {
      return undefined
    }
    throw error
  }
  if (size > BROWSER_POLICY_FILE_MAX_BYTES) {
    throw new Error(`larger than ${String(BROWSER_POLICY_FILE_MAX_BYTES)} bytes`)
  }
  return await readFile(file, 'utf8')
}

/** The reads over this machine's folders, plutil and reg.exe. */
export function hostPolicyReaders(deps: PolicyReaderDeps): ManagedPolicyReaders {
  const run = deps.run ?? runProgram
  return {
    platform: deps.platform,
    userName: () => userInfo().username,
    listFiles,
    readText,
    isPresent,
    plistXml: async (file) =>
      await run(MACOS_PLUTIL_PATH, ['-convert', 'xml1', '-o', '-', file], deps.env),
    queryRegistry: async (key, view) => {
      if (deps.systemRoot === undefined) {
        throw new Error('SystemRoot is not set, so reg.exe cannot be found')
      }
      return await run(
        path.win32.join(deps.systemRoot, WINDOWS_REG_RELATIVE_PATH),
        ['query', key, view],
        deps.env,
      )
    },
  }
}
