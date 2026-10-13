// TOOLCAP: one tool result can never end a conversation. The measured case
// (ten 400,000-character lines through the command tool, ~940,000 tokens on
// the wire, then `prompt is too long` refusals forever) through the real
// `ModelApiHost` over the fake Model API: every tool result enters through
// the one bound, cuts keep a spill with notices, and a refusal recovers in
// order with a bounded number of sends.
import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import {
  OVERFLOW_MAX_REQUEST_SENDS,
  TOOL_OUTPUT_MAX_CHARS,
  TOOL_RESULT_MAX_LINE_CHARS,
} from '../../src/shared/constants'
import {
  ModelApiHost,
  ModelApiSession,
  type ModelApiHostDeps,
} from '../../src/core/backends/modelapi/ModelApiHost'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { parseHookConfig } from '../../src/core/backends/modelapi/hooks'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
  fakeModelApi,
  fakeModelApiClientSettings,
  responseOutputsByCall,
  type FakeModelApi,
} from './helpers/fakeModelApi'
import { fakeMcpSource } from './helpers/fakeMcpSource'
import { memoryToolIo } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { watchSessionTurns } from './helpers/sessionTurns'

const ROOT = '/ws'
// The measured case: ten lines, some megabytes long.
const FLOOD_LINE = 'x'.repeat(400_000)
const FLOOD = Array.from({ length: 10 }, (_, index) => `line${String(index)}:${FLOOD_LINE}`).join(
  '\n',
)
const FLOOD_MIDDLE = 'FLOOD_CANARY_MIDDLE_9'
// A large result with short lines: under the token cap, over a small window's share.
const MEDIUM = Array.from(
  { length: 60 },
  (_, index) => `m${String(index)}:${'m'.repeat(990)}`,
).join('\n')
const EXIT_LINE = '\n[exit code 0]'

function floodWithCanary(): string {
  const lines = FLOOD.split('\n')
  const middle = lines[5] ?? ''
  lines[5] = `${middle.slice(0, 200_000)}${FLOOD_MIDDLE}${middle.slice(200_000)}`
  return lines.join('\n')
}

interface Harness {
  readonly api: FakeModelApi
  readonly host: ModelApiHost
  readonly session: ModelApiSession
  readonly events: AgentEvent[]
  readonly turnDone: () => Promise<void>
  readonly io: ReturnType<typeof memoryToolIo>
}

interface StartOptions {
  readonly packing?: boolean
  readonly files?: Record<string, string>
  readonly shell?: (command: string) => string
  readonly hostChanges?: Partial<ModelApiHostDeps>
  readonly runHook?: NonNullable<ReturnType<typeof memoryToolIo>['runHook']>
}

async function startHost(options: StartOptions = {}): Promise<Harness> {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo(options.files ?? {}, ROOT, (command) => ({
    stdout: options.shell === undefined ? FLOOD : options.shell(command),
    stderr: '',
    exitCode: 0,
    isTimedOut: false,
    isCancelled: false,
  }))
  if (options.runHook !== undefined) io.runHook = options.runHook
  const client = new ModelApiClient({
    ...fakeModelApiClientSettings(log),
    fetch: api.fetch,
  })
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client, workspaceRoot: ROOT, io, log }),
    ...(options.packing === true && { observationPacking: () => true }),
    ...options.hostChanges,
  })
  const session = await host.startSession({
    workspaceRoot: ROOT,
    modelId: 'muse-spark-1.3',
    approvalMode: 'allowAll',
  })
  if (!(session instanceof ModelApiSession)) {
    throw new TypeError('expected the Model API session')
  }
  return { api, host, session, io, ...watchSessionTurns(session) }
}

async function runFlood(harness: Harness, callId = 'flood-1'): Promise<void> {
  harness.api.script(
    { calls: [{ name: 'bash', arguments: '{"command":"grep glimmer"}', callId }] },
    { text: 'done' },
  )
  await harness.session.sendTurn([{ type: 'text', text: 'run it' }])
  await harness.turnDone()
}

