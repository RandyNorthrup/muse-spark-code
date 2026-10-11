import { execFile } from 'node:child_process'
import { chmod, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { RuntimeMakerServiceDeps } from '../../../src/runtime/maker/service'

/**
 * A canonical, short temp root for maker fixtures (FIXM103W10). macOS's
 * TMPDIR lies under the /var symlink, which maker storage refuses, and its
 * length leaves no room for a lease's Stop socket under the 104-byte cap;
 * /private/tmp is neither.
 */
export function makerTempRoot(): string {
  return process.platform === 'darwin' ? '/private/tmp' : tmpdir()
}

/** Runs a System32 tool by its full path: a PATH lookup can find Git's `whoami`. */
export function runWindowsTool(name: string, args: readonly string[]): Promise<string> {
  const systemRoot = process.env['SystemRoot']
  if (systemRoot === undefined) return Promise.reject(new Error('test-system-root-required'))
  const file = path.win32.join(systemRoot, 'System32', name)
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { timeout: 20_000, windowsHide: true }, (error, stdout) => {
      if (error === null) resolve(stdout)
      else reject(new Error('test-windows-tool-failed', { cause: error }))
    })
  })
}

/**
 * Creates `directory` as a private lease folder: 0700 on POSIX; on Windows an
 * owner-only protected ACL, so a host's extra inherited entries (sandbox
 * groups) cannot make the production owner check refuse it.
 */
export async function makePrivateFolder(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') {
    await chmod(directory, 0o700)
    return
  }
  const user = await runWindowsTool('whoami.exe', ['/user', '/fo', 'csv', '/nh'])
  const [, sid] = /"(S-[\d-]+)"/.exec(user) ?? []
  if (sid === undefined) throw new Error('test-user-sid-unavailable')
  // Elevated Windows fixtures can otherwise inherit Administrators as owner.
  await runWindowsTool('icacls.exe', [directory, '/setowner', `*${sid}`])
  await runWindowsTool('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`])
}

/** Runtime fixtures retain the package and Windows identity environment used by the native lease. */
export function runtimeMakerNative(): RuntimeMakerServiceDeps['native'] {
  return {
    platform: process.platform,
    env: { PATH: process.env['PATH'], SystemRoot: process.env['SystemRoot'] },
    packageRoot: path.resolve('.'),
  }
}
