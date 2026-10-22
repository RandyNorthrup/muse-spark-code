// The packaged-shape ACP agent serves the real protocol (PLAN.md D62): the
// SDK's own client speaks to the freshly bundled `src/runtime/main.ts` over
// real stdio, with an isolated data folder and no credential, model, key or
// network. The handshake negotiates the SDK's protocol version, and a
// session list without a sign-in refuses with the typed authentication
// error instead of starting anything. The credential isolation is an empty
// XDG_CONFIG_HOME: on Windows HOME does not move Node's homedir(), so the
// person's real credential file would otherwise show through and the list
// would take the signed-in path. With no CLI on PATH the same list refuses
// with the CLI-missing sentence instead.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { webReadable } from '../../src/runtime/webStreams'
import { removeFolder } from './helpers/temporaryFolders'
import { stageAgentBundle } from './helpers/stageAgentBundle'

const directory = mkdtempSync(path.join(tmpdir(), 'acp-serve-handshake-'))
const agent = path.join(directory, 'dist', 'acp.js')
const config = path.join(directory, 'config')
const data = path.join(directory, 'data')
const workspace = path.join(directory, 'workspace')

beforeAll(async () => {
  await stageAgentBundle(directory)
})

afterAll(async () => {
  await removeFolder(directory)
})

function launch(pathValue: string): ChildProcessWithoutNullStreams {
  // No credential reaches the agent: the environment carries paths only, and
  // the isolated config and data folders hold no sign-in and no key.
  const launched = spawn(process.execPath, [agent], {
    env: {
      PATH: pathValue,
      HOME: directory,
      XDG_CONFIG_HOME: config,
      XDG_DATA_HOME: data,
      NODE_PATH: path.resolve('node_modules'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return launched
}

/** The served session list's refusal: the handshake, then the list's error text. */
async function refusedList(pathValue: string): Promise<string> {
  const served = launch(pathValue)
  const failures: unknown[] = []
  served.on('error', (error) => {
    failures.push(error)
  })
  const stream = acp.ndJsonStream(Writable.toWeb(served.stdin), webReadable(served.stdout))
  const app = acp.client({ name: 'serve-handshake' })
  let refusal = ''
  try {
    await app.connectWith(stream, async (ctx) => {
      const init = await ctx.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: false } },
      })
      expect(init.protocolVersion).toBe(acp.PROTOCOL_VERSION)
      expect(init.agentCapabilities).toMatchObject({
        sessionCapabilities: { list: {}, resume: {}, close: {} },
      })
      try {
        await ctx.request('session/list', { cwd: workspace })
      } catch (error: unknown) {
        refusal = error instanceof Error ? error.message : String(error)
      }
    })
  } finally {
    served.kill()
    await new Promise<void>((resolve) => {
      served.on('exit', () => {
        resolve()
      })
    })
  }
  expect(failures).toEqual([])
  return refusal
}

describe('the served ACP agent over real stdio', () => {
  it('negotiates the protocol and refuses an unsigned session list', async () => {
    expect(await refusedList(process.env['PATH'] ?? '')).toMatch(/Authentication required/)
  })

  it('refuses a session list with the CLI-missing sentence when no CLI is on PATH', async () => {
    const separator = process.platform === 'win32' ? ';' : ':'
    const scrubbed = (process.env['PATH'] ?? '')
      .split(separator)
      .filter((entry) => !entry.toLowerCase().includes('muse'))
      .join(separator)
    expect(await refusedList(scrubbed)).toMatch(/Muse Code is not installed/)
  })
})