/** One scripted provider refusal carrying the message (kept in one place: the recovery tests script it five times between them). */
function refusalEntry(message: string): {
  readonly httpError: {
    readonly status: number
    readonly body: { readonly error: { readonly message: string; readonly type: string } }
  }
} {
  return {
    httpError: { status: 400, body: { error: { message, type: 'invalid_request_error' } } },
  }
}

async function runBig(harness: Harness): Promise<void> {
  harness.api.script(
    { calls: [{ name: 'bash', arguments: '{"command":"big"}', callId: 'big-1' }] },
    { text: 'first done' },
  )
  await harness.session.sendTurn([{ type: 'text', text: 'run big' }])
  await harness.turnDone()
}

function requestOutput(harness: Harness, index: number, callId: string): string {
  const output = responseOutputsByCall(harness.api, index).get(callId)
  if (output === undefined) throw new Error(`request ${String(index)} carries no ${callId}`)
  return output
}

function spillPaths(harness: Harness): string[] {
  const paths: string[] = []
  for (const key of harness.io.files.keys()) {
    const slash = key.replaceAll('\\', '/')
    if (slash.includes('/.muse-spark/tool-results/') && !slash.endsWith('.gitignore')) {
      paths.push(key)
    }
  }
  return paths
}

describe('TOOLCAP measured case: ten megabyte lines through the command tool', () => {
  it('packing off: the request carries the cut form with counts and a spill, never the flood', async () => {
    const h = await startHost()
    await runFlood(h)
    const output = requestOutput(h, 1, 'flood-1')
    // Bounded: the cut plus its one-line notice, far from the ~4 MB flood.
    expect(output.length).toBeLessThan(TOOL_OUTPUT_MAX_CHARS + 2000)
    expect(output).toContain('Tool result cut:')
    expect(output).toContain('characters omitted in the middle')
    // The longest line is named (the measured failure was line length).
    expect(output).toContain('longest line 400')
    expect(output).toContain(`cut to ${String(TOOL_RESULT_MAX_LINE_CHARS)}`)
    // The exact way to read more: the spill path and the recall id.
    const spill = /\.muse-spark\/tool-results\/[A-Za-z0-9_.-]+\.txt/.exec(output)?.[0]
    expect(spill).toBeDefined()
    expect(output).toContain('recall_output id "flood-1"')
    // The full runner output is kept where the file tools can page it.
    expect(spillPaths(h)).toHaveLength(1)
    expect(h.io.files.get(`${ROOT}/${spill ?? ''}`)?.length).toBe(FLOOD.length + EXIT_LINE.length)
    await h.host.close()
  })

  it('packing off: the person reads the same cut in plain words', async () => {
    const h = await startHost()
    await runFlood(h)
    const completed = h.events.find(
      (event) => event.type === 'itemCompleted' && event.item.tool === 'bash',
    )
    if (completed?.type !== 'itemCompleted') throw new Error('missing bash row')
    const visible = (completed.item as { visibleOutput?: unknown }).visibleOutput
    expect(typeof visible === 'string' ? visible : '').toContain('Tool result cut:')
    expect(typeof visible === 'string' ? visible : '').toContain('.muse-spark/tool-results/')
    await h.host.close()
  })

  it('packing on: the first send is cut with a spill, and recall pages the middle back', async () => {
    const h = await startHost({ packing: true, shell: () => floodWithCanary() })
    await runFlood(h)
    const output = requestOutput(h, 1, 'flood-1')
    expect(output).not.toContain(FLOOD_MIDDLE)
    expect(output.length).toBeLessThan(TOOL_OUTPUT_MAX_CHARS + 2000)
    expect(output).toContain('Tool result cut:')
    // The middle survived only in the spill: recall pages it back in bounded pieces.
    h.api.script(
      {
        calls: [
          {
            name: 'recall_output',
            arguments: JSON.stringify({ id: 'flood-1', search: FLOOD_MIDDLE }),
            callId: 'r1',
          },
        ],
      },
      { text: 'recovered' },
    )
    await h.session.sendTurn([{ type: 'text', text: 'page it back' }])
    await h.turnDone()
    expect(requestOutput(h, 3, 'r1')).toContain(FLOOD_MIDDLE)
    await h.host.close()
  })

  it('line cap: long lines are cut even when the total fits the token cap', async () => {
    const h = await startHost({
      shell: () => ['a'.repeat(20_000), 'b'.repeat(20_000), 'tail'].join('\n'),
    })
    await runFlood(h)
    const output = requestOutput(h, 1, 'flood-1')
    expect(output).toContain('longest line 20000')
    expect(output).toContain(`cut to ${String(TOOL_RESULT_MAX_LINE_CHARS)}`)
    await h.host.close()
  })

  it('requests without an oversized result stay byte-identical: no notice, no spill', async () => {
    const h = await startHost({ shell: () => 'short output' })
    await runFlood(h)
    const output = requestOutput(h, 1, 'flood-1')
    expect(output).toContain('short output')
    expect(output).not.toContain('Tool result cut:')
    expect(spillPaths(h)).toHaveLength(0)
    await h.host.close()
  })
})

