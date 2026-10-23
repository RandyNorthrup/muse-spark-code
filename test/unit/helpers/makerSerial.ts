import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { link, readFile, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { killTree, sweepExitedTree } from '../../../src/host/processTree'
import { prepareWindowsSerialHelper } from '../../../src/core/maker/serial/windowsHelper'
import {
  listenNativeOwnerPipe,
  withNativeLeaseMutex,
  type NativeLeaseHelper,
} from '../../../src/core/maker/serial/nativeLease'
import type { SerialProcessDependencies } from '../../../src/core/maker/serial/process'
import type { LeaseDependencies } from '../../../src/core/maker/lease'

export function makerProcessDeps(
  overrides: Partial<SerialProcessDependencies> = {},
): SerialProcessDependencies {
  const tree = {
    platform: process.platform,
    systemRoot: process.env['SystemRoot'],
    log: () => undefined,
  }
  return {
    platform: process.platform,
    env: { PATH: process.env['PATH'] },
    durationMs: 1000,
    readyTimeoutMs: 5000,
    stopGraceMs: 100,
    maxBytes: 4096,
    maxStatusBytes: 4096,
    kill: (root, startedAt) => killTree(root, tree, startedAt),
    sweep: (pid, startedAt, diedAt) => sweepExitedTree(pid, startedAt, diedAt, tree),
    ...overrides,
  }
}

export async function makerNativeHelper(
  directory: string,
  transformSource?: (source: string) => string,
): Promise<NativeLeaseHelper> {
  const processDeps = makerProcessDeps()
  if (process.platform !== 'win32')
    return {
      file: '/usr/bin/python3',
      prefix: ['-I', path.resolve('native/posix/serial.py')],
      process: processDeps,
    }
  const file = await prepareWindowsSerialHelper({
    directory,
    systemRoot: process.env['SystemRoot'] ?? String.raw`C:\Windows`,
    env: processDeps.env,
    log: () => undefined,
    readSource: async () => {
      const source = await readFile(path.resolve('native/windows/MuseSparkSerial.cs'), 'utf8')
      return transformSource?.(source) ?? source
    },
    run: (program, args, env) =>
      new Promise((resolve, reject) =>
        execFile(program, [...args], { env, timeout: 20_000 }, (error, stdout) => {
          if (error === null) resolve(stdout)
          else reject(new Error('test-compiler-failed', { cause: error }))
        }),
      ),
  })
  return { file, prefix: [], process: processDeps }
}

export async function makerLeaseDeps(directory: string): Promise<LeaseDependencies> {
  const run = (file: string, args: readonly string[]) =>
    new Promise<string>((resolve, reject) =>
      execFile(
        file,
        [...args],
        { env: makerProcessDeps().env, timeout: 20_000 },
        (error, stdout) => {
          if (error === null) resolve(stdout.trim())
          else reject(new Error('test-process-query-failed', { cause: error }))
        },
      ),
    )
  const windowsScript = path.join(directory, 'lease-owner.ps1')
  if (process.platform === 'win32') {
    await writeFile(
      windowsScript,
      `
param([string]$Operation, [string]$Target)
$ErrorActionPreference = 'Stop'
$user = [Security.Principal.WindowsIdentity]::GetCurrent().User
if ($Operation -eq 'start') {
  try { [Diagnostics.Process]::GetProcessById([int]$Target).StartTime.ToUniversalTime().Ticks.ToString() }
  catch [ArgumentException] { 'absent' }
  exit
}
$acl = Get-Acl -LiteralPath $Target
if ($Operation -eq 'prepare') {
  $acl.SetOwner($user)
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($user, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
  Set-Acl -LiteralPath $Target -AclObject $acl
  $acl = Get-Acl -LiteralPath $Target
}
$private = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $user.Value
foreach ($rule in $acl.Access) {
  $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
  if ($rule.AccessControlType -eq 'Allow' -and $sid -notin @($user.Value, 'S-1-5-18', 'S-1-5-32-544')) { $private = $false }
}
if ($private) { 'private' } else { 'public' }
`,
    )
    await run('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      windowsScript,
      'prepare',
      directory,
    ])
  }
  const processStartTime = async (pid: number) => {
    if (process.platform === 'win32') {
      const result = await run('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        windowsScript,
        'start',
        String(pid),
      ])
      return result === 'absent' ? undefined : result
    }
    if (process.platform === 'linux') {
      try {
        const stat = await readFile(`/proc/${String(pid)}/stat`, 'utf8')
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ', 20)
        return fields[0] === 'Z' ? undefined : fields[19]
      } catch (error: unknown) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
        throw error
      }
    }
    if (!(await isTestProcessAlive(pid))) return undefined
    try {
      const result = await run('/bin/ps', ['-p', String(pid), '-o', 'lstart='])
      return result === '' ? undefined : result
    } catch (error: unknown) {
      if (!(await isTestProcessAlive(pid))) return undefined
      throw error
    }
  }
  const ownStart = await processStartTime(process.pid)
  const helper = await makerNativeHelper(directory)
  // Fixtures never change these ACLs after creation; share their concurrent checks.
  const ownerChecks = new Map<string, Promise<boolean>>()
  return {
    directory,
    platform: process.platform,
    timeoutMs: 2000,
    maxRecordBytes: 4096,
    exclusive: (file, operation) => withNativeLeaseMutex(helper, file, operation),
    listenOwnerPipe: (endpoint, id, stop) => listenNativeOwnerPipe(helper, endpoint, id, stop),
    processStartTime: (pid) =>
      pid === process.pid ? Promise.resolve(ownStart) : processStartTime(pid),
    isOwnerDirectory: (folder) => {
      const previous = ownerChecks.get(folder)
      if (previous !== undefined) return previous
      const checked = (async () => {
        const result = await run('powershell.exe', [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          windowsScript,
          'check',
          folder,
        ])
        return result === 'private'
      })()
      ownerChecks.set(folder, checked)
      return checked
    },
  }
}

