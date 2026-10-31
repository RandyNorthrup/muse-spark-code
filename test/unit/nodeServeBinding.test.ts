// The A1/M104 serve binding over the real wire: serve prints the full
// fingerprint and answers, the guards refuse (no verifier, a wrong bearer, a
// proof bound to another digest), and the method port runs what its peers
// provide while naming what is still open. Every exchange here goes over
// real HTTPS against a real serve; the passkey ceremonies use an emulated
// authenticator whose signatures and RP/origin/challenge fields the pinned
// verifier checks for real.
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, createSign, randomBytes, X509Certificate } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import type { Duplex } from 'node:stream'
import { expect } from 'vitest'
import { isoCBOR } from '@simplewebauthn/server/helpers'
import {
  NODE_KEYS_FILE,
  NODE_LOCK_FILE,
  NODE_TLS_CERT_FILE,
  NODE_TLS_DIRECTORY,
  NODE_ZERO_DIGEST,
  UI_TEXT,
} from '../../src/shared/constants'
import { nodeMethods } from '../../src/shared/hostApi/nodeMethods'
import {
  nodeAuthenticationSchema,
  nodeAuthChallengeSchema,
  nodeStepUpSchema,
  type NodeAuthentication,
  type NodeAuthChallenge,
} from '../../src/shared/nodeAuth'
import { nodeDashboardSchema } from '../../src/shared/node'
import { productionNodeBinding, type NodeServiceBinding } from '../../src/runtime/node/binding'
import { nodeActionDigest } from '../../src/runtime/node/listenerMethods'
import { parseNodeArgs } from '../../src/runtime/node/args'
import { runNodeCommand, type NodeCommandDeps } from '../../src/runtime/node/main'
import { NodeStateStore } from '../../src/runtime/node/state'
import { stopNode } from '../../src/runtime/node/stop'
import { NodePrivateFiles } from '../../src/runtime/node/privateFiles'
import * as nodeAuthEntry from '../../src/runtime/node/auth/entry'
import * as nodeServeEntry from '../../src/runtime/node/serveEntry'
import { maskedFrame } from './helpers/node/listener'
import { loopbackHeaders, loopbackPost, loopbackTerminalSocket } from './helpers/node/loopback'
import { nodeSigningKey } from './helpers/node/authenticator'
import { isMissingFile } from '../../src/runtime/node/privateFiles'
import { nodeNativeTest, nodeTempRoot, testPackageVersion, vacantPort } from './helpers/nodeNative'
import { useRuntimeGovernor } from './helpers/resources/runtimeGovernor'

// Serve issues its certificate through the governed launch: admitted by the
// governor the node process configures (POSIX; Windows refuses).
useRuntimeGovernor('m110-serve-jobs-', process.platform !== 'win32')