describe('TOOLCAP per kind: no silent cut anywhere', () => {
  it('read_file: a small read rides whole; past the window share it is cut with a spill', async () => {
    const big = `${'y'.repeat(1000)}\n`.repeat(300)
    const h = await startHost({
      files: { 'big.txt': big, 'small.txt': 'tiny\n' },
      hostChanges: { contextModel: () => ({ format: 'responses', contextTokens: 50_000 }) },
    })
    h.api.script(
      { calls: [{ name: 'read_file', arguments: '{"path":"small.txt"}', callId: 'read-small' }] },
      { text: 'read it' },
    )
    await h.session.sendTurn([{ type: 'text', text: 'read small' }])
    await h.turnDone()
    expect(requestOutput(h, 1, 'read-small')).not.toContain('Tool result cut:')
    h.api.script(
      { calls: [{ name: 'read_file', arguments: '{"path":"big.txt"}', callId: 'read-1' }] },
      { text: 'read it' },
    )
    await h.session.sendTurn([{ type: 'text', text: 'read big' }])
    await h.turnDone()
    const output = requestOutput(h, 3, 'read-1')
    expect(output.length).toBeLessThan(TOOL_OUTPUT_MAX_CHARS + 2000)
    expect(output).toContain('Tool result cut:')
    expect(output).toContain('recall_output id "read-1"')
    expect(spillPaths(h)).toHaveLength(1)
    await h.host.close()
  })

  it('search: a capped hit list rides; past the window share it is cut', async () => {
    const hits = Array.from(
      { length: 200 },
      (_, index) => `hit-${String(index)}-${'z'.repeat(400)}`,
    )
    const h = await startHost({
      files: { 'hay.txt': hits.join('\n') },
      hostChanges: { contextModel: () => ({ format: 'responses', contextTokens: 50_000 }) },
    })
    h.api.script(
      { calls: [{ name: 'search', arguments: '{"pattern":"hit-"}', callId: 'search-1' }] },
      { text: 'found' },
    )
    await h.session.sendTurn([{ type: 'text', text: 'search it' }])
    await h.turnDone()
    const output = requestOutput(h, 1, 'search-1')
    expect(output.length).toBeLessThan(TOOL_OUTPUT_MAX_CHARS + 2000)
    expect(output).toContain('Tool result cut:')
    await h.host.close()
  })

  it('list_files: thousands of names are cut with a spill', async () => {
    const files: Record<string, string> = {}
    for (let index = 0; index < 5000; index += 1) files[`file-${String(index)}.txt`] = 'x'
    const h = await startHost({ files })
    h.api.script(
      { calls: [{ name: 'list_files', arguments: '{"limit":5000}', callId: 'list-1' }] },
      { text: 'listed' },
    )
    await h.session.sendTurn([{ type: 'text', text: 'list them' }])
    await h.turnDone()
    const output = requestOutput(h, 1, 'list-1')
    expect(output.length).toBeLessThan(TOOL_OUTPUT_MAX_CHARS + 2000)
    expect(output).toContain('Tool result cut:')
    expect(output).toContain('recall_output id "list-1"')
    await h.host.close()
  })

  it('mcp: an untrusted server flood is cut with a spill, never ridden whole', async () => {
    const mcp = fakeMcpSource([{ server: 'docs', tool: 'lookup' }])
    mcp.outcomes = [{ output: FLOOD, visibleOutput: 'shown' }]
    const h = await startHost({ hostChanges: { mcpServers: mcp } })
    h.api.script(
      { calls: [{ name: 'mcp__docs__lookup', arguments: '{}', callId: 'mcp-1' }] },
      { text: 'looked up' },
    )
    await h.session.sendTurn([{ type: 'text', text: 'look it up' }])
    await h.turnDone()
    const output = requestOutput(h, 1, 'mcp-1')
    expect(output.length).toBeLessThan(TOOL_OUTPUT_MAX_CHARS + 2000)
    expect(output).toContain('Tool result cut:')
    expect(output).toContain('recall_output id "mcp-1"')
    expect(spillPaths(h)).toHaveLength(1)
    expect(h.io.files.get(spillPaths(h)[0] ?? '')?.length).toBe(FLOOD.length)
    await h.host.close()
  })

  it('hooks: oversized additional context is cut with a spill', async () => {
    const context = Array.from(
      { length: 100 },
      (_, index) => `ctx-${String(index)}-${'c'.repeat(1000)}`,
    ).join('\n')
    const h = await startHost({
      hostChanges: {
        loadHooks: () =>
          Promise.resolve(
            parseHookConfig(
              JSON.stringify({
                hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'hi' }] }] },
              }),
              'project',
              'linux',
            ).hooks,
          ),
      },
      runHook: () =>
        Promise.resolve({
          stdout: JSON.stringify({
            hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
          }),
          stderr: '',
          exitCode: 0,
          isTimedOut: false,
          isCancelled: false,
        }),
    })
    h.api.script({ text: 'hello' })
    await h.session.sendTurn([{ type: 'text', text: 'hello' }])
    await h.turnDone()
    const first = JSON.stringify(h.api.responseBodies()[0]?.['input'])
    expect(first).toContain('Tool result cut:')
    expect(spillPaths(h).length).toBeGreaterThanOrEqual(1)
    await h.host.close()
  })

  it('user shell: the own command flood is cut with a spill', async () => {
    const h = await startHost()
    await h.session.runUserShell('grep glimmer')
    h.api.script({ text: 'noted' })
    await h.session.sendTurn([{ type: 'text', text: 'noted?' }])
    await h.turnDone()
    const first = JSON.stringify(h.api.responseBodies()[0]?.['input'])
    expect(first).toContain('Tool result cut:')
    expect(spillPaths(h)).toHaveLength(1)
    await h.host.close()
  })
})

