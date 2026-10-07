import { createHash } from 'node:crypto'
import path from 'node:path'
import * as z from 'zod/mini'
import { UI_TEXT } from '../../shared/constants'
import { WINDOWS_TRUSTED_ACL_SCRIPT } from '../windowsTrustedPath'
import { unsafeScheduleLauncher } from './registration'
import type { BackgroundFilePort, BackgroundProcessResult } from './nativeBackground'

interface DefinitionDeps {
  readonly platform: NodeJS.Platform
  readonly id: string
  readonly definitions: readonly string[]
  readonly executable: string
  readonly uid: number
  readonly trustedPath: BackgroundFilePort['trustedPath']
  readonly hash: BackgroundFilePort['hash']
  readonly read: BackgroundFilePort['read']
  readonly run: (file: string, args: readonly string[]) => Promise<BackgroundProcessResult>
}

function normalized(file: string, platform: NodeJS.Platform): string {
  const p = platform === 'win32' ? path.win32 : path.posix
  const value = p.normalize(file).replaceAll('\\', '/')
  return platform === 'win32' ? value.toLowerCase() : value
}

/** Current kernel identity, separate from path ownership. Privileged wakes refuse. */
export async function scheduleWindowsOwner(run: DefinitionDeps['run']): Promise<string> {
  const script =
    "$ErrorActionPreference = 'Stop'; $identity = [Security.Principal.WindowsIdentity]::GetCurrent(); $principal = [Security.Principal.WindowsPrincipal]::new($identity); ConvertTo-Json -Compress -InputObject @{ sid = $identity.User.Value; elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); service = $identity.IsSystem -or ($identity.Groups.Value -contains 'S-1-5-6') }"
  const result = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ])
  if (result.exitCode !== 0) throw new Error(UI_TEXT.scheduleV2.runtime.backgroundUnavailable)
  const identity = z
    .strictObject({
      sid: z.string().check(z.regex(/^S-1-(?:5-21|12-1)-\d+(?:-\d+)+$/)),
      elevated: z.boolean(),
      service: z.boolean(),
    })
    .parse(JSON.parse(result.stdout))
  if (identity.elevated || identity.service)
    throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
  return identity.sid
}

/** Absent search/drop-in directories require a trusted existing ancestor too. */
export async function verifySystemdSearchDirectories(deps: DefinitionDeps): Promise<void> {
  const result = await deps.run('systemd-analyze', ['--user', 'unit-paths'])
  if (result.exitCode !== 0) throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
  const roots = result.stdout.trim().split(/\r?\n/)
  if (new Set(roots).size !== roots.length)
    throw new Error(UI_TEXT.scheduleV2.runtime.invalidResponse)
  for (const root of roots) {
    if (!path.posix.isAbsolute(root) || /[\p{Cc}\\]/u.test(root)) throw unsafeScheduleLauncher(root)
    await deps.trustedPath(root, 'linux', deps.uid, 'search-directory')
    for (const extension of ['service', 'timer']) {
      // systemd also searches type-wide and dash-truncated prefix drop-ins.
      const names = [`${extension}.d`, `${deps.id}.${extension}.d`]
      for (const match of deps.id.matchAll(/-/g))
        names.push(`${deps.id.slice(0, match.index + 1)}.${extension}.d`)
      for (const name of names)
        await deps.trustedPath(path.posix.join(root, name), 'linux', deps.uid, 'search-directory')
    }
  }
}

/** Query the manager, not the generated file list. Unknown/ambiguous output refuses. */
async function systemdFiles(deps: DefinitionDeps): Promise<string[]> {
  await verifySystemdSearchDirectories(deps)
  const files: string[] = []
  for (const extension of ['service', 'timer']) {
    const result = await deps.run('systemctl', [
      '--user',
      'show',
      '-p',
      'FragmentPath,DropInPaths,SourcePath',
      `${deps.id}.${extension}`,
    ])
    if (result.exitCode !== 0) throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
    const properties = new Map<string, string>()
    for (const line of result.stdout.trim().split(/\r?\n/)) {
      const match = /^(FragmentPath|DropInPaths|SourcePath)=(.*)$/.exec(line)
      const [, key, value] = match ?? []
      if (key === undefined || value === undefined || properties.has(key))
        throw new Error(UI_TEXT.scheduleV2.runtime.invalidResponse)
      properties.set(key, value)
    }
    const fragment = properties.get('FragmentPath')
    const dropIns = properties.get('DropInPaths')
    const source = properties.get('SourcePath')
    if (fragment === undefined || fragment === '' || dropIns === undefined || source === undefined)
      throw new Error(UI_TEXT.scheduleV2.runtime.invalidResponse)
    // systemctl's string-array property is ordered. Escaped spaces stay in a path.
    const paths = [
      fragment,
      ...dropIns.split(/\s+/).filter(Boolean),
      ...(source === '' ? [] : [source]),
    ]
    for (const encoded of paths) {
      const file = encoded.replaceAll(/\\x([a-fA-F0-9]{2})/g, (_match, hex: string) =>
        String.fromCodePoint(Number.parseInt(hex, 16)),
      )
      if (!path.posix.isAbsolute(file) || /[\p{Cc}\\]/u.test(file))
        throw unsafeScheduleLauncher(file)
      files.push(file)
    }
  }
  return files
}

