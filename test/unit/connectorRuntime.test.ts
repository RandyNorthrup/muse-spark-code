// M124 (D106): the connector's owner-only store and the owner's commands,
// through the real ConnectorStore on a real folder. (RVMSM124: this file
// once also tested the protocol, the stdio framer and the approval page
// against hand-written stand-ins — a fake ConnectorServer, an idle protocol
// and a spy that replaced ConnectorStore.grant. Those suites are deleted
// under the owner's testing rules; the protocol and framing are covered by
// connectorServe.test.ts and test/e2e/connectorStdio.e2e.test.ts against
// the real server, and the page by connectorServe.test.ts over loopback.)
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { CONNECTOR_LIMITS, CONNECTOR_SCHEMA_VERSION } from '../../src/shared/constants'
import type { ConnectorGrant } from '../../src/shared/connector'
import { SharedLimits } from '../../src/core/connector/policy'
import { parseConnectorCommand, runConnectorCommand } from '../../src/runtime/connector/command'
import { ConnectorStore } from '../../src/runtime/connector/store'

/** The awaited result's field (the lint rule forbids member access on an await). */
async function field<T extends object, K extends keyof T>(
  result: Promise<T>,
  key: K,
): Promise<T[K]> {
  const value = await result
  return value[key]
}

const folders: string[] = []
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})
async function folder(): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), 'm124-connector-'))
  folders.push(created)
  return created
}

/** A valid grant of `generation` for the default connection. */
function savedGrant(generation: number): ConnectorGrant {
  return {
    schemaVersion: CONNECTOR_SCHEMA_VERSION,
    connectionId: 'default',
    generation,
    createdAt: '2026-10-09T00:00:00.000Z',
    revoked: false,
    scopes: ['prompts:read'],
    userLibrary: true,
    paidCapMicrousd: 0,
    workspaces: [],
  }
}

/** A clock that never moves: limits spent stay spent. */
const fixedNow = () => Date.parse('2026-10-09T12:00:00.000Z')

