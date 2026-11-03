// A real permission failure on every platform: the operating system itself
// refuses the current user. POSIX clears the mode bits (chmod 0); Windows
// adds an access-control entry that denies this user full control of the
// folder and everything under it (icacls /deny *<SID>:(OI)(CI)F), which is
// what a chmod 0 means there. The returned function lifts the denial so the
// folder can be removed. Nothing is simulated: reads, writes and listings
// under the folder fail with the kernel's own EACCES/EPERM.
import { execFile } from 'node:child_process'
import { chmod } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** The current user's security identifier, read from the system (whoami /user). */
async function windowsUserSid(): Promise<string> {
  const { stdout } = await run(
    path.join(process.env['SystemRoot'] ?? String.raw`C:\Windows`, 'System32', 'whoami.exe'),
    ['/user', '/fo', 'csv', '/nh'],
  )
  const sid = /"(S-1-[\d-]+)"/.exec(stdout)?.[1]
  if (sid === undefined) throw new Error(`whoami printed no SID: ${stdout}`)
  return sid
}

function icacls(args: readonly string[]): Promise<unknown> {
  return run(
    path.join(process.env['SystemRoot'] ?? String.raw`C:\Windows`, 'System32', 'icacls.exe'),
    [...args],
  )
}

/** Refuse the current user every access to `folder`; resolves to the undo. */
export async function denyAccess(folder: string): Promise<() => Promise<void>> {
  if (process.platform !== 'win32') {
    await chmod(folder, 0)
    return () => chmod(folder, 0o755)
  }
  const sid = await windowsUserSid()
  await icacls([folder, '/deny', `*${sid}:(OI)(CI)F`])
  return async () => {
    await icacls([folder, '/remove:d', `*${sid}`])
  }
}

/**
Refuse the current user new entries in `folder`, a read-only folder: POSIX
sets mode 0555; Windows denies adding files and folders to it
(icacls /deny *<SID>:(WD,AD)), which is what mode 0555 means there.
Listing the folder and removing it stay allowed. Resolves to the undo.
*/
export async function denyWrites(folder: string): Promise<() => Promise<void>> {
  if (process.platform !== 'win32') {
    await chmod(folder, 0o555)
    return () => chmod(folder, 0o755)
  }
  const sid = await windowsUserSid()
  await icacls([folder, '/deny', `*${sid}:(WD,AD)`])
  return async () => {
    await icacls([folder, '/remove:d', `*${sid}`])
  }
}

/**
Refuse the current user new entries in `parent` and the removal of `child`,
which lies in it: what a scanner's lock does to a folder being removed. POSIX
has both from the read-only parent. On Windows denying new entries leaves
removal allowed, since removing takes DELETE on the child or delete-child on
the parent, so both of those are denied too. Resolves to the undo.
*/
export async function denyRemoval(parent: string, child: string): Promise<() => Promise<void>> {
  if (process.platform !== 'win32') return await denyWrites(parent)
  const sid = await windowsUserSid()
  await icacls([parent, '/deny', `*${sid}:(WD,AD,DC)`])
  await icacls([child, '/deny', `*${sid}:(DE)`])
  return async () => {
    await icacls([child, '/remove:d', `*${sid}`])
    await icacls([parent, '/remove:d', `*${sid}`])
  }
}