/** Export through IRegisteredTask.Xml and trust both folder and task descriptors. */
async function windowsTask(deps: DefinitionDeps): Promise<string> {
  const script = `$ErrorActionPreference = 'Stop'; ${WINDOWS_TRUSTED_ACL_SCRIPT}; $scheduler = New-Object -ComObject 'Schedule.Service'; $scheduler.Connect(); $folder = $scheduler.GetFolder('${path.win32.join(path.win32.sep, deps.id)}'); $task = $folder.GetTask('${deps.id}'); $acl = [Security.AccessControl.DirectorySecurity]::new(); $acl.SetSecurityDescriptorSddlForm($folder.GetSecurityDescriptor(7)); $taskAcl = [Security.AccessControl.FileSecurity]::new(); $taskAcl.SetSecurityDescriptorSddlForm($task.GetSecurityDescriptor(7)); $actions = $task.Definition.Actions; if ($actions.Count -ne 1 -or $actions.Item(1).Type -ne 0) { throw 'invalid action' }; ConvertTo-Json -Compress -InputObject @{ xml = $task.Xml; actionPath = $actions.Item(1).Path; folderTrusted = (Test-TrustedAcl $acl $false $true $true); taskTrusted = (Test-TrustedAcl $taskAcl $false $false $true) }`
  const result = await deps.run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ])
  if (result.exitCode !== 0) throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
  const task = z
    .strictObject({
      xml: z.string().check(z.minLength(1)),
      actionPath: z.string(),
      folderTrusted: z.boolean(),
      taskTrusted: z.boolean(),
    })
    .parse(JSON.parse(result.stdout))
  if (
    !task.folderTrusted ||
    !task.taskTrusted ||
    normalized(task.actionPath, 'win32') !== normalized(deps.executable, 'win32')
  )
    throw unsafeScheduleLauncher(task.actionPath)
  await deps.trustedPath(task.actionPath, 'win32', deps.uid)
  return task.xml.replaceAll('\r\n', '\n')
}

/** Canonical, length-framed path/content concatenation in the manager's order. */
export async function effectiveBackgroundDefinition(deps: DefinitionDeps): Promise<{
  files: { path: string; sha256: string }[]
  sha256: string
}> {
  const listed = deps.platform === 'linux' ? await systemdFiles(deps) : [...deps.definitions]
  const files: { path: string; sha256: string }[] = []
  const digest = createHash('sha256')
  for (const file of listed) {
    const canonical = await deps.trustedPath(file, deps.platform, deps.uid, 'definition')
    const key = normalized(canonical, deps.platform)
    if (deps.definitions.every((expected) => normalized(expected, deps.platform) !== key))
      throw unsafeScheduleLauncher(file)
    const text = deps.platform === 'win32' ? '' : await deps.read(file)
    const sha256 = await deps.hash(file)
    if (text === undefined || sha256 === undefined) throw unsafeScheduleLauncher(file)
    files.push({ path: canonical, sha256 })
    const bytes = Buffer.from(text)
    digest.update(`${String(Buffer.byteLength(key))}:${key}${String(bytes.length)}:`).update(bytes)
  }
  if (
    files.length !== deps.definitions.length ||
    deps.definitions.some((expected) =>
      files.every(
        (file) => normalized(file.path, deps.platform) !== normalized(expected, deps.platform),
      ),
    )
  )
    throw unsafeScheduleLauncher(deps.id)
  if (deps.platform === 'win32') digest.update(await windowsTask(deps))
  return { files, sha256: digest.digest('hex') }
}
