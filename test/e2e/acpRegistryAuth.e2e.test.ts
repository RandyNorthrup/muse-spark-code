// The ACP Registry's release gate (lane ACPREG): the built/packed agent bin
// (`dist/acp.js`, or the package npm installed under MUSE_ACP_PACKAGE_DIR,
// exactly as an installed package runs it) started as a real child process
// over stdio and driven by the ACP SDK's own client. A registry client that
// announces terminal support with the current `auth.terminal` capability and
// one that uses the older `_meta` `terminal-auth` flag must both be offered
// a terminal (or agent) sign-in; a client announcing neither must not.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import { EXPECTED_SCHEMA_FINGERPRINT } from '@muse-code/sdk'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { webReadable } from '../../src/runtime/webStreams'
import { removeFolder } from '../unit/helpers/temporaryFolders'
import { installFakeMuse } from './fakeMuse'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
// An installed package brings its own native keyring binding. One laid out
// here as npm installs it takes the binding from this repository's
// node_modules (NODE_PATH), as an installed package finds its dependency.
const INSTALLED = process.env['MUSE_ACP_PACKAGE_DIR']
const PACKAGE = INSTALLED ?? mkdtempSync(path.join(tmpdir(), 'acp-registry-'))
const AGENT = path.join(PACKAGE, 'dist', 'acp.js')
const NODE_PATH = INSTALLED === undefined ? path.join(ROOT, 'node_modules') : ''
const workspace = mkdtempSync(path.join(tmpdir(), 'acp-registry-ws-'))
const dataHome = mkdtempSync(path.join(tmpdir(), 'acp-registry-data-'))

const fake = installFakeMuse()
const children: ChildProcessWithoutNullStreams[] = []

beforeAll(async () => {
  if (INSTALLED !== undefined) {
    return
  }
  mkdirSync(path.dirname(AGENT), { recursive: true })
  await build({
    entryPoints: [path.join(ROOT, 'src', 'runtime', 'main.ts')],
    outfile: AGENT,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['@napi-rs/keyring'],
    logLevel: 'silent',
  })
  writeFileSync(path.join(PACKAGE, 'package.json'), JSON.stringify({ version: '0.0.0-registry' }))
  cpSync(path.join(ROOT, 'l10n'), path.join(PACKAGE, 'l10n'), { recursive: true })
})

afterAll(async () => {
  for (const child of children) {
    child.kill()
  }
  await Promise.all(
    [fake.installDir, workspace, dataHome, ...(INSTALLED === undefined ? [PACKAGE] : [])].map(
      (folder) => removeFolder(folder),
    ),
  )
})

function startAgent(): {
  run: <T>(op: (client: acp.ClientContext) => Promise<T>) => Promise<T>
} {
  const child = spawn(process.execPath, [AGENT, '--muse-binary', fake.binaryPath], {
    env: {
      ...process.env,
      MUSE_FAKE_NODE: process.execPath,
      MUSE_FAKE_FINGERPRINT: EXPECTED_SCHEMA_FINGERPRINT,
      NODE_PATH,
      XDG_DATA_HOME: dataHome,
      LOCALAPPDATA: dataHome,
      USERPROFILE: dataHome,
      HOME: dataHome,
      LANG: 'C',
      LC_ALL: '',
    },
    cwd: workspace,
    stdio: 'pipe',
  })
  children.push(child)
  const client = acp.client({ name: 'registry-gate' })
  const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), webReadable(child.stdout))
  return { run: (op) => client.connectWith(stream, op) }
}

function initialize(
  client: acp.ClientContext,
  clientCapabilities?: acp.ClientCapabilities,
): Promise<acp.InitializeResponse> {
  return client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities })
}

/** A terminal (or agent) sign-in is on offer, as the registry requires. */
function hasTerminalSignIn(response: acp.InitializeResponse): boolean {
  const methods: { id: string; type?: unknown }[] = response.authMethods ?? []
  return methods.some((method) => method.type === 'terminal' || method.type === 'agent')
}

describe('the ACP registry release gate', () => {
  it('offers terminal sign-in for auth.terminal and for the older _meta flag, and to no one else', async () => {
    const modern = startAgent()
    const legacy = startAgent()
    const plain = startAgent()
    const [modernInit, legacyInit, plainInit] = await Promise.all([
      modern.run((client) => initialize(client, { auth: { terminal: true } })),
      legacy.run((client) => initialize(client, { _meta: { 'terminal-auth': true } })),
      plain.run((client) => initialize(client)),
    ])
    expect(hasTerminalSignIn(modernInit)).toBe(true)
    expect(hasTerminalSignIn(legacyInit)).toBe(true)
    expect(hasTerminalSignIn(plainInit)).toBe(false)
  })
})