describe('TOOLCAP window share: the same result is cut for a small window', () => {
  it('a medium result rides a 1M window whole and is cut for a 60k one', async () => {
    const medium = Array.from(
      { length: 40 },
      (_, index) => `w${String(index)}:${'w'.repeat(990)}`,
    ).join('\n')
    let window = 1_048_576
    const h = await startHost({
      shell: () => medium,
      hostChanges: { contextModel: () => ({ format: 'responses', contextTokens: window }) },
    })
    await runFlood(h, 'w-1')
    expect(requestOutput(h, 1, 'w-1')).not.toContain('Tool result cut:')
    window = 60_000
    h.api.script(
      { calls: [{ name: 'bash', arguments: '{"command":"again"}', callId: 'w-2' }] },
      { text: 'done' },
    )
    await h.session.sendTurn([{ type: 'text', text: 'again' }])
    await h.turnDone()
    const bodies = h.api.responseBodies()
    const second = responseOutputsByCall(h.api, bodies.length - 1).get('w-2') ?? ''
    expect(second).toContain('Tool result cut:')
    await h.host.close()
  })
})

async function setupWindowed(window: { current: number }): Promise<Harness> {
  return await startHost({
    shell: () => MEDIUM,
    hostChanges: { contextModel: () => ({ format: 'responses', contextTokens: window.current }) },
  })
}

