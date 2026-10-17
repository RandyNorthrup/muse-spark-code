import { execFile } from 'node:child_process'
import { chmod, lstat, mkdtemp, open, realpath, rename, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, afterEach, beforeEach, vi } from 'vitest'
import type { DeviceStore } from '../../../src/host/devices/deviceStore'
import type { DeviceStorageProtection } from '../../../src/core/devices/storageProtection'
import {
  startStorageHelper,
  startWindowsStorageProtection,
  supervisedStorageHelper,
  windowsStorageProtection,
} from '../../../src/host/devices/windowsStorageProtection'
import { DEVICE_LIMITS } from '../../../src/shared/constants'
import type { DeviceGrant } from '../../../src/core/devices/grants'
import type { DeviceDispatch } from '../../../src/shared/devices'
import type * as vscode from 'vscode'
import { EN } from '../../../src/shared/l10n/en'
import { BASE_LOCALE } from '../../../src/shared/l10n/text'
import type { WebviewHostContext } from '../../../src/host/views/webviewSetup'
import { EventEmitter, FakeUri, Uri } from '../mocks/vscode'
import { FakeLogOutputChannel } from './fakes'

export const deviceCaps = {
  workers: 2,
  processes: 2,
  heavyChecks: 1,
  tokens: 100,
  spendUsd: 1,
  artifactBytes: 100,
}
export function deviceGrant(pairId: string, deviceId = 'a'.repeat(32)): DeviceGrant {
  return {
    pairId,
    offer: {
      deviceId,
      receiverIncarnationId: '1'.repeat(32),
      poolId: '2'.repeat(32),
      repositoryId: '3'.repeat(32),
      grantId: '4'.repeat(32),
      grantRevision: 1,
      platform: 'linux',
      toolchainDigest: '5'.repeat(64),
      lanes: true,
      checks: true,
      caps: deviceCaps,
      entries: [
        {
          entryId: '6'.repeat(32),
          roleId: '7'.repeat(32),
          model: { providerId: 'meta', modelId: 'muse-spark-1.3' },
          capabilities: {
            vision: false,
            tools: true,
            structuredOutput: false,
            hostedSearch: false,
            reasoningEffort: false,
          },
          readiness: 'ready',
          payer: 'apiKey',
          caps: deviceCaps,
        },
      ],
      checkIds: ['8'.repeat(32)],
    },
    snapshot: { baseCommit: '9'.repeat(40), tree: 'a'.repeat(40), manifestDigest: 'b'.repeat(64) },
    modes: ['manual'],
  }
}
export function deviceCheck(grant: DeviceGrant): DeviceDispatch {
  return {
    kind: 'check',
    identity: {
      pairId: grant.pairId,
      receiverIncarnationId: grant.offer.receiverIncarnationId,
      boardId: 'c'.repeat(32),
      taskId: 'd'.repeat(32),
      attemptId: 'e'.repeat(32),
    },
    payloadDigest: 'f'.repeat(64),
    repositoryId: grant.offer.repositoryId,
    grantId: grant.offer.grantId,
    grantRevision: grant.offer.grantRevision,
    snapshot: grant.snapshot,
    caps: deviceCaps,
    mode: 'manual',
    checkId: grant.offer.checkIds[0]!,
    toolchainDigest: grant.offer.toolchainDigest,
  }
}
export function deviceLane(grant: DeviceGrant): DeviceDispatch {
  const entry = grant.offer.entries[0]!
  const check = deviceCheck(grant)
  return {
    kind: 'lane',
    identity: check.identity,
    payloadDigest: check.payloadDigest,
    repositoryId: check.repositoryId,
    grantId: check.grantId,
    grantRevision: check.grantRevision,
    snapshot: check.snapshot,
    caps: check.caps,
    mode: check.mode,
    route: {
      pairId: grant.pairId,
      deviceId: grant.offer.deviceId,
      receiverIncarnationId: grant.offer.receiverIncarnationId,
      poolId: grant.offer.poolId,
      entryId: entry.entryId,
      model: entry.model,
    },
    roleId: entry.roleId,
    isolation: 'own-branch',
    brief: 'Bounded fake-only task',
    plannedWrites: [],
  }
}
export const deviceTestNow = Date.UTC(2026, 9, 6)
export const deviceTestExpiry = deviceTestNow + DEVICE_LIMITS.invitationValidityMs * 100

