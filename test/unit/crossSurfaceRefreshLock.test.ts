// One refresh lock for the editor and the CLI: the real editor lock and a
// real runtime child process meet on the same grant. Contention fails
// closed as lock-busy, and a refresh race rotates once while the loser
// reads the rotated grant instead of refreshing. Discovery is the recorded
// document and the token answer is a standard-OAuth shape with opaque
// placeholders that never leave the test; no live sign-in, no service
// traffic.
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { createGrokSignIn } from '../../src/host/providers/grokSignIn'
import {
  withEditorChatGptRefreshLock,
  withEditorGrokRefreshLock,
} from '../../src/host/providers/subscriptionRefreshLock'
import { withGrokRefreshLock } from '../../src/runtime/subscriptionRefreshLock'
import {
  CLIENT_ID,
  DISCOVERY_URL,
  discoveryEndpoints,
  discoveryFixture,
  discoveryOnlyFetch,
  type FetchCall,
} from './helpers/grokDiscoveryFetch'
import { grokGrantRecord } from './helpers/grokGrant'
import { mapSecrets } from './helpers/mapSecrets'
import { lockDirectory } from './helpers/temporaryFolders'
import { captureFailure } from './helpers/captureFailure'
import { drillFetch, fileSecrets } from './refreshLockWorkerEntry'

const GRANT_KEY = 'museSpark.provider.grok'
const REQUEST_URL = 'https://api.x.ai/v1/chat/completions'
/** The seeded refresh token the drill answers; an opaque placeholder. */
const SEED_REFRESH_TOKEN = 'drill-seed-refresh-token'
/** Windows pipes ignore the directory; one isolated name per test worker. */
const PIPE_NAME = `muse-spark-rlf-refreshlock-${String(process.pid)}`

/** The child process's refresh report, across the IPC boundary. */
const workerReportSchema = z.looseObject({
  token: z.optional(z.string()),
  error: z.optional(z.string()),
  tokenPosts: z.optional(z.number()),
})

/** The rotated grant the drill reads back; only the refreshed token matters. */
const storedGrantSchema = z.looseObject({ refreshToken: z.optional(z.string()) })

const scratch = { folder: '', bundle: '' }
beforeAll(async () => {
  const temp = path.resolve('temp')
  await mkdir(temp, { recursive: true })
  scratch.folder = await mkdtemp(path.join(temp, 'rlf-refreshlock-'))
  scratch.bundle = path.join(scratch.folder, 'worker.cjs')
  await build({
    entryPoints: [path.resolve('test/unit/refreshLockWorkerEntry.ts')],
    outfile: scratch.bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
})
afterAll(async () => {
  if (scratch.folder !== '') await rm(scratch.folder, { recursive: true, force: true })
})

function spawnWorker(mode: string, args: unknown, hasIpc: boolean): ChildProcess {
  return spawn(
    process.execPath,
    [
      path.resolve('test/hosts/refresh-lock-worker.mjs'),
      scratch.bundle,
      mode,
      JSON.stringify(args),
    ],
    {
      stdio: hasIpc ? ['ignore', 'ignore', 'inherit', 'ipc'] : ['ignore', 'pipe', 'inherit'],
      env: { SystemRoot: process.env['SystemRoot'], PATH: process.env['PATH'] },
    },
  )
}

function exited(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('refresh-lock worker did not exit'))
    }, 4000)
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

