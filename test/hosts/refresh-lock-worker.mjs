// The cross-surface refresh drill's child: the runtime side of the lock,
// run as a plain node script over an esbuild bundle of
// test/unit/refreshLockWorkerEntry.ts (built by
// test/unit/crossSurfaceRefreshLock.test.ts).
//
//   node test/hosts/refresh-lock-worker.mjs <bundle> contend <json>
//   node test/hosts/refresh-lock-worker.mjs <bundle> refresh <json>
//
// `contend` takes the runtime grant lock once and prints its outcome.
// `refresh` says `ready`, waits for `go`, refreshes the Grok grant in the
// shared file store, and reports what it did. No credentials, no service
// traffic: discovery is the recorded document and the token answer is a
// standard-OAuth shape with opaque placeholders.
import { once } from 'node:events'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const entry = require(process.argv[2])
const mode = process.argv[3]
const args = JSON.parse(process.argv[4])

function outcome(error) {
  return error instanceof Error ? error.message : 'unknown'
}

if (mode === 'contend') {
  const take = args.which === 'chatgpt' ? entry.withChatGptRefreshLock : entry.withGrokRefreshLock
  try {
    await take(
      async () => {
        console.log('worker-outcome:acquired')
      },
      { directory: args.directory, pipeName: args.pipeName, timeoutMs: args.timeoutMs },
    )
  } catch (error) {
    console.log(`worker-outcome:${outcome(error)}`)
  }
} else if (mode === 'refresh') {
  const calls = []
  const host = entry.createRuntimeGrokHost({
    secrets: entry.fileSecrets(args.storeFile),
    fetch: entry.drillFetch({
      discovery: args.discovery,
      discoveryUrl: args.discoveryUrl,
      tokenUrl: args.tokenUrl,
      seedRefreshToken: args.seedRefreshToken,
      tokenDelayMs: args.tokenDelayMs,
      calls,
    }),
    clientId: args.clientId,
    scopes: undefined,
    openBrowser: () => Promise.reject(new Error('no browser in this drill')),
    callbackText: () => 'unused',
    lock: { directory: args.lockDir, pipeName: args.pipeName, timeoutMs: args.timeoutMs },
  })
  const signIn = new entry.GrokSignIn(host)
  process.send('ready')
  await once(process, 'message')
  const tokenPosts = () =>
    calls.filter((call) => call.method === 'POST' && call.url === args.tokenUrl).length
  try {
    const token = await signIn.accessToken(args.requestUrl, args.minimumValidityMs)
    process.send({ token, tokenPosts: tokenPosts() })
  } catch (error) {
    process.send({ error: outcome(error), tokenPosts: tokenPosts() })
  }
  process.disconnect()
} else {
  console.error(`unknown worker mode: ${String(mode)}`)
  process.exitCode = 1
}
