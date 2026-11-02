// What the connector's storage guard promises, read independently of it: every
// path private to this account. On Windows the POSIX mode says nothing (Node
// reports 0o666 for any writable file), so the promise is read from the
// descriptor; on POSIX, from the mode and owner.
import { execFile } from 'node:child_process'
import { lstat, stat } from 'node:fs/promises'
import process from 'node:process'
import { expect } from 'vitest'
import { windowsPowerShell } from '../../../src/core/execGuard'

function run(file: string, args: readonly string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { windowsHide: true, env }, (failure, stdout) => {
      if (failure === null) resolve(stdout)
      else reject(new Error('privacy probe failed', { cause: failure }))
    })
  })
}

/** One start of the shared Windows PowerShell 5.1 launch; one line of its answer per path. */
async function windowsAnswers(script: (literals: string) => string, files: readonly string[]) {
  const systemRoot = process.env['SystemRoot'] ?? process.env['windir']
  if (systemRoot === undefined) throw new Error('no system root')
  const literals = files.map((file) => `'${file.replaceAll("'", "''")}'`).join(',')
  const shell = windowsPowerShell(systemRoot)
  const stdout = await run(
    shell.file,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script(literals)],
    shell.env,
  )
  return stdout.trim().split(/\r?\n/u)
}

/**
An independent read of each path's privacy on Windows, all in one start: the
Get-Acl cmdlet (a different road than the guard's CLR scan) answers whether
protection is on, the owner is the current user and no other account holds
any grant. It runs in the shared Windows PowerShell 5.1 launch, whose module
path is its own: a pwsh 7 module path inherited from the terminal that
started the suite makes 5.1 load pwsh 7's Microsoft.PowerShell.Security, and
Get-Acl then returns an object with no owner and no protection flag.
*/
async function windowsPrivacy(files: readonly string[]): Promise<boolean[]> {
  const answers = await windowsAnswers(
    (literals) =>
      `$me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; foreach ($file in @(${literals})) { $acl = Get-Acl -LiteralPath $file; [bool]($acl.AreAccessRulesProtected -and ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $me) -and (@($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -ne $me }).Count -eq 0)) }`,
    files,
  )
  return answers.map((line) => line === 'True')
}

/**
Whether this account owns the path, from an independent Get-Acl. An account
need not: a member of Administrators whose system gives such members' new
objects to the group (Windows Server's default, so the hosted runner's built-in
Administrator) owns nothing it did not take.
*/
export async function isOwnedByThisAccount(file: string): Promise<boolean> {
  if (process.platform !== 'win32') {
    const info = await lstat(file)
    return info.uid === process.getuid?.()
  }
  const [answer] = await windowsAnswers(
    (literals) =>
      `$me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; foreach ($file in @(${literals})) { [bool]((Get-Acl -LiteralPath $file).GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $me) }`,
    [file],
  )
  return answer === 'True'
}

async function isPosixPrivate(file: string): Promise<boolean> {
  const link = await lstat(file)
  const mode = link.isDirectory() ? 0o700 : 0o600
  const info = await stat(file)
  return (
    !info.isSymbolicLink() &&
    info.uid === process.getuid?.() &&
    (info.mode & 0o777) === mode &&
    (info.isDirectory() || info.nlink === 1)
  )
}

async function privacyOf(files: readonly string[]): Promise<boolean[]> {
  return process.platform === 'win32'
    ? await windowsPrivacy(files)
    : await Promise.all(files.map((file) => isPosixPrivate(file)))
}

/** Every path private to this account; a failure names the paths that are not. */
export async function expectPrivate(files: readonly string[]): Promise<void> {
  const flags = await privacyOf(files)
  expect(Object.fromEntries(files.map((file, index) => [file, flags[index]]))).toEqual(
    Object.fromEntries(files.map((file) => [file, true])),
  )
}
