// M124 (D106, RVM124 finding 15): the connector's storage guard for real:
// a real ConnectorStore bound to the real guard in a real private data
// folder. What the store creates comes back private to the current account
// (helpers/connectorPrivacy: an independent read of it); storage planted
// the legacy way is refused; links and escapes are refused; the entry
// refuses to serve or report on untrusted storage while revoke and kill
// still narrow it.
import { chmod, link, mkdir, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CONNECTOR_FOLDER } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { parseConnectorCommand, runConnectorCommand } from '../../src/runtime/connector/command'
import { runConnector } from '../../src/runtime/connector/entry'
import { ConnectorStore } from '../../src/runtime/connector/store'
import { connectorStorageGuard, windowsGuardScript } from '../../src/runtime/connector/storageGuard'
import { isStorageRefused } from '../../src/runtime/connector/storageGuardPort'
import { expectPrivate, isOwnedByThisAccount } from './helpers/connectorPrivacy'
import { OWNER_COMMAND_IO } from './helpers/connectorRemote'
import { takeOwnership } from './helpers/makerTemp'
import { withoutModuleAutoLoading } from './helpers/noModuleAutoLoading'
import { usingPrivateDir } from './helpers/temporaryFolders'

const unbound = () => Promise.reject(new Error('not bound in this suite'))