export async function removeDeviceFixture(stores: DeviceStore[], parent: string): Promise<void> {
  for (const store of stores.splice(0)) {
    try {
      await store.close()
    } catch {
      continue
    }
  }
  await rm(parent, { recursive: true, force: true })
}

const run = promisify(execFile)
type OwnedBinding = Awaited<ReturnType<typeof startWindowsStorageProtection>>
function startNativeBinding(): Promise<OwnedBinding> {
  return startWindowsStorageProtection({
    directory: path.join(tmpdir(), 'muse-spark-device-storage-test'),
    systemRoot: process.env['SystemRoot'] ?? String.raw`C:\Windows`,
    extensionPath: process.cwd(),
  })
}
const windowsBinding: { current?: Promise<OwnedBinding> } = {}
/** Ends the shared native helper; each file that uses it runs this after all. */
export async function endDeviceStorage(): Promise<void> {
  const binding = await windowsBinding.current
  const helper = binding?.current()
  binding?.dispose()
  await helper?.exited
}
/**
 * Each OS's production storage configuration: the real native binding on
 * Windows (its helper compiled once into a shared temp cache), and no binding
 * elsewhere, where POSIX owner/mode checks and directory fsync apply.
 */
export async function deviceStorage(): Promise<DeviceStorageProtection | undefined> {
  if (process.platform !== 'win32') return undefined
  windowsBinding.current ??= startNativeBinding()
  const binding = await windowsBinding.current
  return binding.protection
}
/**
 * A Node stand-in speaking the helper's line protocol: it echoes each
 * request, answers `sync` with an error, exits on `replace`, answers `swap`
 * with another request's id, and never answers `hang`.
 */
export const STORAGE_HELPER_STAND_IN = String.raw`
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffer += chunk
    for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
      const [id, operation, ...fields] = buffer.slice(0, end).split('\t')
      buffer = buffer.slice(end + 1)
      const paths = fields.map((field) => field.length === 1 ? field : Buffer.from(field, 'base64').toString('utf8'))
      if (operation === 'hang') continue
      if (operation === 'swap') process.stdout.write('999\tok\t\n')
      else if (operation === 'sync') process.stdout.write(id + '\terr\t5\n')
      else if (operation === 'replace') process.exit(3)
      else process.stdout.write(id + '\tok\t' + operation + ':' + paths.join('+') + '\n')
    }
  })`
/**
 * A binding of the test's own whose helper process it can watch end: the
 * real native helper on Windows, the protocol stand-in elsewhere.
 */
export async function ownedDeviceStorage(): Promise<OwnedBinding> {
  if (process.platform === 'win32') return await startNativeBinding()
  const helper = supervisedStorageHelper(() =>
    startStorageHelper(process.execPath, ['-e', STORAGE_HELPER_STAND_IN], process.env),
  )
  // Started and answering, as the native binding is once it returns.
  await helper.request('ping', [])
  return {
    protection: windowsStorageProtection(helper.request),
    current: helper.current,
    dispose: helper.dispose,
  }
}
/**
 * A binding usable synchronously, for suites that hand one to the journal at
 * module scope: the real Windows binding (started on first use), or the
 * shared fake elsewhere, which also round-trips through the real filesystem.
 */
export const deviceStorageBinding: DeviceStorageProtection =
  process.platform === 'win32'
    ? {
        assertPrivate: async (file, isDirectory) => {
          const binding = await deviceStorage()
          await binding?.assertPrivate(file, isDirectory)
        },
        assertSafeAncestor: async (directory) => {
          const binding = await deviceStorage()
          await binding?.assertSafeAncestor(directory)
        },
        secureFresh: async (file, isDirectory) => {
          const binding = await deviceStorage()
          await binding?.secureFresh(file, isDirectory)
        },
        replace: async (stage, target) => {
          const binding = await deviceStorage()
          await binding?.replace(stage, target)
        },
        syncDirectory: async (directory) => {
          const binding = await deviceStorage()
          await binding?.syncDirectory(directory)
        },
      }
    : fakeDeviceStorage().protection