describe('TOOLCAP recovery: the refusal is answered trim, then compact, then truth', () => {
  const REFUSAL = 'prompt is too long: 1002881 tokens > 1000000 maximum'

  it('trims the largest riding result and sends again once', async () => {
    const window = { current: 1_048_576 }
    // Under the 1M window the medium result rides whole (no cut, no spill yet).
    const h = await setupWindowed(window)
    const api = h.api
    await runBig(h)
    expect(requestOutput(h, 1, 'big-1')).not.toContain('Tool result cut:')
    // The window shrinks (a smaller model): the next send is refused, the
    // trim cuts the riding result to the new share, one resend succeeds.
    window.current = 100_000
    api.script(refusalEntry(REFUSAL), { text: 'second done' })
    await h.session.sendTurn([{ type: 'text', text: 'continue' }])
    await h.turnDone()
    expect(api.responseBodies()).toHaveLength(4)
    const resent = responseOutputsByCall(api, 3).get('big-1') ?? ''
    expect(resent).toContain('Tool result cut:')
    expect(h.events.find((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'completed',
    })
    await h.host.close()
  })

  it('ends the turn with the true sentence after the bounded sends, conversation intact', async () => {
    const h = await startHost({ shell: () => 'short output' })
    h.api.script(refusalEntry(REFUSAL), refusalEntry(REFUSAL))
    await h.session.sendTurn([{ type: 'text', text: 'hello' }])
    await h.turnDone()
    // Trim found nothing to cut and compaction is inactive here: under the
    // three-send ceiling, then the truth. Never loops.
    expect(h.api.responseBodies().length).toBeLessThanOrEqual(OVERFLOW_MAX_REQUEST_SENDS)
    const done = h.events.find((event) => event.type === 'turnCompleted')
    expect(done).toMatchObject({ terminal: 'failed', errorKind: 'context_overflow' })
    const reason = (done as { readonly reason?: unknown } | undefined)?.reason
    expect(typeof reason).toBe('string')
    expect(reason as string).toContain('1,002,881')
    expect(reason as string).toContain('1,000,000')
    expect(reason as string).toContain('/compact')
    expect(reason as string).toContain('nothing was deleted')
    // The conversation is intact and usable after that action.
    h.api.script({ text: 'recovered' })
    await h.session.sendTurn([{ type: 'text', text: 'again' }])
    await h.turnDone()
    expect(h.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'completed',
    })
    await h.host.close()
  })

  it('without the provider numbers the end sentence falls back to the short form', async () => {
    const h = await startHost({ shell: () => 'short output' })
    h.api.script({
      httpError: {
        status: 400,
        body: { error: { code: 'context_length_exceeded', message: 'This model has no room' } },
      },
    })
    await h.session.sendTurn([{ type: 'text', text: 'hello' }])
    await h.turnDone()
    const done = h.events.find((event) => event.type === 'turnCompleted')
    expect(done).toMatchObject({ terminal: 'failed', errorKind: 'context_overflow' })
    // No numbers were proven, so no cause is stated: the short sentence.
    expect((done as { readonly reason?: unknown } | undefined)?.reason).toBe(
      'Context window full: /compact or /handoff',
    )
    await h.host.close()
  })

  it('never resends more than the stated bound while trimming', async () => {
    const window = { current: 1_048_576 }
    const h = await setupWindowed(window)
    await runBig(h)
    window.current = 100_000
    // The trimmed resend is refused too; compaction is inactive: the turn
    // fails after exactly two sends for this turn, never more.
    const before = h.api.responseBodies().length
    h.api.script(refusalEntry(REFUSAL), refusalEntry(REFUSAL))
    await h.session.sendTurn([{ type: 'text', text: 'continue' }])
    await h.turnDone()
    expect(h.api.responseBodies().length - before).toBe(2)
    expect(h.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'failed',
      errorKind: 'context_overflow',
    })
    await h.host.close()
  })
})

describe('TOOLCAP setting: an unusable cap is refused with its reason', () => {
  it('a cap below the readable floor falls back to the default, said once', async () => {
    const h = await startHost({ hostChanges: { maxToolOutputBytes: () => 10 } })
    await runFlood(h)
    const output = requestOutput(h, 1, 'flood-1')
    // The 10-byte cap was refused: the default bound applied instead.
    expect(output.length).toBeGreaterThan(1000)
    expect(output).toContain('Tool result cut:')
    const notices = h.events.filter((event) => event.type === 'backendNotice')
    expect(notices.length).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(notices)).toContain('refused')
    await h.host.close()
  })
})