describe('one refresh lock for the editor and the CLI', () => {
  it.each([
    { which: 'chatgpt', hold: withEditorChatGptRefreshLock, busy: 'chatgpt.lock-busy' },
    { which: 'grok', hold: withEditorGrokRefreshLock, busy: 'grok.lock-busy' },
  ])(
    '$which: the runtime fails lock-busy while the editor holds the same grant lock',
    async ({ which, hold, busy }) => {
      const directory = await lockDirectory('rlf-refreshlock-')
      try {
        const { promise: entered, resolve: markEntered } = Promise.withResolvers<undefined>()
        const { promise: gate, resolve: release } = Promise.withResolvers<undefined>()
        const held = hold(
          async () => {
            markEntered(undefined)
            await gate
            return 'editor-held'
          },
          { directory, pipeName: PIPE_NAME, timeoutMs: 5000 },
        )
        await entered
        try {
          const child = spawnWorker(
            'contend',
            { which, directory, pipeName: PIPE_NAME, timeoutMs: 300 },
            false,
          )
          let output = ''
          child.stdout?.on('data', (chunk) => {
            output += String(chunk)
          })
          try {
            expect(await exited(child)).toBe(0)
            expect(output).toContain(`worker-outcome:${busy}`)
          } finally {
            child.kill()
          }
        } finally {
          release(undefined)
          await held
        }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  )

  it('grok: the editor and runtime meet on the production lock names', async () => {
    // No directory or pipe override: both sides build the production
    // rendezvous (folder plus person scope, then the file), so this is the
    // one test that proves the shared construction, not just the mechanism.
    // The Grok production lock has no other taker: xAI issued this app no
    // client id, so no person can hold it, and every other suite isolates
    // its own directory.
    const { promise: entered, resolve: markEntered } = Promise.withResolvers<undefined>()
    const { promise: gate, resolve: release } = Promise.withResolvers<undefined>()
    const held = withEditorGrokRefreshLock(
      async () => {
        markEntered(undefined)
        await gate
        return 'editor-held'
      },
      { timeoutMs: 5000 },
    )
    await entered
    try {
      const child = spawnWorker('contend', { which: 'grok', timeoutMs: 300 }, false)
      let output = ''
      child.stdout?.on('data', (chunk) => {
        output += String(chunk)
      })
      try {
        expect(await exited(child)).toBe(0)
        expect(output).toContain('worker-outcome:grok.lock-busy')
      } finally {
        child.kill()
      }
    } finally {
      release(undefined)
      await held
    }
  })

  it('grok: one refresh wins and the loser reads the rotated grant', async () => {
    const directory = await lockDirectory('rlf-refreshlock-')
    const storeFile = path.join(scratch.folder, `store-${String(process.pid)}.json`)
    const secrets = fileSecrets(storeFile)
    await secrets.store(
      GRANT_KEY,
      JSON.stringify(
        grokGrantRecord({ expiresAt: Date.now() - 1000, refreshToken: SEED_REFRESH_TOKEN }),
      ),
    )
    const calls: FetchCall[] = []
    const endpoints = discoveryEndpoints()
    const child = spawnWorker(
      'refresh',
      {
        storeFile,
        lockDir: directory,
        discovery: discoveryFixture(),
        discoveryUrl: DISCOVERY_URL,
        tokenUrl: endpoints.token,
        seedRefreshToken: SEED_REFRESH_TOKEN,
        tokenDelayMs: 500,
        clientId: CLIENT_ID,
        requestUrl: REQUEST_URL,
        minimumValidityMs: 60_000,
        timeoutMs: 4000,
        pipeName: PIPE_NAME,
      },
      true,
    )
    try {
      expect(await once(child, 'message')).toEqual(['ready', undefined])
      const signIn = createGrokSignIn({
        secrets: fileSecrets(storeFile),
        isRemote: false,
        clientId: CLIENT_ID,
        scopes: undefined,
        fetch: drillFetch({
          discovery: discoveryFixture(),
          discoveryUrl: DISCOVERY_URL,
          tokenUrl: endpoints.token,
          seedRefreshToken: SEED_REFRESH_TOKEN,
          tokenDelayMs: 500,
          calls,
        }),
        openExternal: () => Promise.reject(new Error('no browser in this drill')),
        log: () => undefined,
        lock: { directory, pipeName: PIPE_NAME, timeoutMs: 4000 },
      })
      const parentRun = signIn.accessToken(REQUEST_URL, 60_000)
      child.send('go')
      const [parentToken, received] = await Promise.all([parentRun, once(child, 'message')])
      const report = workerReportSchema.parse(received[0])
      expect(await exited(child)).toBe(0)
      expect(report.error).toBeUndefined()
      const parentPosts = calls.filter(
        (call) => call.method === 'POST' && call.url === endpoints.token,
      ).length
      // Exactly one refresh went out; the loser never posted.
      expect(parentPosts + (report.tokenPosts ?? 0)).toBe(1)
      // Both sides hold the winner's rotated access token.
      expect(report.token).toBe(parentToken)
      expect(parentToken).not.toBe('test-access-token-placeholder')
      const stored = await fileSecrets(storeFile).get(GRANT_KEY)
      expect(stored).toBeDefined()
      const storedRecord = storedGrantSchema.parse(JSON.parse(stored ?? '{}'))
      expect(storedRecord.refreshToken).not.toBe(SEED_REFRESH_TOKEN)
    } finally {
      child.kill()
      await rm(directory, { recursive: true, force: true })
      await rm(storeFile, { force: true })
    }
  })

  it('grok: the editor sign-in fails lock-busy on a runtime-held lock', async () => {
    const directory = await lockDirectory('rlf-refreshlock-')
    try {
      const { promise: entered, resolve: markEntered } = Promise.withResolvers<undefined>()
      const { promise: gate, resolve: release } = Promise.withResolvers<undefined>()
      const held = withGrokRefreshLock(
        async () => {
          markEntered(undefined)
          await gate
          return 'runtime-held'
        },
        { directory, pipeName: PIPE_NAME, timeoutMs: 5000 },
      )
      await entered
      try {
        const calls: FetchCall[] = []
        const signIn = createGrokSignIn({
          secrets: mapSecrets({ [GRANT_KEY]: JSON.stringify(grokGrantRecord()) }),
          isRemote: false,
          clientId: CLIENT_ID,
          scopes: undefined,
          fetch: discoveryOnlyFetch({ calls }),
          openExternal: () => Promise.resolve(true),
          log: () => undefined,
          lock: { directory, pipeName: PIPE_NAME, timeoutMs: 200 },
        })
        const failure = await captureFailure(() => signIn.accessToken(REQUEST_URL, 60_000))
        expect(failure).toMatchObject({ code: 'lock-busy' })
        expect(calls).toEqual([])
      } finally {
        release(undefined)
        await held
      }
      const calls: FetchCall[] = []
      const signIn = createGrokSignIn({
        secrets: mapSecrets({ [GRANT_KEY]: JSON.stringify(grokGrantRecord()) }),
        isRemote: false,
        clientId: CLIENT_ID,
        scopes: undefined,
        fetch: discoveryOnlyFetch({ calls }),
        openExternal: () => Promise.resolve(true),
        log: () => undefined,
        lock: { directory, pipeName: PIPE_NAME, timeoutMs: 2000 },
      })
      await expect(signIn.accessToken(REQUEST_URL, 60_000)).resolves.toBe(
        'test-access-token-placeholder',
      )
      expect(calls).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