/**
 * A loaded Devices bundle of fakes with every export the bundle predicate
 * requires; a test overrides the parts it drives.
 */
export function fakeDevicesBundle<Parts extends object>(parts: Parts) {
  return {
    createDeviceService: vi.fn(),
    DeviceStore: vi.fn(),
    DeviceSecrets: vi.fn(),
    AttemptJournal: vi.fn(),
    DeviceDiscovery: vi.fn(),
    startWindowsStorageProtection: vi.fn(),
    openDeviceProductionDeps: vi.fn(),
    unboundDeviceLanePorts: vi.fn(),
    ...parts,
  }
}
/** A temp root this test owns: mkdtemp is 0700 on POSIX; Windows claims it as a store folder. */
export async function privateDeviceRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), prefix)))
  const storage = await deviceStorage()
  await storage?.secureFresh(root, true)
  return root
}
/** Per test: a fresh private root, this OS's storage binding, and store cleanup. */
export function useDeviceStorageRoot(prefix: string) {
  const fixture: { parent: string; storage: DeviceStorageProtection | undefined } = {
    parent: '',
    storage: undefined,
  }
  const stores: DeviceStore[] = []
  beforeEach(async () => {
    fixture.storage = await deviceStorage()
    fixture.parent = await privateDeviceRoot(prefix)
  })
  afterEach(async () => {
    await removeDeviceFixture(stores, fixture.parent)
  })
  afterAll(endDeviceStorage)
  return { fixture, stores }
}
// Windows' Everyone group: a principal other than the owner.
const EVERYONE = '*S-1-1-0'
/**
 * Lets another principal read `target` (or, with `canReplaceEntries`, also
 * delete and add its entries), through each OS's own permission model, on a
 * path the test created. `restore` undoes exactly that grant.
 */
export async function grantOthers(
  target: string,
  kind: 'file' | 'directory' | 'parent',
): Promise<{ restore: () => Promise<void> }> {
  if (process.platform === 'win32') {
    await run('icacls', [target, '/grant', `${EVERYONE}:(${kind === 'parent' ? 'DC,AD,WD' : 'R'})`])
    return {
      restore: async () => {
        await run('icacls', [target, '/remove:g', EVERYONE])
      },
    }
  }
  const modes: Record<typeof kind, readonly [number, number]> = {
    file: [0o644, 0o600],
    directory: [0o755, 0o700],
    parent: [0o777, 0o700],
  }
  const [open, closed] = modes[kind]
  await chmod(target, open)
  return {
    restore: async () => {
      await chmod(target, closed)
    },
  }
}
/**
 * A reparse alias any account may create at `at`: a symlink to `target`, or
 * on Windows a junction (to `target`'s folder when it is a file), since file
 * symlinks need a privilege there.
 */
export async function reparseAlias(target: string, at: string): Promise<void> {
  if (process.platform !== 'win32') {
    await symlink(target, at)
    return
  }
  const info = await lstat(target)
  const folder = info.isDirectory() ? target : path.dirname(target)
  await symlink(folder, at, 'junction')
}
/**
 * Each OS's independent reading of owner-only access: POSIX mode bits, or
 * .NET's SDDL through Windows PowerShell (owner and one explicit, protected
 * full-control rule). .NET, not Get-Acl: a runner's PowerShell 7 module path
 * can stop Windows PowerShell autoloading its security module.
 */
export async function ownerOnlyEvidence(target: string, isDirectory: boolean): Promise<string> {
  if (process.platform !== 'win32') {
    const info = await stat(target)
    return (info.mode & 0o777).toString(8)
  }
  const reader = isDirectory ? 'Directory' : 'File'
  const { stdout } = await run(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      String.raw`$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $sddl = [IO.${reader}]::GetAccessControl($env:MUSE_TEST_TARGET).GetSecurityDescriptorSddlForm('Owner, Access'); if ($sddl -match ('^O:' + $sid + 'D:PA?I?\(A;' + $env:MUSE_TEST_FLAGS + ';FA;;;' + $sid + '\)$')) { 'owner-only' } else { 'not owner-only: ' + $sddl }`,
    ],
    {
      env: { ...process.env, MUSE_TEST_TARGET: target, MUSE_TEST_FLAGS: isDirectory ? 'OICI' : '' },
    },
  )
  return stdout.trim() === 'owner-only' ? (isDirectory ? '700' : '600') : stdout.trim()
}