/**
The drill authenticator: an emulated CTAP2 key whose registration and
assertion bytes the pinned verifier checks for real (RP ID hash, flags,
counter, challenge, origin, ECDSA signature). The ceremony the owner does
with a real key stays the lead's two-machine run.
*/
function drillAuthenticator(
  rpId: string,
  origin: string,
): {
  enroll: (challenge: NodeAuthChallenge) => { challengeId: string; credential: unknown }
  assert: (challenge: NodeAuthChallenge) => { challengeId: string; credential: unknown }
} {
  const { privateKey, publicCose } = nodeSigningKey()
  const credentialId = randomBytes(16)
  const rpIdHash = createHash('sha256').update(rpId, 'utf8').digest()
  let counter = 0
  const clientData = (type: string, challenge: string): Buffer => {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8')
  }
  return {
    enroll: (challenge) => {
      const clientDataJson = clientData('webauthn.create', challenge.challenge)
      const credentialLength = Buffer.alloc(2)
      credentialLength.writeUInt16BE(credentialId.length, 0)
      const authData = Buffer.concat([
        rpIdHash,
        Buffer.from([0x45]),
        Buffer.alloc(4),
        Buffer.alloc(16),
        credentialLength,
        credentialId,
        Buffer.from(publicCose),
      ])
      const attestationObject = Buffer.from(
        isoCBOR.encode(
          new Map<string | number, string | Map<string | number, never> | Uint8Array>([
            ['fmt', 'none'],
            ['attStmt', new Map<string | number, never>()],
            ['authData', new Uint8Array(authData)],
          ]),
        ),
      )
      const id = credentialId.toString('base64url')
      return {
        challengeId: challenge.id,
        credential: {
          id,
          rawId: id,
          type: 'public-key',
          clientExtensionResults: {},
          response: {
            clientDataJSON: clientDataJson.toString('base64url'),
            attestationObject: attestationObject.toString('base64url'),
            transports: [],
          },
        },
      }
    },
    assert: (challenge) => {
      counter += 1
      const clientDataJson = clientData('webauthn.get', challenge.challenge)
      const count = Buffer.alloc(4)
      count.writeUInt32BE(counter, 0)
      const authData = Buffer.concat([rpIdHash, Buffer.from([0x05]), count])
      const signer = createSign('sha256')
      signer.update(Buffer.concat([authData, createHash('sha256').update(clientDataJson).digest()]))
      const signature = signer.sign(privateKey)
      const id = credentialId.toString('base64url')
      return {
        challengeId: challenge.id,
        credential: {
          id,
          rawId: id,
          type: 'public-key',
          clientExtensionResults: {},
          response: {
            clientDataJSON: clientDataJson.toString('base64url'),
            authenticatorData: authData.toString('base64url'),
            signature: signature.toString('base64url'),
            userHandle: undefined,
          },
        },
      }
    },
  }
}

interface LiveServe {
  readonly root: string
  readonly workspaceRoot: string
  readonly port: number
  readonly origin: string
  readonly lines: string[]
  readonly controller: AbortController
  readonly serving: Promise<void>
  readonly version: string
  post: (
    route: string,
    body?: string,
    headers?: Record<string, string | undefined>,
  ) => Promise<{ status: number; body: string }>
  close: () => Promise<void>
}

async function startServe(): Promise<LiveServe> {
  const root = await nodeTempRoot('node-serve-binding')
  const workspaceRoot = path.join(root, 'workspaces')
  await mkdir(workspaceRoot, { recursive: true })
  const lines: string[] = []
  const port = await vacantPort()
  const setup = makeSetup(root, lines)
  expect(await runNodeCommand(parseNodeArgs(nodeInitArgs(workspaceRoot, port)), setup)).toBe(0)
  const store = new NodeStateStore(root, () => undefined)
  await store.load()
  const state = store.read()
  await store.update(state.generation, (draft) => ({
    ...draft,
    workspaces: [
      {
        id: 'workspace-1',
        label: 'Workspace 1',
        path: 'workspace-1',
        trusted: false,
        lastUsedAt: Date.now(),
      },
    ],
  }))
  await mkdir(path.join(workspaceRoot, 'workspace-1'), { recursive: true })
  const controller = new AbortController()
  const binding = testBinding(lines)
  const serving = binding.serve(store, controller.signal)
  const serve: LiveServe = {
    root,
    workspaceRoot,
    port,
    origin: `https://home.local:${String(port)}`,
    lines,
    controller,
    serving,
    version: testPackageVersion(),
    post: async (route, body = '{}', headers = {}) => {
      const answered = await loopbackPost({
        port,
        certificate: await serveCertificate(root),
        route,
        method: 'POST',
        body,
        headers: loopbackHeaders(port, headers),
      })
      return { status: answered.status, body: answered.body }
    },
    close: async () => {
      controller.abort()
      await serving
      await rm(root, { recursive: true, force: true })
    },
  }
  return serve
}

