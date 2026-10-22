// M124 (D106, RVM124 finding 15): the connector's storage guard for real:
// a real ConnectorStore bound to the real guard in a real temporary data
// folder. What the store creates comes back private to the current account
// (an independent Get-Acl read on Windows, stat on POSIX); storage planted
// the legacy way is refused; links and escapes are refused; the entry
// refuses to serve or report on untrusted storage while revoke and kill
// still narrow it.
import { execFile } from 'node:child_process'
import { lstat, mkdir, stat, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { CONNECTOR_FOLDER } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { parseConnectorCommand, runConnectorCommand } from '../../src/runtime/connector/command'
import { runConnector } from '../../src/runtime/connector/entry'
import { ConnectorStore } from '../../src/runtime/connector/store'
import { connectorStorageGuard } from '../../src/runtime/connector/storageGuard'
import { isStorageRefused } from '../../src/runtime/connector/storageGuardPort'
import { usingTempDir } from './helpers/temporaryFolders'

function run(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { windowsHide: true }, (failure, stdout) => {
      if (failure === null) resolve(stdout)
      else reject(new Error('privacy probe failed', { cause: failure }))
    })
  })
}

const unbound = () => Promise.reject(new Error('not bound in this suite'))

/**
An independent read of one path's privacy on Windows: the Get-Acl cmdlet
(a different road than the guard's CLR scan) answers whether protection is
on, the owner is the current user and no other account holds any grant.
*/
async function isWindowsPrivate(file: string): Promise<boolean> {
  const systemRoot = process.env['SystemRoot'] ?? process.env['windir']
  if (systemRoot === undefined) throw new Error('no system root')
  const literal = file.replaceAll("'", "''")
  const stdout = await run(
    path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $acl = Get-Acl -LiteralPath '${literal}'; [bool]($acl.AreAccessRulesProtected -and ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $me) -and (@($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -ne $me }).Count -eq 0))`,
    ],
  )
  return stdout.trim() === 'True'
}

async function isPosixPrivate(file: string, mode: number): Promise<boolean> {
  const info = await stat(file)
  return (
    !info.isSymbolicLink() &&
    info.uid === process.getuid?.() &&
    (info.mode & 0o777) === mode &&
    (info.isDirectory() || info.nlink === 1)
  )
}

async function expectPrivate(file: string): Promise<void> {
  if (process.platform === 'win32') {
    expect(await isWindowsPrivate(file)).toBe(true)
    return
  }
  const info = await lstat(file)
  expect(await isPosixPrivate(file, info.isDirectory() ? 0o700 : 0o600)).toBe(true)
}

/** The owner's own grant command against the given store, confirmed in person. */
async function grant(store: ConnectorStore): Promise<number> {
  const command = parseConnectorCommand(['grant', '--user-library'])
  if (command?.kind !== 'grant') throw new Error('grant parse')
  return await runConnectorCommand(store, command, {
    isInteractive: true,
    now: Date.now,
    print: () => undefined,
    printError: (line) => {
      throw new Error(line)
    },
    confirm: () => Promise.resolve(true),
  })
}

/** The real entry on pipes, keeping both streams' words. */
async function runEntry(
  data: string,
  root: string,
  argv: readonly string[],
): Promise<{ exit: number; out: string; err: string }> {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let out = ''
  let err = ''
  stdout.on('data', (chunk: Buffer) => {
    out += chunk.toString('utf8')
  })
  stderr.on('data', (chunk: Buffer) => {
    err += chunk.toString('utf8')
  })
  const exit = await runConnector({
    argv,
    table: EN,
    locale: 'en',
    dataFolder: data,
    homeDir: data,
    version: '0.0.0-test',
    stdin: new PassThrough(),
    stdout,
    stderr,
    isInteractive: false,
    registered: () => [],
    openBrowser: () => Promise.reject(new Error('no browser in this suite')),
    schedules: { list: unbound, pause: unbound },
    reports: { generate: unbound },
    storageGuard: connectorStorageGuard(root),
  })
  return { exit, out, err }
}

async function refusalOf(work: () => Promise<unknown>): Promise<{ reason: string }> {
  try {
    await work()
  } catch (error: unknown) {
    if (!isStorageRefused(error)) throw error
    return error
  }
  throw new Error('storage refusal expected')
}

describe('M124 connector storage guard', () => {
  it('secures what the store creates, then verifies the tree', async () => {
    await usingTempDir('m124-guard-', async (data) => {
      const root = path.join(data, CONNECTOR_FOLDER)
      const guard = connectorStorageGuard(root)
      const store = new ConnectorStore(data, guard)
      expect(await grant(store)).toBe(0)
      await store.setKilled(false, new Date().toISOString())
      const audit = store.audit('default', Date.now)
      const key = await audit.key()
      expect(key).toHaveLength(32)
      await audit.append('{"a":1}\n')
      await guard.verify()
      await expectPrivate(path.join(root, 'grants', 'default.json'))
      await expectPrivate(path.join(root, 'kill-switch.json'))
      await expectPrivate(path.join(root, 'audit.key'))
      await expectPrivate(path.join(root, 'audit', 'default.jsonl'))
      await expectPrivate(path.join(root, 'grants'))
      await expectPrivate(root)
    })
  })

  it('refuses storage planted the legacy way', async () => {
    await usingTempDir('m124-guard-legacy-', async (data) => {
      // A real grant through an unbound store: byte-real pre-fix storage.
      expect(await grant(new ConnectorStore(data))).toBe(0)
      const guard = connectorStorageGuard(path.join(data, CONNECTOR_FOLDER))
      const refusal = await refusalOf(() => guard.verify())
      expect(refusal.reason).toBe('access')
    })
  })

  it('refuses a link below the root', async () => {
    await usingTempDir('m124-guard-link-', async (data) => {
      const root = path.join(data, CONNECTOR_FOLDER)
      await mkdir(root, { recursive: true })
      const guard = connectorStorageGuard(root)
      await guard.secure(root, 'directory')
      const target = path.join(data, 'outside')
      await mkdir(target)
      // A junction reads as a directory to lstat: only the descriptor scan
      // sees the reparse point.
      await symlink(
        target,
        path.join(root, 'grants'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
      const refusal = await refusalOf(() => guard.verify())
      expect(refusal.reason).toBe('link')
    })
  })

  it('refuses to secure outside the root', async () => {
    await usingTempDir('m124-guard-scope-', async (data) => {
      const stray = path.join(data, 'stray.json')
      await writeFile(stray, '{}\n')
      const guard = connectorStorageGuard(path.join(data, CONNECTOR_FOLDER))
      const refusal = await refusalOf(() => guard.secure(stray, 'file'))
      expect(refusal.reason).toBe('scope')
    })
  })

  it('refuses to serve untrusted storage, silently on stdout', async () => {
    await usingTempDir('m124-guard-serve-', async (data) => {
      expect(await grant(new ConnectorStore(data))).toBe(0)
      const root = path.join(data, CONNECTOR_FOLDER)
      const ran = await runEntry(data, root, [])
      expect(ran.exit).toBe(1)
      expect(ran.out).toBe('')
      expect(ran.err).toContain(root)
    })
  })

  it('reports the refusal instead of the grants on untrusted storage', async () => {
    await usingTempDir('m124-guard-status-', async (data) => {
      expect(await grant(new ConnectorStore(data))).toBe(0)
      const root = path.join(data, CONNECTOR_FOLDER)
      const ran = await runEntry(data, root, ['status'])
      expect(ran.exit).toBe(1)
      expect(ran.out).toBe('')
      expect(ran.err).toContain(root)
    })
  })

  it('still narrows untrusted storage on revoke and kill', async () => {
    await usingTempDir('m124-guard-narrow-', async (data) => {
      expect(await grant(new ConnectorStore(data))).toBe(0)
      const root = path.join(data, CONNECTOR_FOLDER)
      const revokedRan = await runEntry(data, root, ['revoke'])
      expect(revokedRan.exit).toBe(0)
      const revoked = await new ConnectorStore(data).grant('default')
      expect(revoked?.revoked).toBe(true)
      const killedRan = await runEntry(data, root, ['kill'])
      expect(killedRan.exit).toBe(0)
      expect(await new ConnectorStore(data).isKilled()).toBe(true)
    })
  })
})