/** The owner's own grant command against the given store, confirmed in person. */
async function grant(store: ConnectorStore): Promise<number> {
  const command = parseConnectorCommand(['grant', '--user-library'])
  if (command?.kind !== 'grant') throw new Error('grant parse')
  return await runConnectorCommand(store, command, OWNER_COMMAND_IO)
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

/** A fresh connector root the guard has secured, as each link refusal starts. */
async function securedRoot(data: string) {
  const root = path.join(data, CONNECTOR_FOLDER)
  await mkdir(root, { recursive: true })
  const guard = connectorStorageGuard(root)
  await guard.secure(root, 'directory')
  return { root, guard }
}

/**
A grant planted without the guard. On POSIX the unbound store's mode flags
already leave the tree mode-private, so the plant also loosens the grant
file to the group/other-readable mode any writer that does not mind the
flags leaves behind: storage the guard did not secure, refused either way.
*/
async function plantLegacy(data: string): Promise<void> {
  expect(await grant(new ConnectorStore(data))).toBe(0)
  if (process.platform !== 'win32') {
    await chmod(path.join(data, CONNECTOR_FOLDER, 'grants', 'default.json'), 0o644)
  }
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
    await usingPrivateDir('m124-guard-', async (data) => {
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
      await expectPrivate([
        path.join(root, 'grants', 'default.json'),
        path.join(root, 'kill-switch.json'),
        path.join(root, 'audit.key'),
        path.join(root, 'audit', 'default.jsonl'),
        path.join(root, 'grants'),
        root,
      ])
    })
  })

  it('refuses storage planted the legacy way', async () => {
    await usingPrivateDir('m124-guard-legacy-', async (data) => {
      // A real grant through an unbound store: byte-real pre-fix storage.
      await plantLegacy(data)
      const root = path.join(data, CONNECTOR_FOLDER)
      const guard = connectorStorageGuard(root)
      // The owner comes first: where this account's new objects belong to
      // Administrators (an administrator's full token: the hosted runner's
      // built-in Administrator, any elevated process), the plant is refused on that.
      const refusal = await refusalOf(() => guard.verify())
      expect(refusal.reason).toBe((await isOwnedByThisAccount(root)) ? 'access' : 'owner')
    })
  })

  it('refuses a legacy root this account owns, for the grants it inherited', async () => {
    await usingPrivateDir('m124-guard-legacy-owned-', async (data) => {
      await plantLegacy(data)
      const root = path.join(data, CONNECTOR_FOLDER)
      await takeOwnership(root)
      const refusal = await refusalOf(() => connectorStorageGuard(root).verify())
      expect(refusal.reason).toBe('access')
    })
  })

  // A folder of the system's own, on any Windows and read only: no account
  // here owns it, and no privilege is needed to see that.
  it.runIf(process.platform === 'win32')('refuses a tree another account owns', async () => {
    const systemRoot = process.env['SystemRoot'] ?? process.env['windir'] ?? ''
    const guard = connectorStorageGuard(path.win32.join(systemRoot, 'System32', 'drivers', 'etc'))
    const refusal = await refusalOf(() => guard.verify())
    expect(refusal.reason).toBe('owner')
  })

  // An agent a client started carries no analysis cache variable, and the guard
  // runs at its every start: a cmdlet here is 20 s and more a start where the
  // module path holds large modules.
  it.runIf(process.platform === 'win32')(
    'secures and reads with module auto-loading off',
    async () => {
      await usingPrivateDir('m124-guard-noload-', async (data) => {
        const root = path.join(data, CONNECTOR_FOLDER)
        await mkdir(root)
        const secured = z
          .object({ owner: z.string(), me: z.string(), locked: z.boolean() })
          .parse(
            JSON.parse(
              await withoutModuleAutoLoading(
                windowsGuardScript('secure', { path: root, directory: true }),
              ),
            ),
          )
        expect(secured.locked).toBe(true)
        expect(secured.owner).toBe(secured.me)
        const read = z
          .object({
            me: z.string(),
            scanned: z.array(z.object({ owner: z.string(), folder: z.boolean() })),
          })
          .parse(
            JSON.parse(
              await withoutModuleAutoLoading(windowsGuardScript('read', { paths: [root] })),
            ),
          )
        expect(read.scanned).toMatchObject([{ owner: read.me, folder: true }])
      })
    },
  )

  it('refuses a link below the root', async () => {
    await usingPrivateDir('m124-guard-link-', async (data) => {
      const { root, guard } = await securedRoot(data)
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

  it('accepts a first start whose data folder is reached through a link above it', async () => {
    await usingPrivateDir('m124-guard-above-', async (data) => {
      // Links at or above the anchor are normal (macOS's /var is one): before
      // anything exists, the guard reads the chain as the system resolves it.
      const real = path.join(data, 'real')
      await mkdir(real)
      const via = path.join(data, 'via')
      await symlink(real, via, process.platform === 'win32' ? 'junction' : 'dir')
      const guard = connectorStorageGuard(path.join(via, CONNECTOR_FOLDER))
      await expect(guard.verify()).resolves.toBeUndefined()
      await mkdir(path.join(via, CONNECTOR_FOLDER))
      await guard.secure(path.join(via, CONNECTOR_FOLDER), 'directory')
      await expect(guard.verify()).resolves.toBeUndefined()
    })
  })

  it('refuses a hard link below the root', async () => {
    await usingPrivateDir('m124-guard-hardlink-', async (data) => {
      const { root, guard } = await securedRoot(data)
      const target = path.join(root, 'target.json')
      await writeFile(target, '{}\n')
      await guard.secure(target, 'file')
      await link(target, path.join(root, 'alias.json'))
      const refusal = await refusalOf(() => guard.verify())
      expect(refusal.reason).toBe('link')
    })
  })

  it('refuses to secure outside the root', async () => {
    await usingPrivateDir('m124-guard-scope-', async (data) => {
      const stray = path.join(data, 'stray.json')
      await writeFile(stray, '{}\n')
      const guard = connectorStorageGuard(path.join(data, CONNECTOR_FOLDER))
      const refusal = await refusalOf(() => guard.secure(stray, 'file'))
      expect(refusal.reason).toBe('scope')
    })
  })

  it('refuses to serve untrusted storage, silently on stdout', async () => {
    await usingPrivateDir('m124-guard-serve-', async (data) => {
      await plantLegacy(data)
      const root = path.join(data, CONNECTOR_FOLDER)
      const ran = await runEntry(data, root, [])
      expect(ran.exit).toBe(1)
      expect(ran.out).toBe('')
      expect(ran.err).toContain(root)
    })
  })

  it('reports the refusal instead of the grants on untrusted storage', async () => {
    await usingPrivateDir('m124-guard-status-', async (data) => {
      await plantLegacy(data)
      const root = path.join(data, CONNECTOR_FOLDER)
      const ran = await runEntry(data, root, ['status'])
      expect(ran.exit).toBe(1)
      expect(ran.out).toBe('')
      expect(ran.err).toContain(root)
    })
  })

  it('still narrows untrusted storage on revoke and kill', async () => {
    await usingPrivateDir('m124-guard-narrow-', async (data) => {
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