type ProtectionStep = keyof DeviceStorageProtection
/**
 * The shared fake binding: it records each step and refuses the ones it is
 * told to. Otherwise it round-trips through `base` (the real Windows binding
 * when a test wants real behaviour underneath) or the real filesystem.
 */
export function fakeDeviceStorage(base?: DeviceStorageProtection) {
  const refused = new Set<ProtectionStep>()
  const calls: ProtectionStep[] = []
  const step = (name: ProtectionStep) => {
    calls.push(name)
    return refused.has(name) ? Promise.reject(new Error('protection-sentinel')) : Promise.resolve()
  }
  const protection: DeviceStorageProtection = {
    async assertPrivate(file, isDirectory) {
      await step('assertPrivate')
      await base?.assertPrivate(file, isDirectory)
    },
    async assertSafeAncestor(directory) {
      await step('assertSafeAncestor')
      await base?.assertSafeAncestor(directory)
    },
    async secureFresh(file, isDirectory) {
      await step('secureFresh')
      await base?.secureFresh(file, isDirectory)
    },
    async replace(stage, target) {
      await step('replace')
      await (base === undefined ? rename(stage, target) : base.replace(stage, target))
    },
    async syncDirectory(directory) {
      await step('syncDirectory')
      if (base !== undefined) await base.syncDirectory(directory)
      else if (process.platform !== 'win32') {
        const handle = await open(directory, 'r')
        try {
          await handle.sync()
        } finally {
          await handle.close()
        }
      }
    },
  }
  return {
    protection,
    calls,
    refuse(name: ProtectionStep) {
      refused.add(name)
    },
  }
}

/**
 * Device-scoped webview fakes. The shared helpers carry no panel fake (the
 * test overhaul removed it as orphaned); the Devices tab suite owns its own.
 * Complete means every member of the real interface is implemented, so the
 * compiler reports when the API changes.
 */
function acceptDeviceMessage(_message: unknown): Thenable<boolean> {
  return Promise.resolve(true)
}

export class FakeDeviceWebview implements vscode.Webview {
  public options: vscode.WebviewOptions = {}
  public html = ''
  public readonly cspSource = 'vscode-webview://fake'
  public readonly messages = new EventEmitter<unknown>()
  public readonly onDidReceiveMessage = this.messages.event
  public readonly postMessage = vi.fn(acceptDeviceMessage)

  public asWebviewUri(localResource: vscode.Uri): vscode.Uri {
    return new FakeUri(`webview${localResource.path}`)
  }
}

export class FakeDeviceWebviewPanel implements vscode.WebviewPanel {
  public readonly webview = new FakeDeviceWebview()
  public readonly options: vscode.WebviewPanelOptions = {}
  public iconPath?: NonNullable<vscode.WebviewPanel['iconPath']>
  public viewColumn: vscode.ViewColumn | undefined = undefined
  public active = true
  public visible = true
  public readonly disposed = new EventEmitter<void>()
  public readonly onDidDispose = this.disposed.event
  public readonly viewStateChanges =
    new EventEmitter<vscode.WebviewPanelOnDidChangeViewStateEvent>()
  public readonly onDidChangeViewState = this.viewStateChanges.event
  public readonly reveal = vi.fn(
    (_viewColumn?: vscode.ViewColumn, _shouldPreserveFocus?: boolean): void => {
      this.visible = true
    },
  )

  public constructor(
    public readonly viewType: string,
    public title: string,
  ) {}

  public dispose(): void {
    this.disposed.fire()
  }
}

/** The Devices tab's host context: extension root, installed English, a log. */
export function fakeDeviceHostContext(): Pick<WebviewHostContext, 'extensionUri' | 'l10n' | 'log'> {
  return {
    extensionUri: Uri.file('/ext'),
    l10n: { locale: BASE_LOCALE, table: EN },
    log: new FakeLogOutputChannel(),
  }
}
