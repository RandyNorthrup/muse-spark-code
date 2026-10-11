// Standalone native-store certification: synthetic grants, isolated service,
// real separate processes. Never opens an existing application's credential.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { AsyncEntry } from '@napi-rs/keyring'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SCRIPT = fileURLToPath(import.meta.url)
const require = createRequire(import.meta.url)
const RECORD = 'museSpark.provider.chatgpt'
const HOST = `${RECORD}.host-id`
const ISSUER = 'https://auth.openai.com'

function store(bundle, service) {
  const { keyringSecretStore } = require(bundle)
  return keyringSecretStore(
    (_service, account) =>
      new AsyncEntry(service, account, {
        linux: { store: 'secret-service' },
      }),
  )
}

function fakeFetch(tally) {
  return async (input) => {
    const url = String(input)
    if (url.endsWith('/.well-known/openid-configuration'))
      return globalThis.Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/api/accounts/authorize`,
        token_endpoint: `${ISSUER}/api/accounts/oauth/token`,
        revocation_endpoint: `${ISSUER}/api/accounts/oauth/revoke`,
        jwks_uri: `${ISSUER}/synthetic-jwks`,
      })
    assert.ok(url.endsWith('/token'))
    await appendFile(tally, 'refresh\n')
    return globalThis.Response.json({
      access_token: 'synthetic-native-access',
      refresh_token: 'synthetic-native-refresh',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'chatgpt.tokens.use.direct',
    })
  }
}

async function worker(bundle, service, tally) {
  const { createRuntimeChatGptHost, ChatGptSignIn } = require(bundle)
  const host = await createRuntimeChatGptHost({
    secrets: store(bundle, service),
    fetch: fakeFetch(tally),
    openBrowser: async () => {
      throw new Error('unexpected browser')
    },
    callbackText: () => '',
  })
  await new ChatGptSignIn(host).accessToken('https://api.openai.com/v1/responses', 1000)
  process.stdout.write('ok\n')
}

async function certify() {
  const scratch = path.join(ROOT, 'temp')
  await mkdir(scratch, { recursive: true })
  const folder = await mkdtemp(path.join(scratch, 'm95b-x-native-'))
  const bundle = path.join(folder, 'runtime.cjs')
  const tally = path.join(folder, 'refresh-count.txt')
  const service = `Muse Spark Code (Unofficial) native test ${randomUUID()}`
  let secrets
  let canUseStore = false
  try {
    await build({
      stdin: {
        contents:
          "export { createRuntimeChatGptHost } from './src/runtime/chatGptHost'; export { ChatGptSignIn } from './src/core/providers/subscriptions/chatgpt'; export { keyringSecretStore } from './src/runtime/keyStore'",
        resolveDir: ROOT,
      },
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'cjs',
    })
    const { createRuntimeChatGptHost } = require(bundle)
    secrets = store(bundle, service)
    // Probe only the fresh synthetic entry, so the platform failure remains
    // visible even though the production host correctly withholds its text.
    assert.equal(await secrets.get(HOST), undefined)
    canUseStore = true
    const host = await createRuntimeChatGptHost({
      secrets,
      fetch: fakeFetch(tally),
      openBrowser: async () => {
        throw new Error('unexpected browser')
      },
      callbackText: () => '',
    })
    await host.writeRecord({
      v: 1,
      auth: 'subscription',
      origin: 'https://api.openai.com',
      issuer: ISSUER,
      clientId: 'oaiapp_synthetic',
      hostId: host.hostId,
      accessToken: 'synthetic-expired-native',
      refreshToken: 'synthetic-initial-native',
      expiresAt: Date.now() - 1,
      scope: 'chatgpt.tokens.use.direct',
      nonce: 'synthetic_nonce_123456789',
    })
    const run = promisify(execFile)
    const results = await Promise.all(
      [0, 1].map(() =>
        run(process.execPath, [SCRIPT, 'worker', bundle, service, tally], {
          timeout: 120_000,
          env: { SystemRoot: process.env['SystemRoot'], PATH: process.env['PATH'] },
        }),
      ),
    )
    assert.deepEqual(
      results.map((result) => result.stdout),
      ['ok\n', 'ok\n'],
    )
    assert.equal(await readFile(tally, 'utf8'), 'refresh\n')
    const stored = await host.readRecord()
    assert.equal(stored.refreshToken, 'synthetic-native-refresh')
    await host.deleteRecord()
    assert.equal(await host.readRecord(), undefined)
    process.stdout.write(
      'Native OS store: persisted, rotated once across two processes, deleted; synthetic isolated entries only.\n',
    )
  } finally {
    const cleared =
      secrets === undefined
        ? []
        : await Promise.allSettled([secrets.delete(RECORD), secrets.delete(HOST)])
    await rm(folder, { recursive: true, force: true })
    if (canUseStore) {
      for (const result of cleared)
        assert.equal(result.status, 'fulfilled', 'synthetic OS-store cleanup failed')
    }
  }
}

if (process.argv[2] === 'worker') await worker(...process.argv.slice(3))
else await certify()
