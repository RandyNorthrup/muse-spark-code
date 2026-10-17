// RVCM952D regression: one owner for a provider credential. The lease, the
// journal, the recovery comparison and the interleavings, with two real
// store facades over one backing map and the real file lease. No model or
// vendor call of any kind.
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { trackTempRoots } from './helpers/tempRoots'
import { collectPrinted } from './helpers/collectPrinted'
import {
  acquireCredentialLock,
  CredentialLockBusyError,
  credentialLockDir,
  formatCredentialJournal,
  parseCredentialJournal,
  recoverCredentialJournal,
} from '../../src/core/credentialLease'
import { emptyProvidersFile } from '../../src/core/providers/providersFile'
import { storedCredentialId } from '../../src/host/providers/credentialRecords'
import { recoverOpenRouterConnect } from '../../src/host/models/modelsPanelBundle'
import type { Logger } from '../../src/host/logger'
import type { SecretStore } from '../../src/host/auth/credentialStore'
import type { AuthCommandDeps } from '../../src/runtime/authCommands'
import {
  runAuthClearProvider,
  runAuthSetProvider,
  runAuthStatusProvider,
} from '../../src/runtime/providerAuth'
import { formatStoredProviderSecret } from '../../src/runtime/keyStore'
import { runOpenRouterConnect } from '../../src/runtime/openRouterCommands'
import { userFileIo, type ProvidersDeps } from '../../src/runtime/providersCommands'
import { PROVIDER_SECRET_PREFIX, UI_TEXT } from '../../src/shared/constants'
import { openRouterDiscardedKeyNotice } from '../../src/host/backend/providersEntry'

const ORIGIN = 'https://openrouter.ai'
const ACCOUNT = `${PROVIDER_SECRET_PREFIX}openrouter`
const STAGING = `${ACCOUNT}.connect`
// Built from fragments so the file holds no secret-shaped literal: the
// production key shape (prefix plus minimum length) still applies.
const syntheticKey = (tag: string): string => `sk-or-${tag}-synthetic-credential-0001`
const PREVIOUS = formatStoredProviderSecret(
  { v: 1, auth: 'apiKey', origin: ORIGIN },
  syntheticKey('previous'),
)
const ROTATED_KEY = syntheticKey('rotated')
const CONNECT_KEY = syntheticKey('connect')

const { roots } = trackTempRoots()

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'cm952r5-'))
  roots.push(root)
  return root
}

/** Two real facades over one backing map: two processes, one credential store. */
function collect(into: string[]): (line: string) => void {
  return (line) => {
    into.push(line)
  }
}

const ignoreLine = (): undefined => undefined