/** The fingerprint line is printed after the listener accepts: resolve then. */
async function waitForFingerprint(
  lines: readonly string[],
  serving: Promise<void>,
  from = 0,
): Promise<string> {
  // Either settlement ends the wait: the fingerprint line wins while serve
  // runs, and a serve failure (or a quiet stop) becomes the wait's failure.
  const settled = (async (): Promise<unknown> => {
    try {
      await serving
    } catch (error: unknown) {
      return error
    }
    return new Error('serve stopped before printing its fingerprint')
  })()
  const state = { stop: false }
  const found = (async (): Promise<string> => {
    for (;;) {
      const line = lines.slice(from).find((entry) => entry.startsWith('Certificate fingerprint: '))
      if (line !== undefined) return line
      if (state.stop) throw new Error('serve settled before printing its fingerprint')
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })
    }
  })()
  const outcome = await Promise.race([settled, found])
  state.stop = true
  if (typeof outcome === 'string') return outcome
  throw outcome
}

async function enrollOwner(
  serve: LiveServe,
  setupCode: string,
): Promise<{ authentication: NodeAuthentication; key: ReturnType<typeof drillAuthenticator> }> {
  const key = drillAuthenticator('home.local', serve.origin)
  const begun = await serve.post(
    '/node/auth/begin',
    JSON.stringify({ purpose: 'enroll', setupCode }),
  )
  expect(begun.status).toBe(200)
  const challenge = nodeAuthChallengeSchema.parse(JSON.parse(begun.body))
  const enrolled = await serve.post('/node/auth/enroll', JSON.stringify(key.enroll(challenge)))
  expect(enrolled.status).toBe(200)
  return { authentication: nodeAuthenticationSchema.parse(JSON.parse(enrolled.body)), key }
}

async function stepUpFor(
  serve: LiveServe,
  bearer: string,
  key: ReturnType<typeof drillAuthenticator>,
  action: 'terminal.open' | 'maker.action' | 'node.wipe' | 'git.network',
  digest: string,
): Promise<{ id: string }> {
  const begun = await serve.post(
    '/node/auth/stepUp/begin',
    JSON.stringify({ action, actionDigest: digest }),
    { Authorization: `Bearer ${bearer}` },
  )
  expect(begun.status).toBe(200)
  const challenge = nodeAuthChallengeSchema.parse(JSON.parse(begun.body))
  const completed = await serve.post(
    '/node/auth/stepUp/complete',
    JSON.stringify(key.assert(challenge)),
    { Authorization: `Bearer ${bearer}` },
  )
  expect(completed.status).toBe(200)
  return nodeStepUpSchema.parse(JSON.parse(completed.body))
}

function setupCodeFrom(lines: readonly string[]): string {
  const line = lines.find((entry) => entry.startsWith(`${UI_TEXT.nodeLabels.setupCode}: `))
  if (line === undefined) throw new Error('init printed no setup code')
  return line.slice(`${UI_TEXT.nodeLabels.setupCode}: `.length)
}

/** The pages' own placeholder shape: pending proof fields the digest strips. */
function pendingDigest(
  method: 'node/maker/action' | 'node/terminal/open' | 'node/wipe',
  params: object,
): string {
  return nodeActionDigest(method, {
    ...params,
    stepUpId: 'pending',
    actionDigest: NODE_ZERO_DIGEST,
  })
}

/** The owner's session on a running serve, with its bearer header. */
async function enrolledServe(serve: LiveServe): Promise<{
  authentication: NodeAuthentication
  key: ReturnType<typeof drillAuthenticator>
  auth: { Authorization: string }
}> {
  const { authentication, key } = await enrollOwner(serve, setupCodeFrom(serve.lines))
  return { authentication, key, auth: { Authorization: `Bearer ${authentication.bearer}` } }
}

/** A command setup printing into the test's lines. */
function makeSetup(root: string, lines: string[]): NodeCommandDeps {
  return {
    root,
    signal: new AbortController().signal,
    now: Date.now,
    print: (line: string) => {
      lines.push(line)
    },
    readSecret: () => Promise.resolve(''),
  }
}

/** The home init arguments, listening when a port is given. */
function nodeInitArgs(workspaceRoot: string, port?: number): string[] {
  return [
    'init',
    '--label',
    'Home',
    '--name',
    'home.local',
    '--workspace-root',
    workspaceRoot,
    ...(port === undefined ? [] : ['--listen', '127.0.0.1', '--port', String(port)]),
  ]
}