export async function isTestProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    throw error
  }
  if (process.platform !== 'linux') return true
  try {
    const state = await readFile(`/proc/${String(pid)}/stat`, 'utf8')
    return !/^\d+ \(.*\) Z /.test(state)
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ESRCH')
    )
      return false
    throw error
  }
}

export const fakeSerialScript = String.raw`
const mode = process.argv[1];
if (mode === 'unavailable') { process.stderr.write('serial-unavailable\n'); process.exit(1); }
if (mode === 'stderr-overflow') process.stderr.write('A'.repeat(8192));
else if (mode === 'unknown') process.stderr.write('invented\n');
else if (mode !== 'stall') process.stderr.write('serial-ready\n');
if (mode === 'overflow') process.stdout.write(Buffer.alloc(8192, 65));
if (mode === 'orphan') {
  const child = require('node:child_process').spawn(process.execPath, ['-e', "setInterval(() => {}, 100); setTimeout(() => process.exit(0), process.platform === 'win32' ? 15000 : 3000)"], { stdio: ['ignore', 'inherit', 'inherit'] });
  process.stdout.write(String(child.pid) + '\n');
  process.exit(0);
}
if (mode === 'exit') process.exit(0);
process.stdin.on('data', (data) => process.stdout.write(data));
process.stdin.on('end', () => process.exit(0));
setInterval(() => {}, 100);
setTimeout(() => process.exit(0), 1500);
`

/**
An owner published by a build before FIXM103W10, still running: a real
socket named by the whole lease id, its version-1 claim in the head slot and
its Stop index record. It answers each Stop request as the old holder did
and records the request.
*/
export async function previousBuildOwner(directory: string, resource: string, startedAt: string) {
  const id = randomUUID()
  const generation = randomUUID()
  const record = {
    version: 1,
    id,
    generation,
    resource,
    holder: 'previous build',
    pid: process.pid,
    startedAt,
    endpoint: path.join(directory, `${id}.sock`),
  }
  const requests: unknown[] = []
  const server = net.createServer((socket) => {
    let input = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      input += chunk
      if (!input.endsWith('\n')) return
      requests.push(JSON.parse(input))
      socket.end('{"stopped":true}\n')
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(record.endpoint, resolve)
  })
  // Its claim record holds the resource's head slot; its Stop index entry is a separate file.
  const key = createHash('sha256').update(resource).digest('hex')
  const claim = path.join(directory, `claim-v1.${key}.${id}.${generation}.json`)
  await writeFile(claim, JSON.stringify(record))
  await link(claim, path.join(directory, `claim-v1.${key}.head.claim`))
  await writeFile(
    path.join(directory, `stop-v1.${key}.${id}.${generation}.json`),
    JSON.stringify(record),
  )
  return {
    record,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      }),
  }
}