function silentLog(): Logger {
  return { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

const readEmptyUserFile: ProvidersDeps['readUserFile'] = () =>
  Promise.resolve({ ok: true as const, file: emptyProvidersFile() })

function twinSecrets() {
  const backing = new Map<string, string>()
  const facade = () => ({
    get: (key: string): Promise<string | undefined> => Promise.resolve(backing.get(key)),
    store: (key: string, value: string): Promise<void> => {
      backing.set(key, value)
      return Promise.resolve()
    },
    delete: (key: string): Promise<void> => {
      backing.delete(key)
      return Promise.resolve()
    },
  })
  return { backing, a: facade(), b: facade() }
}

function connectDeps(
  secrets: ProvidersDeps['secrets'],
  lock: NonNullable<ProvidersDeps['withUserFileLock']>,
  parts: Partial<ProvidersDeps> = {},
): { deps: ProvidersDeps; printed: string[]; errors: string[] } {
  const { printed, errors, print, printError } = collectPrinted()
  const deps: ProvidersDeps = {
    secrets,
    fetch: vi.fn(),
    resolveHost: () => Promise.resolve(['8.8.8.8']),
    readSecret: (prompt) =>
      Promise.resolve(prompt === UI_TEXT.providerConnectReplaceKey ? 'yes' : 'synthetic-code'),
    print,
    printError,
    readUserFile: readEmptyUserFile,
    writeUserFile: () => Promise.resolve(true),
    withUserFileLock: lock,
    ...parts,
  }
  return { deps, printed, errors }
}

function authBase(
  secrets: AuthCommandDeps['secrets'],
  parts: Partial<AuthCommandDeps> = {},
): { deps: AuthCommandDeps; printed: string[]; errors: string[] } {
  const printed: string[] = []
  const errors: string[] = []
  return {
    deps: {
      secrets,
      storeName: 'test store',
      readSecret: () => Promise.resolve(ROTATED_KEY),
      print: (line) => {
        printed.push(line)
      },
      printError: (line) => {
        errors.push(line)
      },
      ...parts,
    },
    printed,
    errors,
  }
}

const readUserFile: ProvidersDeps['readUserFile'] = () =>
  Promise.resolve({ ok: true as const, file: emptyProvidersFile() })

describe('credential lease', () => {
  it('refuses a second holder while the owner lives, and its own re-entry', async () => {
    const root = await tempRoot()
    const lock = credentialLockDir(path.join(root, 'providers.json'))
    const release = await acquireCredentialLock(lock)
    try {
      await expect(acquireCredentialLock(lock)).rejects.toBeInstanceOf(CredentialLockBusyError)
    } finally {
      await release()
    }
    // Released: the next acquire wins.
    const again = await acquireCredentialLock(lock)
    await again()
  })

  it('reclaims a lock whose owner is proven gone, never a live one', async () => {
    const root = await tempRoot()
    const lock = credentialLockDir(path.join(root, 'providers.json'))
    // A crashed holder's owner file, never released.
    await acquireCredentialLock(lock, {
      pid: 1,
      startTime: 1,
      nonce: () => 'crashed-attempt',
    })
    const release = await acquireCredentialLock(lock, { isProcessAlive: () => false })
    await release()
    // A live holder is never stolen.
    const live = await acquireCredentialLock(lock)
    try {
      await expect(
        acquireCredentialLock(lock, { isProcessAlive: () => true }),
      ).rejects.toBeInstanceOf(CredentialLockBusyError)
    } finally {
      await live()
    }
  })

  it('reclaims a real crashed process holding the commit (child killed inside)', async () => {
    const root = await tempRoot()
    const lock = credentialLockDir(path.join(root, 'providers.json'))
    const signalFile = path.join(root, 'held')
    const lease = path.join(process.cwd(), 'src/core/credentialLease.ts')
    const entryTs = path.join(root, 'child-lock.ts')
    const entryJs = path.join(root, 'child-lock.mjs')
    await writeFile(
      entryTs,
      `import { acquireCredentialLock } from ${JSON.stringify(lease)}\n` +
        `import { writeFile } from 'node:fs/promises'\n` +
        `const release = await acquireCredentialLock(process.argv[2])\n` +
        `void release\n` +
        `await writeFile(process.argv[3], 'held')\n` +
        `await new Promise(() => {})\n`,
    )
    // The child runs the real lease: bundle the module the way the build does.
    const { buildSync } = await import('esbuild')
    buildSync({
      entryPoints: [entryTs],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: entryJs,
      logLevel: 'silent',
    })
    const child = spawn(process.execPath, [entryJs, lock, signalFile], {
      stdio: 'ignore',
    })
    try {
      await vi.waitFor(
        async () => {
          const { readFile } = await import('node:fs/promises')
          expect(await readFile(signalFile, 'utf8')).toBe('held')
        },
        { timeout: 20_000, interval: 200 },
      )
      // The crash: killed inside the hold, past every finally/rmdir.
      child.kill('SIGKILL')
      // The next attempt takes over the surviving lock directory, and only
      // once the owner is proven gone.
      let release!: () => Promise<void>
      await vi.waitFor(
        async () => {
          release = await acquireCredentialLock(lock)
        },
        { timeout: 20_000, interval: 200 },
      )
      await release()
    } finally {
      child.kill('SIGKILL')
    }
    // Named timeout: bundling plus a real process spawn, kill and takeover.
  }, 30_000)
})

function formatTestJournal(
  phase: 'started' | 'staged',
  previous: string | null,
  next: string | null,
): string {
  return formatCredentialJournal({ v: 1, phase, previous, next })
}

async function tempLock(): Promise<NonNullable<ProvidersDeps['withUserFileLock']>> {
  // The production lock both bundles share: the directory beside the
  // providers file. A second holder finds EEXIST, which the commands map
  // to the busy message.
  const root = await tempRoot()
  return userFileIo(path.join(root, 'providers.json')).withUserFileLock
}

function exchangeGate(): { exchange: () => Promise<string>; release: (key: string) => void } {
  const gate = Promise.withResolvers<string>()
  return {
    exchange: () => gate.promise,
    release: gate.resolve,
  }
}

async function waitForJournal(backing: Map<string, string>): Promise<void> {
  await vi.waitFor(() => {
    expect(backing.has(STAGING)).toBe(true)
  })
}

describe('journal recovery comparison', () => {
  const NEW = formatStoredProviderSecret({ v: 1, auth: 'apiKey', origin: ORIGIN }, CONNECT_KEY)

  it('finds nothing when the slot is empty', async () => {
    const { a } = twinSecrets()
    expect(await recoverCredentialJournal(a, ACCOUNT, STAGING)).toEqual({
      decision: { kind: 'none' },
      journalKept: false,
    })
  })

  it('commits when the primary already holds the staged record', async () => {
    const { a } = twinSecrets()
    await a.store(ACCOUNT, NEW)
    await a.store(STAGING, formatTestJournal('staged', PREVIOUS, NEW))
    expect(await recoverCredentialJournal(a, ACCOUNT, STAGING)).toEqual({
      decision: { kind: 'committed' },
      journalKept: false,
    })
    expect(await a.get(STAGING)).toBeUndefined()
  })

  it.each([
    ['staged with previous intact', formatTestJournal('staged', PREVIOUS, NEW), PREVIOUS],
    ['staged with no previous and no primary', formatTestJournal('staged', null, NEW), undefined],
    ['bare intent with previous intact', formatTestJournal('started', PREVIOUS, null), PREVIOUS],
    ['bare intent with nothing stored', formatTestJournal('started', null, null), undefined],
  ])('discards %s: the created key was not kept', async (_name, staged, primary) => {
    const { a } = twinSecrets()
    if (primary !== undefined) await a.store(ACCOUNT, primary)
    await a.store(STAGING, staged)
    expect(await recoverCredentialJournal(a, ACCOUNT, STAGING)).toEqual({
      decision: expect.objectContaining({ kind: 'discarded' }),
      journalKept: false,
    })
    expect(await a.get(STAGING)).toBeUndefined()
  })

  it('drops a stale intent silently when someone else stored meanwhile', async () => {
    const { a } = twinSecrets()
    const other = formatStoredProviderSecret(
      { v: 1, auth: 'apiKey', origin: ORIGIN },
      syntheticKey('other'),
    )
    await a.store(ACCOUNT, other)
    await a.store(STAGING, formatTestJournal('started', PREVIOUS, null))
    expect(await recoverCredentialJournal(a, ACCOUNT, STAGING)).toEqual({
      decision: { kind: 'stale' },
      journalKept: false,
    })
  })

  it('reports a legacy raw record instead of absorbing it', async () => {
    const { a } = twinSecrets()
    await a.store(ACCOUNT, PREVIOUS)
    await a.store(STAGING, PREVIOUS)
    expect(await recoverCredentialJournal(a, ACCOUNT, STAGING)).toEqual({
      decision: { kind: 'legacy' },
      journalKept: false,
    })
  })

  it('keeps the journal when its delete is refused', async () => {
    const { a, backing } = twinSecrets()
    await a.store(ACCOUNT, PREVIOUS)
    const staged = formatTestJournal('staged', PREVIOUS, NEW)
    await a.store(STAGING, staged)
    const refusing = {
      ...a,
      delete: () => Promise.reject(new Error('store-unavailable')),
    }
    expect(await recoverCredentialJournal(refusing, ACCOUNT, STAGING)).toEqual({
      decision: expect.objectContaining({ kind: 'discarded' }),
      journalKept: true,
    })
    expect(backing.get(STAGING)).toBe(staged)
  })

  it('fails when the journal cannot be read', async () => {
    const broken = {
      get: () => Promise.reject<string | undefined>(new Error('store-unavailable')),
      delete: () => Promise.resolve(),
    }
    await expect(recoverCredentialJournal(broken, ACCOUNT, STAGING)).rejects.toThrow()
  })
})

/** A connect paused at its journal write, with the lease held open. */
async function beginConnectRace() {
  const { a, b, backing } = twinSecrets()
  await a.store(ACCOUNT, PREVIOUS)
  const withLock = await tempLock()
  const gate = exchangeGate()
  const A = connectDeps(a, withLock)
  const connecting = runOpenRouterConnect(A.deps, {
    openRouterExchange: gate.exchange,
    openRouterUsage: () => Promise.reject(new Error('unused')),
  })
  await waitForJournal(backing)
  return { a, b, backing, withLock, gate, A, connecting }
}

/** A connect whose exchange answers at once and whose usage probe is unused. */
function directConnectApi(): Parameters<typeof runOpenRouterConnect>[1] {
  return {
    openRouterExchange: () => Promise.resolve(CONNECT_KEY),
    openRouterUsage: () => Promise.reject(new Error('unused')),
  }
}

describe('one transaction across two facades', () => {
  it('a rotation attempted mid-connect is refused, never overwritten', async () => {
    const { a, b, backing, withLock, gate, connecting } = await beginConnectRace()
    const B = authBase(b)
    // The second writer runs the real command between the final read and
    // the primary write: the lease refuses it.
    expect(await runAuthSetProvider(B.deps, 'openrouter', readUserFile, withLock)).toBe(1)
    expect(B.errors).toContain(UI_TEXT.providerConnectBusy)
    expect(backing.get(ACCOUNT)).toBe(PREVIOUS)
    gate.release(CONNECT_KEY)
    expect(await connecting).toBe(0)
    // Serialized after: the rotation lands on the connected key, loudly.
    const retry = authBase(b)
    expect(await runAuthSetProvider(retry.deps, 'openrouter', readUserFile, withLock)).toBe(0)
    expect(backing.get(ACCOUNT)).toContain(ROTATED_KEY)
    expect(await a.get(STAGING)).toBeUndefined()
  })

  it('a removal attempted mid-connect is refused, never resurrected', async () => {
    const { a, b, backing, withLock, gate, connecting } = await beginConnectRace()
    const B = authBase(b)
    expect(await runAuthClearProvider(B.deps, 'openrouter', withLock)).toBe(1)
    expect(backing.get(ACCOUNT)).toBe(PREVIOUS)
    gate.release(CONNECT_KEY)
    expect(await connecting).toBe(0)
    const cleared = authBase(b)
    expect(await runAuthClearProvider(cleared.deps, 'openrouter', withLock)).toBe(0)
    expect(backing.get(ACCOUNT)).toBeUndefined()
    // A connect that fails after a removal leaves the absence alone.
    const failing = connectDeps(a, withLock, {
      secrets: {
        ...a,
        store: (key: string, value: string) =>
          key === ACCOUNT ? Promise.reject(new Error('store-unavailable')) : a.store(key, value),
      },
    })
    expect(await runOpenRouterConnect(failing.deps, directConnectApi())).toBe(1)
    expect(backing.get(ACCOUNT)).toBeUndefined()
  })

  it('status during a live attempt reads through and leaves its journal alone', async () => {
    const { b, backing, withLock, gate, connecting } = await beginConnectRace()
    const journal = backing.get(STAGING)
    expect(journal).toBeDefined()
    const S = authBase(b)
    // Busy lease: the reader reports from the primary, no recovery, no fail.
    expect(await runAuthStatusProvider(S.deps, 'openrouter', withLock)).toBe(0)
    expect(S.errors).not.toContain(openRouterDiscardedKeyNotice())
    expect(backing.get(STAGING)).toBe(journal)
    gate.release(CONNECT_KEY)
    expect(await connecting).toBe(0)
  })

  it('a refused rollback keeps the journal and says the new key is stored', async () => {
    const { backing } = twinSecrets()
    backing.set(ACCOUNT, PREVIOUS)
    const withLock = await tempLock()
    let gets = 0
    const secrets = {
      // The fifth read is the post-write verification: it sees a conflict
      // while every other read is honest.
      get: (key: string): Promise<string | undefined> => {
        gets += 1
        return gets === 5 ? Promise.resolve('tampered') : Promise.resolve(backing.get(key))
      },
      store: (key: string, value: string) => {
        // The rollback's restore is refused.
        if (key === ACCOUNT && value === PREVIOUS)
          return Promise.reject(new Error('store-unavailable'))
        backing.set(key, value)
        return Promise.resolve()
      },
      delete: (key: string) => {
        backing.delete(key)
        return Promise.resolve()
      },
    }
    const A = connectDeps(secrets, withLock)
    expect(await runOpenRouterConnect(A.deps, directConnectApi())).toBe(1)
    // The verified primary write stands; the only copy of the previous
    // record stays in the kept journal; the sentence says what is stored.
    expect(backing.get(ACCOUNT)).toContain(CONNECT_KEY)
    const staged = backing.get(STAGING)
    expect(staged).toBeDefined()
    const journal = parseCredentialJournal(JSON.parse(staged ?? ''))
    expect(journal?.previous).toBe(PREVIOUS)
    expect(journal?.next).toContain(CONNECT_KEY)
    expect(A.errors).toContain(UI_TEXT.providerConnectStoredNewKey)
    expect(A.errors).not.toContain(openRouterDiscardedKeyNotice())
  })

  it('a committed journal never suggests removing the key in use', async () => {
    const { a, b } = twinSecrets()
    const next = formatStoredProviderSecret({ v: 1, auth: 'apiKey', origin: ORIGIN }, CONNECT_KEY)
    await a.store(ACCOUNT, next)
    await a.store(
      STAGING,
      formatCredentialJournal({ v: 1, phase: 'staged', previous: PREVIOUS, next }),
    )
    const withLock = await tempLock()
    const S = authBase(b)
    expect(await runAuthStatusProvider(S.deps, 'openrouter', withLock)).toBe(0)
    expect(S.errors).not.toContain(openRouterDiscardedKeyNotice())
    expect(S.printed).toContain(UI_TEXT.providerConnectRecoveredStored)
    expect(await a.get(STAGING)).toBeUndefined()
  })

  it('a refused recovery cleanup still says the known notice first', async () => {
    const { a, b, backing } = twinSecrets()
    await a.store(ACCOUNT, PREVIOUS)
    const staged = formatCredentialJournal({
      v: 1,
      phase: 'staged',
      previous: PREVIOUS,
      next: formatStoredProviderSecret({ v: 1, auth: 'apiKey', origin: ORIGIN }, CONNECT_KEY),
    })
    await a.store(STAGING, staged)
    const withLock = await tempLock()
    const refusing = {
      ...a,
      delete: (key: string) =>
        key === STAGING ? Promise.reject(new Error('store-unavailable')) : a.delete(key),
    }
    const S = authBase(b)
    expect(
      await runAuthStatusProvider({ ...S.deps, secrets: refusing }, 'openrouter', withLock),
    ).toBe(1)
    // Produced from the record read, before the cleanup that refused.
    expect(S.errors).toContain(openRouterDiscardedKeyNotice())
    expect(backing.get(STAGING)).toBe(staged)
  })

  it('a crashed connect is found by status without connecting again', async () => {
    const { a, b } = twinSecrets()
    const withLock = await tempLock()
    // The pasted code is empty: the exchange never runs, as after a crash
    // before it.
    const A = connectDeps(a, withLock, {
      readSecret: (prompt) =>
        Promise.resolve(prompt === UI_TEXT.providerConnectReplaceKey ? 'yes' : ''),
    })
    expect(
      await runOpenRouterConnect(A.deps, {
        openRouterExchange: () => Promise.resolve(CONNECT_KEY),
        openRouterUsage: () => Promise.reject(new Error('unused')),
      }),
    ).toBe(1)
    // The durable intent, without any secret, survives the failed exchange.
    const staged = await a.get(STAGING)
    expect(parseCredentialJournal(JSON.parse(staged ?? ''))?.phase).toBe('started')
    const S = authBase(b)
    expect(await runAuthStatusProvider(S.deps, 'openrouter', withLock)).toBe(1)
    expect(S.errors).toContain(openRouterDiscardedKeyNotice())
    expect(await a.get(STAGING)).toBeUndefined()
    expect(await a.get(ACCOUNT)).toBeUndefined()
  })
})

/** A crash-start recovery with its warning and information lines collected. */
async function recoverWithReports(
  secrets: SecretStore,
  log: Logger,
  lock: {
    readonly withCredentialLock: <T>(operation: () => Promise<T>) => Promise<T>
  },
): Promise<{ warnings: string[]; infos: string[] }> {
  const warnings: string[] = []
  const infos: string[] = []
  await recoverOpenRouterConnect(secrets, collect(warnings), collect(infos), log, lock)
  return { warnings, infos }
}

describe('first start after the crash', () => {
  const freeLock = {
    withCredentialLock: async <T>(operation: () => Promise<T>): Promise<T> => await operation(),
  }

  it('reports a discarded journal with its label and page, then cleans it', async () => {
    const { a } = twinSecrets()
    const crashed = formatStoredProviderSecret(
      { v: 1, auth: 'apiKey', origin: ORIGIN },
      'crashed-synthetic-key',
    )
    await a.store(STAGING, formatTestJournal('staged', null, crashed))
    const { warnings, infos } = await recoverWithReports(a, silentLog(), freeLock)
    expect(warnings).toEqual([openRouterDiscardedKeyNotice()])
    expect(infos).toEqual([])
    expect(await a.get(STAGING)).toBeUndefined()
  })

  it('reports a committed journal as the key in use, never a removal', async () => {
    const { a } = twinSecrets()
    const next = formatStoredProviderSecret(
      { v: 1, auth: 'apiKey', origin: ORIGIN },
      'crashed-synthetic-key',
    )
    await a.store(ACCOUNT, next)
    await a.store(STAGING, formatTestJournal('staged', null, next))
    const { warnings, infos } = await recoverWithReports(a, silentLog(), freeLock)
    expect(warnings).toEqual([])
    expect(infos).toEqual([UI_TEXT.providerConnectRecoveredStored])
    expect(await a.get(STAGING)).toBeUndefined()
  })

  it('stays silent without a journal', async () => {
    const { a } = twinSecrets()
    const log = silentLog()
    const { warnings, infos } = await recoverWithReports(a, log, freeLock)
    expect(warnings).toEqual([])
    expect(infos).toEqual([])
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('leaves a live attempt journal alone when the lease is held', async () => {
    const { a } = twinSecrets()
    const staged = formatTestJournal('started', null, null)
    await a.store(STAGING, staged)
    const warnings: string[] = []
    const log = silentLog()
    await recoverOpenRouterConnect(a, collect(warnings), ignoreLine, log, {
      withCredentialLock: () => Promise.reject(new CredentialLockBusyError('live')),
    })
    expect(warnings).toEqual([])
    expect(await a.get(STAGING)).toBe(staged)
  })
})

describe('credential identity on an unreadable store', () => {
  it('an unreadable credential store hides the identity like the runtime adapter', async () => {
    const broken = {
      get: () => Promise.reject<string | undefined>(new Error('locked')),
      store: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    }
    await expect(storedCredentialId(broken, 'openrouter')).resolves.toBeUndefined()
  })
})