/** The production binding with the serve and auth entries handed in. */
function testBinding(
  lines: string[],
  loadAuthBundle: () => unknown = () => nodeAuthEntry,
): NodeServiceBinding {
  return productionNodeBinding({
    print: (line: string) => {
      lines.push(line)
    },
    version: testPackageVersion,
    loadServeBundle: () => nodeServeEntry,
    loadAuthBundle,
  })
}

/** The leaf serve presents, read from the test root. */
async function serveCertificate(root: string): Promise<string> {
  return await readFile(path.join(root, NODE_TLS_DIRECTORY, NODE_TLS_CERT_FILE), 'utf8')
}

nodeNativeTest('serve prints the full fingerprint and answers the public challenge', async () => {
  const serve = await startServe()
  try {
    const line = await waitForFingerprint(serve.lines, serve.serving)
    const printed = line.slice('Certificate fingerprint: '.length)
    expect(printed).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
    const served = new X509Certificate(await serveCertificate(serve.root))
    expect(`Certificate fingerprint: ${served.fingerprint256}`).toBe(line)
    const begun = await serve.post(
      '/node/auth/begin',
      JSON.stringify({ purpose: 'enroll', setupCode: setupCodeFrom(serve.lines) }),
    )
    expect(begun.status).toBe(200)
    expect(() => nodeAuthChallengeSchema.parse(JSON.parse(begun.body))).not.toThrow()
  } finally {
    await serve.close()
  }
})

nodeNativeTest('a missing or wrong bearer refuses a privileged route', async () => {
  const serve = await startServe()
  try {
    await waitForFingerprint(serve.lines, serve.serving)
    const unauthenticated = '{"code":"unauthenticated"}'
    const missing = await serve.post('/node/dashboard/read', '{}', { Authorization: undefined })
    expect(missing.status).toBe(401)
    expect(missing.body).toBe(unauthenticated)
    // A real session now exists: only its own bearer opens the route.
    const { authentication } = await enrolledServe(serve)
    const valid = authentication.bearer
    const flipped = `${valid.slice(0, -1)}${valid.endsWith('A') ? 'B' : 'A'}`
    for (const wrong of [randomBytes(32).toString('base64url'), flipped]) {
      const refused = await serve.post('/node/dashboard/read', '{}', {
        Authorization: `Bearer ${wrong}`,
      })
      expect(refused.status).toBe(401)
      expect(refused.body).toBe(unauthenticated)
    }
    const opened = await serve.post('/node/dashboard/read', '{}', {
      Authorization: `Bearer ${valid}`,
    })
    expect(opened.status).toBe(200)
  } finally {
    await serve.close()
  }
})

nodeNativeTest('enroll, dashboard and audit run end to end', async () => {
  const serve = await startServe()
  try {
    await waitForFingerprint(serve.lines, serve.serving)
    const { authentication } = await enrolledServe(serve)
    const dashboard = await serve.post('/node/dashboard/read', '{}', {
      Authorization: `Bearer ${authentication.bearer}`,
    })
    expect(dashboard.status).toBe(200)
    const readings = nodeDashboardSchema.parse(JSON.parse(dashboard.body))
    expect(readings.version).toBe(serve.version)
    expect(readings.sessions).toHaveLength(1)
    expect(readings.sessions[0]?.id).toBe(authentication.session.id)
    expect(readings.locked).toBe(false)
    expect(readings.keyStoreSealed).toBe(true)
    expect(readings.pendingChallenges).toBe(0)
    expect(readings.cpuPercent).toBeGreaterThanOrEqual(0)
    expect(readings.cpuPercent).toBeLessThanOrEqual(100)
    expect(readings.memory.usedBytes).toBeLessThanOrEqual(readings.memory.totalBytes)
    expect(readings.memory.totalBytes).toBeGreaterThan(0)
    expect(readings.disk.freeBytes).toBeLessThanOrEqual(readings.disk.totalBytes)
    expect(readings.workspaces).toHaveLength(1)
    const audit = await serve.post('/node/audit/list', JSON.stringify({ cursor: null }), {
      Authorization: `Bearer ${authentication.bearer}`,
    })
    expect(audit.status).toBe(200)
    const trail = nodeMethods['node/audit/list'].result.parse(JSON.parse(audit.body))
    expect(trail.entries).toContainEqual(
      expect.objectContaining({ kind: 'signin', action: 'enroll', outcome: 'allowed' }),
    )
  } finally {
    await serve.close()
  }
})

