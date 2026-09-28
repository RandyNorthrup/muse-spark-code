// Installs the fake Muse Code CLI (fake-muse/serve.mjs) the way the launch
// resolver expects to find a configured binary: on POSIX a `muse` script with
// a Node shebang, on Windows a real executable (fake-muse/stub.cs compiled by
// the C# compiler that ships with the .NET Framework), each beside a copy of
// serve.mjs. Also fakes the CLI's credential file through XDG_CONFIG_HOME,
// which the extension honours on every platform (launch.ts).

import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { MUSE_CREDENTIAL_FILE_SEGMENTS } from '../../src/shared/constants'
import { DEVICE_LOGIN_FILE } from '../unit/helpers/credentialShapes'

const here = path.dirname(fileURLToPath(import.meta.url))
const SERVE_SOURCE = path.join(here, 'fake-muse', 'serve.mjs')
const STUB_SOURCE = path.join(here, 'fake-muse', 'stub.cs')
const STUB_EXE = 'muse-bin-0.0.0-fake.exe'
const CSC_RELATIVE_PATH = String.raw`Microsoft.NET\Framework64\v4.0.30319\csc.exe`
const EXECUTABLE_MODE = 0o755
// On Windows the fake CLI's executable can still be held for a moment after
// its process has exited (seen in CI and under a full local run, every test
// green), and removing its folder then fails with EPERM. Node retries the
// removal; if the folder still cannot go, the suite says so and leaves it
// to the OS temp cleanup rather than fail on housekeeping.
const RM_RETRIES = 5
const RM_RETRY_DELAY_MS = 200

/** A suite's teardown: its temporary folders, removed or named. */
export function removeTestFolders(dirs: readonly string[]): void {
  for (const dir of dirs) {
    try {
      rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: RM_RETRIES,
        retryDelay: RM_RETRY_DELAY_MS,
      })
    } catch (error: unknown) {
      process.stderr.write(`e2e teardown left ${dir} behind: ${String(error)}\n`)
    }
  }
}

export interface FakeMuseInstall {
  /** What `museSpark.museBinaryPath` should point at. */
  readonly binaryPath: string
  readonly installDir: string
}

/** The stub compiled once per test run (csc takes about a second), by platform. */
const compiledStubs = new Map<NodeJS.Platform, string>()

function compileWindowsStub(installDir: string): string {
  const systemRoot = process.env['SystemRoot']
  if (systemRoot === undefined) {
    throw new Error('SystemRoot is not set; cannot find the C# compiler')
  }
  const csc = path.join(systemRoot, CSC_RELATIVE_PATH)
  if (!existsSync(csc)) {
    throw new Error(`the .NET Framework C# compiler is missing at ${csc}`)
  }
  const exe = path.join(installDir, STUB_EXE)
  execFileSync(
    csc,
    ['/nologo', '/warnaserror+', '/optimize+', '/target:exe', `/out:${exe}`, STUB_SOURCE],
    { stdio: 'pipe' },
  )
  return exe
}

export function installFakeMuse(): FakeMuseInstall {
  const installDir = mkdtempSync(path.join(tmpdir(), 'fake-muse-'))
  copyFileSync(SERVE_SOURCE, path.join(installDir, 'serve.mjs'))
  if (process.platform === 'win32') {
    const stub = compiledStubs.get('win32') ?? compileWindowsStub(installDir)
    compiledStubs.set('win32', stub)
    const exe = path.join(installDir, STUB_EXE)
    if (stub !== exe) {
      copyFileSync(stub, exe)
    }
    return { binaryPath: exe, installDir }
  }
  const script = path.join(installDir, 'muse')
  const serve = pathToFileURL(path.join(installDir, 'serve.mjs')).href
  writeFileSync(script, `#!/usr/bin/env node\nimport(${JSON.stringify(serve)})\n`)
  chmodSync(script, EXECUTABLE_MODE)
  return { binaryPath: script, installDir }
}

/**
 * A config home holding the CLI's credential file: a browser sign-in's
 * structure as the granted capture left it, placeholders for every secret
 * or personal value; or `contents` as given.
 */
export function installFakeCredential(contents = DEVICE_LOGIN_FILE): string {
  const configHome = mkdtempSync(path.join(tmpdir(), 'fake-muse-config-'))
  writeFakeCredential(configHome, contents)
  return configHome
}

/** Where the extension and the fake CLI look for it under `configHome`. */
export function fakeCredentialFile(configHome: string): string {
  return path.join(configHome, ...MUSE_CREDENTIAL_FILE_SEGMENTS)
}

export function writeFakeCredential(configHome: string, contents: string): void {
  const file = fakeCredentialFile(configHome)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, contents)
}
