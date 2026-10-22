// The packaged-shape ACP agent serves the real protocol (PLAN.md D62): the
// SDK's own client speaks to the freshly bundled `src/runtime/main.ts` over
// real stdio, with an isolated data folder and no credential, model, key or
// network. The handshake negotiates the SDK's protocol version, and a
// session list without a sign-in refuses with the typed authentication
// error instead of starting anything.
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
const data = path.join(directory, 'data')
const workspace = path.join(directory, 'workspace')

beforeAll(async () => {
  await stageAgentBundle(directory)
})

afterAll(async () => {
  await removeFolder(directory)
})

function launch(): ChildProcessWithoutNullStreams {
  // No credential reaches the agent: the environment carries paths only, and
  // the isolated data folder holds no sign-in.
  const launched = spawn(process.execPath, [agent], {
    env: {
      PATH: process.env['PATH'],
      HOME: directory,
      XDG_DATA_HOME: data,
      NODE_PATH: path.resolve('node_modules'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return launched
}

describe('the served ACP agent over real stdio', () => {
  it('negotiates the protocol and refuses an unsigned session list', async () => {
    const served = launch()
    const failures: unknown[] = []
    served.on('error', (error) => {
      failures.push(error)
    })
    const stream = acp.ndJsonStream(Writable.toWeb(served.stdin), webReadable(served.stdout))
    const app = acp.client({ name: 'serve-handshake' })
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
        await expect(ctx.request('session/list', { cwd: workspace })).rejects.toThrow(
          /Authentication required/,
        )
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
  })
})