nodeNativeTest('files list and read serve real bytes; writes say unavailable', async () => {
  const serve = await startServe()
  try {
    await waitForFingerprint(serve.lines, serve.serving)
    await writeFile(
      path.join(serve.workspaceRoot, 'workspace-1', 'hello.ts'),
      'export const answer = 42\n',
    )
    const { auth } = await enrolledServe(serve)
    const listed = await serve.post(
      '/node/files/list',
      JSON.stringify({ workspaceId: 'workspace-1', directory: null, cursor: null }),
      auth,
    )
    expect(listed.status).toBe(200)
    expect(listed.body).toContain('hello.ts')
    const read = await serve.post(
      '/node/files/read',
      JSON.stringify({ workspaceId: 'workspace-1', path: 'hello.ts' }),
      auth,
    )
    expect(read.status).toBe(200)
    const file = nodeMethods['node/files/read'].result.parse(JSON.parse(read.body))
    expect(file.text).toBe('export const answer = 42\n')
    expect(file.digest).toBe(
      createHash('sha256').update('export const answer = 42\n', 'utf8').digest('hex'),
    )
    const written = await serve.post(
      '/node/files/write',
      JSON.stringify({
        workspaceId: 'workspace-1',
        path: 'hello.ts',
        text: 'changed\n',
        expectedDigest: file.digest,
      }),
      auth,
    )
    expect(written.status).toBe(503)
    expect(written.body).toBe('{"code":"unavailable"}')
  } finally {
    await serve.close()
  }
})

nodeNativeTest('git and maker routes say unavailable without their peers', async () => {
  const serve = await startServe()
  try {
    await waitForFingerprint(serve.lines, serve.serving)
    const { authentication, key, auth } = await enrolledServe(serve)
    const status = await serve.post(
      '/node/git/status',
      JSON.stringify({ workspaceId: 'workspace-1', cursor: null }),
      auth,
    )
    expect(status.status).toBe(503)
    expect(status.body).toBe('{"code":"unavailable"}')
    const params = {
      deviceId: 'device-1',
      operation: 'ping',
      payload: 'hello',
    }
    const digest = pendingDigest('node/maker/action', params)
    const proof = await stepUpFor(serve, authentication.bearer, key, 'maker.action', digest)
    const action = await serve.post(
      '/node/maker/action',
      JSON.stringify({ ...params, stepUpId: proof.id, actionDigest: digest }),
      auth,
    )
    expect(action.status).toBe(503)
    expect(action.body).toBe('{"code":"unavailable"}')
  } finally {
    await serve.close()
  }
})

nodeNativeTest('an action proof bound to a different digest refuses', async () => {
  const serve = await startServe()
  try {
    await waitForFingerprint(serve.lines, serve.serving)
    const { authentication, key, auth } = await enrolledServe(serve)
    const other = pendingDigest('node/maker/action', {
      deviceId: 'device-1',
      operation: 'ping',
      payload: 'other',
    })
    const proof = await stepUpFor(serve, authentication.bearer, key, 'maker.action', other)
    const params = { deviceId: 'device-1', operation: 'ping', payload: 'hello' }
    const digest = pendingDigest('node/maker/action', params)
    expect(digest).not.toBe(other)
    const swapped = await serve.post(
      '/node/maker/action',
      JSON.stringify({ ...params, stepUpId: proof.id, actionDigest: digest }),
      auth,
    )
    expect(swapped.status).toBe(403)
    expect(swapped.body).toBe('{"code":"forbidden"}')
    const replayed = await serve.post(
      '/node/maker/action',
      JSON.stringify({ ...params, stepUpId: proof.id, actionDigest: other }),
      auth,
    )
    expect(replayed.status).toBe(403)
    expect(replayed.body).toBe('{"code":"forbidden"}')
  } finally {
    await serve.close()
  }
})