describe('M124 owner-only store and commands', () => {
  it('grants nothing without a grant, fails the kill switch closed and keeps the audit bounded', async () => {
    const data = await folder()
    const store = new ConnectorStore(data)
    expect(await store.grant('default')).toBeUndefined()
    expect(await store.isKilled()).toBe(false)
    await mkdir(path.join(data, 'connector'), { recursive: true })
    await writeFile(path.join(data, 'connector', 'kill-switch.json'), 'not json')
    expect(await store.isKilled()).toBe(true)
    await store.setKilled(false, new Date().toISOString())
    expect(await store.isKilled()).toBe(false)
    await mkdir(path.join(data, 'connector', 'grants'), { recursive: true })
    await writeFile(
      path.join(data, 'connector', 'grants', 'default.json'),
      JSON.stringify({
        schemaVersion: CONNECTOR_SCHEMA_VERSION,
        connectionId: 'default',
        paidCapMicrousd: 5,
      }),
    )
    expect(await store.grant('default')).toBeUndefined()
    const audit = store.audit('default', Date.now)
    await audit.append('{"a":1}\n')
    const key = await audit.key()
    expect(key).toHaveLength(32)
    expect(await audit.key()).toEqual(key)
    expect(await readFile(path.join(data, 'connector', 'audit', 'default.jsonl'), 'utf8')).toBe(
      '{"a":1}\n',
    )
    if (process.platform !== 'win32')
      expect((await field(stat(path.join(data, 'connector', 'audit.key')), 'mode')) & 0o777).toBe(
        0o600,
      )
  })

  it('keeps the live authority current: another process’s revocation is seen (round 4 P1)', async () => {
    const data = await folder()
    const store = new ConnectorStore(data)
    await store.saveGrant(savedGrant(1))
    const authority = store.authority('default')
    // Switched off until its first reading (fail closed).
    expect(authority.current()).toEqual({ grant: undefined, killed: true })
    let changes = 0
    const stop = authority.watch(() => {
      changes += 1
    })
    try {
      await authority.refresh()
      expect(authority.current()).toMatchObject({ killed: false, grant: { generation: 1 } })
      // The owner's `mcp revoke`, in another process, rewrites the grant: the watch reads it.
      await new ConnectorStore(data).saveGrant({ ...savedGrant(2), revoked: true })
      // The watch may take a moment to deliver: read until it has, within 3 seconds.
      const deadline = Date.now() + 3000
      while (authority.current().grant?.revoked !== true && Date.now() < deadline) await sleep(25)
      expect(authority.current().grant?.revoked).toBe(true)
      expect(changes).toBeGreaterThan(0)
    } finally {
      stop()
    }
  })

  // Deleted by RVMSM124: 'drops an authority reading that finishes after a
  // newer one' replaced ConnectorStore.grant with a spy to stage the race;
  // no real file staging can hold one reading open, so the case is covered
  // only by the store's reading-number drop in authority() itself.

  it('keeps the limits of one grant across server processes and restarts (RVM124 P2-7)', async () => {
    const data = await folder()
    // Two stores on one folder stand for two server processes: no memory is shared.
    // A fixed clock: no token refills while twenty updates take turns at the lock.
    const first = new SharedLimits(new ConnectorStore(data).limits('default'), fixedNow)
    const second = new SharedLimits(new ConnectorStore(data).limits('default'), fixedNow)
    const taken = await Promise.all(
      Array.from({ length: 2 * CONNECTOR_LIMITS.burst }, (_, index) =>
        (index % 2 === 0 ? first : second).take(),
      ),
    )
    expect(taken.filter(Boolean)).toHaveLength(CONNECTOR_LIMITS.burst)
    const restarted = new SharedLimits(new ConnectorStore(data).limits('default'), fixedNow)
    expect(await restarted.take()).toBe(false)
  })

  it('parses only its own words and needs a terminal confirmation to widen authority', async () => {
    expect(parseConnectorCommand([])).toEqual({ kind: 'serve', connectionId: 'default' })
    expect(parseConnectorCommand(['--connection', 'codex'])).toEqual({
      kind: 'serve',
      connectionId: 'codex',
    })
    expect(parseConnectorCommand(['--workspace', '.'])).toBeUndefined()
    expect(parseConnectorCommand(['grant'])).toBeUndefined()
    expect(parseConnectorCommand(['kill', '--key', 'sk-secret'])).toBeUndefined()
    expect(parseConnectorCommand(['--help'])).toEqual({ kind: 'usage' })
    expect(parseConnectorCommand(['grant', '--help'])).toEqual({ kind: 'usage' })
    // The connection name becomes store file paths: a traversal name never parses.
    expect(parseConnectorCommand(['--connection', '../evil'])).toBeUndefined()
    expect(parseConnectorCommand(['revoke', '--connection', String.raw`..\evil`])).toBeUndefined()
    expect(parseConnectorCommand(['--connection', 'a/b'])).toBeUndefined()
    const data = await folder()
    const store = new ConnectorStore(data)
    const printed: string[] = []
    let confirms = 0
    const io = {
      isInteractive: false,
      now: Date.now,
      print: (line: string) => {
        printed.push(line)
      },
      printError: (line: string) => {
        printed.push(line)
      },
      confirm: () => {
        confirms += 1
        return Promise.resolve(true)
      },
    }
    const grant = parseConnectorCommand(['grant', '--workspace', data])
    if (grant?.kind !== 'grant') throw new Error('grant parse')
    expect(await runConnectorCommand(store, grant, io)).toBe(1)
    expect(confirms).toBe(0)
    expect(await store.grant('default')).toBeUndefined()
    const interactive = { ...io, isInteractive: true }
    const paid = parseConnectorCommand(['grant', '--workspace', data, '--scope', 'paid:request'])
    if (paid?.kind !== 'grant') throw new Error('paid parse')
    expect(await runConnectorCommand(store, paid, interactive)).toBe(2)
    expect(await runConnectorCommand(store, grant, interactive)).toBe(0)
    const saved = await store.grant('default')
    expect(saved?.scopes).toContain('control:stop')
    expect(saved?.scopes).not.toContain('content:read')
    expect(saved?.paidCapMicrousd).toBe(0)
    expect(await runConnectorCommand(store, { kind: 'revoke', connectionId: 'default' }, io)).toBe(
      0,
    )
    const revoked = await store.grant('default')
    expect(revoked?.revoked).toBe(true)
    expect(await runConnectorCommand(store, { kind: 'kill' }, io)).toBe(0)
    expect(await store.isKilled()).toBe(true)
    // Re-enabling widens authority: refused without a terminal.
    expect(await runConnectorCommand(store, { kind: 'resume' }, io)).toBe(1)
    expect(await store.isKilled()).toBe(true)
    expect(await runConnectorCommand(store, { kind: 'resume' }, interactive)).toBe(0)
    // Every owner command that changed something left its control receipt (RVM124B P2-4).
    const controls = async (journal: string) => {
      const text = await readFile(path.join(data, 'connector', 'audit', `${journal}.jsonl`), 'utf8')
      return text
        .split('\n')
        .filter(Boolean)
        .map(
          (line) =>
            JSON.parse(line) as { event: string; control?: string; grantGeneration?: number },
        )
    }
    expect(await controls('default')).toEqual([
      expect.objectContaining({ event: 'control', control: 'grant', grantGeneration: 1 }),
      expect.objectContaining({ event: 'control', control: 'revoke', grantGeneration: 2 }),
    ])
    const owner = await controls('_owner')
    expect(owner.map((record) => record.control)).toEqual(['kill', 'resume'])
  })
})
