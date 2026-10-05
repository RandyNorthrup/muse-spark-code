// M91b: Amp and OpenCode plugin hooks in a running Model API session. Amp's
// tool.call `error` stops the thread worker (amp_plugin-api.md:1978): the
// tool never runs and the turn ends with the plugin's reason. The session's
// dispose ends plugin children still running. Real children under this
// node, in their own process group; the model is a fake.

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ModelApiHost, ModelApiSession } from '../../src/core/backends/modelapi/ModelApiHost'
import { parseForeignHooks, type HookDefinition } from '../../src/core/backends/modelapi/hooks'
import type { VerifyHooks } from '../../src/core/backends/modelapi/verifyLoop'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi, fakeModelApiClient, type ScriptedReply } from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { watchSessionTurns } from './helpers/sessionTurns'

const ROOT = '/ws'
const VERSION_MATCH = /^v(\d+)\.(\d+)\./.exec(process.version)
const IS_REAL =
  process.platform !== 'win32' &&
  VERSION_MATCH !== null &&
  (Number(VERSION_MATCH[1]) > 22 ||
    (Number(VERSION_MATCH[1]) === 22 && Number(VERSION_MATCH[2]) >= 18))

const noChecks: VerifyHooks = {
  isDiagnosticsOn: () => false,
  checkCommands: () => [],
  isFormatOnEdit: () => false,
  diagnosticsAfterEdit: (files) => Promise.resolve(files.map((file) => ({ file, entries: [] }))),
  formatAfterEdit: () => Promise.resolve(undefined),
}

function ampGuard(body: string, extra: Record<string, unknown> = {}): readonly HookDefinition[] {
  const dir = mkdtempSync(path.join(tmpdir(), 'm91b-session-'))
  const plugin = path.join(dir, 'guard.mjs')
  writeFileSync(plugin, `export default function (amp) {\n${body}\n}\n`)
  const parsed = parseForeignHooks(
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            format: 'amp',
            sourceEvent: 'tool.call',
            plugin,
            hooks: [{ type: 'plugin' }],
            ...extra,
          },
        ],
      },
    }),
    'user',
    process.platform,
  )
  expect(parsed.warnings).toEqual([])
  return parsed.hooks
}

async function session(hooks: readonly HookDefinition[]) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({ 'notes.txt': 'hello' }, ROOT)
  io.runHook = () => Promise.reject(new Error('no plugin hook runs natively'))
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client: fakeModelApiClient(api, log), workspaceRoot: ROOT, io, log }),
    verify: noChecks,
    loadHooks: () => Promise.resolve(hooks),
    isHooksEnabled: () => true,
    pluginHooks: {
      env: () => ({ PATH: path.dirname(process.execPath) }),
      containment: () => Promise.resolve({ kind: 'processGroup' }),
    },
  })
  const started = await host.startSession({
    workspaceRoot: ROOT,
    modelId: 'muse-spark-1.3',
    approvalMode: 'allowAll',
  })
  if (!(started instanceof ModelApiSession)) {
    throw new TypeError('expected the Model API session')
  }
  const { events, turnDone } = watchSessionTurns(started)
  const turn = async (...replies: readonly ScriptedReply[]) => {
    api.script(...replies)
    const done = turnDone()
    await started.sendTurn([{ type: 'text', text: 'go' }])
    await done
  }
  return { api, io, events, session: started, turn }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8')
    return !stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z')
  } catch {
    return false
  }
}

describe.runIf(IS_REAL)('plugin hooks in a Model API session', () => {
  it('an Amp error refuses the call, the tool never runs, and the turn ends with its reason', async () => {
    const t = await session(
      ampGuard(
        `amp.on('tool.call', () => ({ action: 'error', message: 'plugin stopped this thread' }))`,
      ),
    )
    await t.turn(
      { calls: [{ name: 'bash', arguments: JSON.stringify({ command: 'echo hi' }) }] },
      { text: 'should never be asked for' },
    )
    expect(t.io.shellCalls).toEqual([])
    // The refused call ended the turn: no second request went out.
    expect(t.api.responseBodies()).toHaveLength(1)
    const row = t.events.find(
      (event): event is Extract<AgentEvent, { type: 'itemCompleted' }> =>
        event.type === 'itemCompleted' && event.item.tool === 'bash',
    )
    expect(JSON.stringify(row?.item)).toContain('plugin stopped this thread')
  })

  it('an Amp reject-and-continue refuses the call and the turn goes on', async () => {
    const t = await session(
      ampGuard(
        `amp.on('tool.call', () => ({ action: 'reject-and-continue', message: 'not this one' }))`,
      ),
    )
    await t.turn(
      { calls: [{ name: 'bash', arguments: JSON.stringify({ command: 'echo hi' }) }] },
      { text: 'ok' },
    )
    expect(t.io.shellCalls).toEqual([])
    expect(t.api.responseBodies()).toHaveLength(2)
  })

  it('the session’s dispose ends a straggler: an async plugin hook its finished turn left running', async () => {
    const marker = path.join(mkdtempSync(path.join(tmpdir(), 'm91b-pid-')), 'pid')
    const t = await session(
      ampGuard(
        `amp.on('tool.call', async () => { (await import('node:fs')).writeFileSync(${JSON.stringify(marker)}, String(process.pid)); await new Promise((resolve) => setTimeout(resolve, 60000)) })`,
        { async: true },
      ),
    )
    // The turn ends; the asynchronous hook's child is still running.
    await t.turn(
      { calls: [{ name: 'bash', arguments: JSON.stringify({ command: 'echo hi' }) }] },
      { text: 'ok' },
    )
    await vi.waitFor(
      () => {
        expect(readFileSync(marker, 'utf8')).not.toBe('')
      },
      { timeout: 15_000 },
    )
    const pid = Number(readFileSync(marker, 'utf8'))
    expect(isRunning(pid)).toBe(true)
    t.session.dispose()
    // Well before the hook's own 30-second timeout would end it.
    await vi.waitFor(
      () => {
        expect(isRunning(pid)).toBe(false)
      },
      { timeout: 5000 },
    )
  })

  it('the session’s dispose ends a plugin child still running', async () => {
    const marker = path.join(mkdtempSync(path.join(tmpdir(), 'm91b-pid-')), 'pid')
    const t = await session(
      ampGuard(
        `amp.on('tool.call', async () => { (await import('node:fs')).writeFileSync(${JSON.stringify(marker)}, String(process.pid)); await new Promise((resolve) => setTimeout(resolve, 60000)) })`,
      ),
    )
    t.api.script(
      { calls: [{ name: 'bash', arguments: JSON.stringify({ command: 'echo hi' }) }] },
      { text: 'ok' },
    )
    void t.session.sendTurn([{ type: 'text', text: 'go' }]).catch(() => undefined)
    await vi.waitFor(
      () => {
        expect(readFileSync(marker, 'utf8')).not.toBe('')
      },
      { timeout: 15_000 },
    )
    const pid = Number(readFileSync(marker, 'utf8'))
    expect(isRunning(pid)).toBe(true)
    t.session.dispose()
    await vi.waitFor(
      () => {
        expect(isRunning(pid)).toBe(false)
      },
      { timeout: 5000 },
    )
    expect(t.io.shellCalls).toEqual([])
  })
})