nodeNativeTest('terminal open says unavailable; the socket closes unknown terminals', async () => {
  const serve = await startServe()
  try {
    await waitForFingerprint(serve.lines, serve.serving)
    const { authentication, key, auth } = await enrolledServe(serve)
    const params = {
      workspaceId: 'workspace-1',
      size: { cols: 80, rows: 24 },
    }
    const digest = pendingDigest('node/terminal/open', params)
    const proof = await stepUpFor(serve, authentication.bearer, key, 'terminal.open', digest)
    const opened = await serve.post(
      '/node/terminal/open',
      JSON.stringify({ ...params, stepUpId: proof.id, actionDigest: digest }),
      auth,
    )
    expect(opened.status).toBe(503)
    expect(opened.body).toBe('{"code":"unavailable"}')
    const socket: Duplex = await loopbackTerminalSocket({
      port: serve.port,
      certificate: await serveCertificate(serve.root),
      origin: serve.origin,
    })
    try {
      const closed = new Promise<void>((resolve) => {
        socket.once('close', () => {
          resolve()
        })
      })
      socket.write(
        maskedFrame({ type: 'auth', bearer: authentication.bearer, terminalId: 'terminal-99' }),
      )
      await closed
    } finally {
      socket.destroy()
    }
    const dashboard = await serve.post('/node/dashboard/read', '{}', auth)
    expect(dashboard.status).toBe(200)
  } finally {
    await serve.close()
  }
})

nodeNativeTest('stop and lock run through the service; the lock ends sessions', async () => {
  const serve = await startServe()
  try {
    await waitForFingerprint(serve.lines, serve.serving)
    const { auth } = await enrolledServe(serve)
    const stopped = await serve.post('/node/stop', '{}', auth)
    expect(stopped.status).toBe(200)
    expect(stopped.body).toBe('{"done":true}')
    const locked = await serve.post('/node/lock', '{}', auth)
    expect(locked.status).toBe(200)
    expect(locked.body).toBe('{"done":true}')
    const after = await serve.post('/node/dashboard/read', '{}', auth)
    expect(after.status).toBe(401)
    expect(after.body).toBe('{"code":"unauthenticated"}')
  } finally {
    await serve.close()
  }
})

nodeNativeTest('wipe destroys keys and identity but keeps the listener up', async () => {
  const serve = await startServe()
  try {
    await waitForFingerprint(serve.lines, serve.serving)
    const { authentication, key } = await enrolledServe(serve)
    const digest = pendingDigest('node/wipe', {})
    const proof = await stepUpFor(serve, authentication.bearer, key, 'node.wipe', digest)
    const wiped = await serve.post(
      '/node/wipe',
      JSON.stringify({ stepUpId: proof.id, actionDigest: digest }),
      { Authorization: `Bearer ${authentication.bearer}` },
    )
    expect(wiped.status).toBe(200)
    expect(wiped.body).toBe('{"done":true}')
    expect(await readFile(path.join(serve.root, NODE_KEYS_FILE), 'utf8')).toBe('')
    expect(await readFile(path.join(serve.root, 'identity-key.pem'), 'utf8')).toBe('')
    const begun = await serve.post('/node/auth/begin', JSON.stringify({ purpose: 'signin' }))
    expect(begun.status).toBe(200)
  } finally {
    await serve.close()
  }
})

nodeNativeTest('serve without a chosen interface refuses', async () => {
  const root = await nodeTempRoot('node-serve-nolisten')
  try {
    const lines: string[] = []
    const setup = makeSetup(root, lines)
    expect(await runNodeCommand(parseNodeArgs(nodeInitArgs(root)), setup)).toBe(0)
    const bound = {
      ...setup,
      binding: testBinding(lines),
    }
    await expect(runNodeCommand(parseNodeArgs(['serve']), bound)).rejects.toThrow(
      UI_TEXT.nodeErrors.unavailable,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

nodeNativeTest('a second serve reuses the committed pair and fingerprint', async () => {
  const root = await nodeTempRoot('node-serve-resume')
  try {
    const workspaceRoot = path.join(root, 'workspaces')
    await mkdir(workspaceRoot, { recursive: true })
    const port = await vacantPort()
    const lines: string[] = []
    const setup = makeSetup(root, lines)
    expect(await runNodeCommand(parseNodeArgs(nodeInitArgs(workspaceRoot, port)), setup)).toBe(0)
    const fingerprints: string[] = []
    for (let round = 0; round < 2; round += 1) {
      const store = new NodeStateStore(root, () => undefined)
      await store.load()
      const binding = testBinding(lines)
      const controller = new AbortController()
      const serving = binding.serve(store, controller.signal)
      fingerprints.push(await waitForFingerprint(lines, serving, lines.length))
      controller.abort()
      await serving
    }
    expect(fingerprints).toHaveLength(2)
    expect(fingerprints[0]).toBe(fingerprints[1])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

nodeNativeTest('stop signals the recorded process and waits until it is gone', async () => {
  const root = await nodeTempRoot('node-stop-live')
  let child: ChildProcess | undefined
  try {
    const files = new NodePrivateFiles(root)
    await files.prepare()
    child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' })
    const pid = child.pid
    if (pid === undefined) throw new Error('spawned stop fixture has no pid')
    await files.write(NODE_LOCK_FILE, JSON.stringify({ pid }))
    await expect(stopNode({ files, signal: new AbortController().signal })).resolves.toEqual({
      done: true,
    })
    expect(() => process.kill(pid, 0)).toThrow()
  } finally {
    child?.kill('SIGKILL')
    await rm(root, { recursive: true, force: true })
  }
})

nodeNativeTest(
  'stop without a lock, with a stale lock, or with a corrupt lock refuses',
  async () => {
    const root = await nodeTempRoot('node-stop-refusals')
    try {
      const files = new NodePrivateFiles(root)
      await files.prepare()
      const signal = new AbortController().signal
      // No lock: the missing file propagates, and the CLI names it not found.
      let outcome: unknown = 'resolved'
      try {
        await stopNode({ files, signal })
      } catch (error: unknown) {
        outcome = error
      }
      expect(isMissingFile(outcome)).toBe(true)
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10)'], { stdio: 'ignore' })
      if (child.pid === undefined) throw new Error('spawned stop fixture has no pid')
      await new Promise<void>((resolve) => {
        child.once('exit', () => {
          resolve()
        })
      })
      await files.write(NODE_LOCK_FILE, JSON.stringify({ pid: child.pid }))
      await expect(stopNode({ files, signal })).rejects.toThrow(UI_TEXT.nodeErrors.failed)
      await files.write(NODE_LOCK_FILE, 'not-json')
      await expect(stopNode({ files, signal })).rejects.toThrow(UI_TEXT.nodeErrors.failed)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)

nodeNativeTest('serve without the auth bundle refuses after a fixed sentence', async () => {
  const root = await nodeTempRoot('node-serve-nobundle')
  try {
    const workspaceRoot = path.join(root, 'workspaces')
    await mkdir(workspaceRoot, { recursive: true })
    const lines: string[] = []
    const setup = makeSetup(root, lines)
    expect(
      await runNodeCommand(parseNodeArgs(nodeInitArgs(workspaceRoot, await vacantPort())), setup),
    ).toBe(0)
    const store = new NodeStateStore(root, () => undefined)
    await store.load()
    const binding = testBinding(lines, () => {
      throw new Error('missing bundle')
    })
    await expect(binding.serve(store, new AbortController().signal)).rejects.toThrow(
      UI_TEXT.nodeErrors.unavailable,
    )
    expect(lines).toContain(UI_TEXT.nodeMessages.unexpectedFailure)
    const shaped = testBinding(lines, () => ({}))
    await expect(shaped.serve(store, new AbortController().signal)).rejects.toThrow(
      UI_TEXT.nodeErrors.unavailable,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
