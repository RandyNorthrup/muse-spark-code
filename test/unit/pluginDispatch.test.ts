// M91b: Amp and OpenCode plugin hooks, end to end through the dispatcher.
// Records are parsed from spark-hooks.json as lane I's importer writes them;
// dispatch runs them under the host-wide cap and the same judge as every
// imported hook; pluginFormats.ts maps each payload and answer, tool names
// and arguments included. Real children run under this node (OpenCode's bun
// stood in for), each in its own process group; no model is called.

import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  dispatchHooks,
  parseForeignHooks,
  type ForeignHookAdapter,
  type HookAnswer,
  type HookDefinition,
  type HookEvent,
} from '../../src/core/backends/modelapi/hooks'
import {
  createForeignHookAdapter,
  type PluginHostDeps,
} from '../../src/core/backends/modelapi/foreignHooksEntry'
import {
  pluginAnswer,
  pluginArguments,
  pluginRequest,
  pluginToolName,
  runtimeArguments,
} from '../../src/core/backends/modelapi/pluginFormats'
import { HOOK_MAX_RUNNING_COMMANDS, MODEL_API_TOOLS } from '../../src/shared/constants'
import { expectEnded, markedPid } from './helpers/processes'

const ROOT = '/ws'
const VERSION_MATCH = /^v(\d+)\.(\d+)\./.exec(process.version)
const HAS_NODE =
  VERSION_MATCH !== null &&
  (Number(VERSION_MATCH[1]) > 22 ||
    (Number(VERSION_MATCH[1]) === 22 && Number(VERSION_MATCH[2]) >= 18))
const IS_REAL = HAS_NODE && process.platform !== 'win32'
/** The installed bun, where a rig has one (Kubuntu's ~/.bun); CI has none. */
const BUN = [path.join(process.env['HOME'] ?? '', '.bun', 'bin', 'bun')].find((file) =>
  existsSync(file),
)

function group(
  format: string,
  sourceEvent: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    format,
    sourceEvent,
    plugin: '/home/u/.config/amp/plugins/guard.ts',
    hooks: [{ type: 'plugin' }],
    ...extra,
  }
}

function parsed(event: string, entry: Record<string, unknown>) {
  return parseForeignHooks(JSON.stringify({ hooks: { [event]: [entry] } }), 'user', 'linux')
}

describe('plugin records in spark-hooks.json', () => {
  it('accepts an Amp or OpenCode group with a plugin handler and an absolute path', () => {
    const amp = parsed('PreToolUse', group('amp', 'tool.call'))
    expect(amp.warnings).toEqual([])
    expect(amp.hooks).toHaveLength(1)
    const [hook] = amp.hooks
    expect(hook).toMatchObject({
      event: 'PreToolUse',
      command: '/home/u/.config/amp/plugins/guard.ts',
      timeoutSeconds: 30,
      foreign: {
        format: 'amp',
        sourceEvent: 'tool.call',
        plugin: '/home/u/.config/amp/plugins/guard.ts',
      },
    })
    const oc = parsed(
      'PostToolUse',
      group('opencode', 'event:file.edited', {
        matcher: 'Edit|Write',
        hooks: [{ type: 'plugin', timeout: 5 }],
      }),
    )
    expect(oc.warnings).toEqual([])
    expect(oc.hooks[0]?.timeoutSeconds).toBe(5)
    expect(oc.hooks[0]?.matcher).toEqual({ kind: 'exact', names: new Set(['Edit', 'Write']) })
  })

  it.each([
    ['a relative path', group('amp', 'tool.call', { plugin: 'plugins/guard.ts' }), 'absolute'],
    [
      'a path not in its normal form',
      group('amp', 'tool.call', { plugin: '/a/../b/guard.ts' }),
      'absolute',
    ],
    [
      'no plugin path',
      { format: 'amp', sourceEvent: 'tool.call', hooks: [{ type: 'plugin' }] },
      'absolute',
    ],
    [
      'a command handler',
      group('amp', 'tool.call', { hooks: [{ type: 'command', command: 'x' }] }),
      'unsupported handler field command',
    ],
    [
      'a plugin handler with a command type',
      group('opencode', 'tool.execute.before', { hooks: [{ type: 'command' }] }),
      'handler type must be plugin',
    ],
    [
      'a timeout past the native bound',
      group('amp', 'tool.call', { hooks: [{ type: 'plugin', timeout: 601 }] }),
      'exceeds',
    ],
    [
      'an unknown handler field',
      group('amp', 'tool.call', { hooks: [{ type: 'plugin', env: {} }] }),
      'unsupported handler field env',
    ],
    [
      'a plugin path on another format',
      {
        format: 'cursor',
        sourceEvent: 'preToolUse',
        plugin: '/p.js',
        hooks: [{ type: 'command', command: 'x' }],
      },
      'plugin is Amp',
    ],
  ])('refuses %s', (_name, entry, reason) => {
    const result = parsed('PreToolUse', entry)
    expect(result.hooks).toEqual([])
    expect(result.warnings.join('\n')).toContain(reason)
  })

  it('keeps refusing a plugin handler in every other format', () => {
    const result = parsed('PreToolUse', {
      format: 'cursor',
      sourceEvent: 'preToolUse',
      hooks: [{ type: 'plugin' }],
    })
    expect(result.hooks).toEqual([])
    // Lane H's native handler set, which never includes plugin.
    expect(result.warnings.join('\n')).toContain('handler type must be one of command')
  })
})

describe('tool names and arguments as each source shows them', () => {
  it('names our tools as Amp and OpenCode do (AS:51, OP:94, OP:251, OS:117-160)', () => {
    expect(pluginToolName('amp', MODEL_API_TOOLS.bash)).toBe('Bash')
    expect(pluginToolName('amp', MODEL_API_TOOLS.readFile)).toBe('Read')
    expect(pluginToolName('amp', MODEL_API_TOOLS.editFile)).toBe('edit_file')
    expect(pluginToolName('amp', MODEL_API_TOOLS.writeFile)).toBe('create_file')
    expect(pluginToolName('opencode', MODEL_API_TOOLS.bash)).toBe('bash')
    expect(pluginToolName('opencode', MODEL_API_TOOLS.powershell)).toBe('bash')
    expect(pluginToolName('opencode', MODEL_API_TOOLS.readFile)).toBe('read')
    expect(pluginToolName('opencode', MODEL_API_TOOLS.editFile)).toBe('edit')
    expect(pluginToolName('opencode', MODEL_API_TOOLS.writeFile)).toBe('write')
    // No source shows a name: the runtime's own is kept.
    expect(pluginToolName('opencode', 'mcp__db__query')).toBe('mcp__db__query')
    expect(pluginToolName('amp', MODEL_API_TOOLS.askUser)).toBe(MODEL_API_TOOLS.askUser)
  })

  it('renames only the arguments a source shows, and back for the same tool', () => {
    const read = { path: 'src/a.ts', offset: 1 }
    expect(pluginArguments('opencode', MODEL_API_TOOLS.readFile, read)).toEqual({
      filePath: 'src/a.ts',
      offset: 1,
    })
    expect(
      runtimeArguments('opencode', MODEL_API_TOOLS.readFile, { filePath: 'b.ts', offset: 1 }),
    ).toEqual({
      path: 'b.ts',
      offset: 1,
    })
    expect(pluginArguments('opencode', MODEL_API_TOOLS.bash, { command: 'ls' })).toEqual({
      command: 'ls',
    })
    expect(pluginArguments('amp', MODEL_API_TOOLS.readFile, read)).toEqual(read)
    // Another tool's names are never touched.
    expect(runtimeArguments('opencode', MODEL_API_TOOLS.editFile, { filePath: 'x' })).toEqual({
      filePath: 'x',
    })
  })

  it('builds the source payloads and maps their answers back', () => {
    const payload = {
      session_id: 's1',
      turn_id: 't1',
      tool_name: MODEL_API_TOOLS.readFile,
      tool_input: { path: '.env' },
      tool_use_id: 'u1',
    }
    const before = pluginRequest('opencode', 'tool.execute.before', 'PreToolUse', payload, 0)
    expect(before).toMatchObject({
      outcome: 'run',
      call: {
        system: 'opencode',
        hook: 'tool.execute.before',
        failClosed: true,
        payload: { tool: 'read', sessionID: 's1', callID: 'u1', args: { filePath: '.env' } },
      },
    })
    const call = pluginRequest(
      'amp',
      'tool.call',
      'PreToolUse',
      { ...payload, tool_name: 'bash', tool_input: { command: 'ls' } },
      0,
    )
    expect(call).toMatchObject({
      call: {
        failClosed: false,
        payload: {
          tool: 'Bash',
          toolUseID: 'u1',
          input: { command: 'ls' },
          thread: { id: 'T-s1' },
        },
      },
    })
    expect(pluginRequest('amp', 'tool.call', 'PostToolUse', payload, 0)).toMatchObject({
      outcome: 'refused',
    })
    const narrowed = pluginAnswer(
      'opencode',
      'PreToolUse',
      { status: 'completed', updatedInput: { filePath: 'safe.txt' } },
      payload,
    )
    expect(narrowed).toEqual({ status: 'completed', updatedInput: { path: 'safe.txt' } })
    const synthesized: HookAnswer = pluginAnswer(
      'amp',
      'PreToolUse',
      { status: 'completed', replacement: { target: 'toolResult', value: { output: 'fake' } } },
      payload,
    )
    expect(synthesized).toEqual({ status: 'blocked', reason: 'fake' })
    expect(
      pluginAnswer(
        'amp',
        'PostToolUse',
        {
          status: 'completed',
          replacement: { target: 'toolResult', value: { status: 'done', output: 'new' } },
        },
        payload,
      ),
    ).toEqual({ status: 'completed', replacement: { target: 'toolResult', value: 'new' } })
  })
})

function writePlugin(source: string, name = 'plugin.mjs'): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'm91b-plugin-'))
  const file = path.join(dir, name)
  writeFileSync(file, source)
  return file
}

/** The host side for real children: this node, standing in for bun too. */
function host(warnings: string[] = []): PluginHostDeps {
  const dir = mkdtempSync(path.join(tmpdir(), 'm91b-bin-'))
  const bun = path.join(dir, 'bun')
  // A `bun` beside a real `prlimit`-free PATH: on Linux the host bounds bun
  // with prlimit, so the stand-in is spawned through the real tool below.
  writeFileSync(bun, `#!/bin/sh\nexec "${process.execPath}" --input-type=module "$@"\n`, {
    mode: 0o755,
  })
  return {
    env: { PATH: `${path.dirname(process.execPath)}:${dir}:/usr/bin:/bin` },
    containment: () => Promise.resolve({ kind: 'processGroup' }),
    warn: (message) => {
      warnings.push(message)
    },
    now: () => 0,
  }
}

function adapterWith(plugins: PluginHostDeps | undefined): ForeignHookAdapter {
  return createForeignHookAdapter({
    workspaceRoot: ROOT,
    platform: process.platform,
    io: { realPath: (absolutePath) => Promise.resolve(absolutePath) },
    homeDir: '/home/u',
    ...(plugins !== undefined && { plugins }),
  })
}

function definitions(
  event: HookEvent,
  format: string,
  sourceEvent: string,
  plugin: string,
  extra: Record<string, unknown> = {},
): readonly HookDefinition[] {
  const result = parseForeignHooks(
    JSON.stringify({
      hooks: {
        [event]: [
          { format, sourceEvent, plugin, hooks: [{ type: 'plugin', timeout: 20 }], ...extra },
        ],
      },
    }),
    'user',
    process.platform,
  )
  expect(result.warnings).toEqual([])
  return result.hooks
}

const noRunner = {
  runHook: () => Promise.reject(new Error('no plugin hook runs natively')),
}

function toolPayload(
  event: HookEvent,
  tool: string,
  input: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return {
    hook_event_name: event,
    session_id: 's1',
    turn_id: 't1',
    cwd: ROOT,
    tool_name: tool,
    tool_input: input,
    tool_use_id: 'u1',
    ...extra,
  }
}

async function dispatch(
  hooks: readonly HookDefinition[],
  event: HookEvent,
  payload: Record<string, unknown>,
  adapter: ForeignHookAdapter,
  warnings: string[] = [],
) {
  return await dispatchHooks(
    hooks,
    event,
    payload,
    typeof payload['tool_name'] === 'string' ? payload['tool_name'] : '',
    noRunner,
    undefined,
    (warning) => {
      warnings.push(warning)
    },
    // No typed handlers here (lane H's position), then the adapter.
    undefined,
    adapter,
  )
}

function ampPlugin(body: string): string {
  return writePlugin(`export default function (amp) {\n${body}\n}\n`, 'guard.mjs')
}

/** One Amp tool.call guard whose handler answers `answer`, dispatched on `bash ls`. */
async function ampToolCall(answer: string) {
  const plugin = ampPlugin(`amp.on('tool.call', () => ${answer})`)
  return await dispatch(
    definitions('PreToolUse', 'amp', 'tool.call', plugin),
    'PreToolUse',
    toolPayload('PreToolUse', 'bash', { command: 'ls' }),
    adapterWith(host()),
  )
}

describe.runIf(IS_REAL)('plugin dispatch with real children', () => {
  it('an Amp reject-and-continue blocks; the guard sees Bash and its command', async () => {
    const plugin = ampPlugin(
      `amp.on('tool.call', (event) => { const shell = amp.helpers.shellCommandFromToolCall(event); return shell?.command.startsWith('rm') ? { action: 'reject-and-continue', message: 'no rm: ' + event.tool } : { action: 'allow' } })`,
    )
    const hooks = definitions('PreToolUse', 'amp', 'tool.call', plugin)
    const result = await dispatch(
      hooks,
      'PreToolUse',
      toolPayload('PreToolUse', 'bash', { command: 'rm -rf /' }),
      adapterWith(host()),
    )
    expect(result.blockedReason).toBe('no rm: Bash')
    const allowed = await dispatch(
      hooks,
      'PreToolUse',
      toolPayload('PreToolUse', 'bash', { command: 'ls' }),
      adapterWith(host()),
    )
    expect(allowed.blockedReason).toBeUndefined()
    // An allow never grants: the card still shows.
    expect(allowed.approvalDecision).toBeUndefined()
    expect(allowed.forceApproval).toBe(false)
  })

  it('an Amp error refuses the call and ends the turn, whatever the fail-open rule', async () => {
    const result = await ampToolCall(`({ action: 'error', message: 'stop the thread' })`)
    expect(result.blockedReason).toBe('stop the thread')
    expect(result.stopReason).toBe('stop the thread')
  })

  it('an Amp synthesize never runs the tool; its output is what the model reads', async () => {
    const result = await ampToolCall(
      `({ action: 'synthesize', result: { output: 'cached answer' } })`,
    )
    expect(result.blockedReason).toBe('cached answer')
  })

  it('an Amp handler crash fails open and is said in the log', async () => {
    const warnings: string[] = []
    const plugin = ampPlugin(`amp.on('tool.call', () => { process.exit(3) })`)
    const hooks = definitions('PreToolUse', 'amp', 'tool.call', plugin)
    const result = await dispatch(
      hooks,
      'PreToolUse',
      toolPayload('PreToolUse', 'bash', { command: 'ls' }),
      adapterWith(host()),
      warnings,
    )
    expect(result.blockedReason).toBeUndefined()
    expect(warnings.join('\n')).toContain('amp-format user hook failed')
  })

  it('Amp tool.result and agent.end get every field their types require (P2 15)', async () => {
    const plugin = ampPlugin(
      [
        `amp.on('tool.result', (event) => ({ status: 'done', output: event.toolUseID + ':' + event.output }))`,
        `amp.on('agent.end', (event) => ({ action: 'continue', userMessage: 'again ' + event.messages.length + ' ' + event.messages[0].content[0].text }))`,
      ].join('\n'),
    )
    const after = await dispatch(
      definitions('PostToolUse', 'amp', 'tool.result', plugin),
      'PostToolUse',
      toolPayload('PostToolUse', 'bash', { command: 'ls' }, { tool_response: 'out' }),
      adapterWith(host()),
    )
    expect(after.replacement).toEqual({ target: 'toolResult', value: 'u1:out' })
    const stop = await dispatch(
      definitions('Stop', 'amp', 'agent.end', plugin),
      'Stop',
      { hook_event_name: 'Stop', session_id: 's1', turn_id: 't1', last_assistant_message: 'done' },
      adapterWith(host()),
    )
    // A continue is a Stop block (the turn goes on), never a stop.
    expect(stop.blockedReason).toBe('again 1 done')
    expect(stop.stopReason).toBeUndefined()
  })

  it('an OpenCode throw blocks; a crash blocks by its fail-closed rule', async () => {
    const throwing = writePlugin(
      `export const EnvProtection = async () => ({ 'tool.execute.before': async (input, output) => { if (input.tool === 'read' && output.args.filePath.includes('.env')) throw new Error('Do not read .env files') } })`,
    )
    const hooks = definitions('PreToolUse', 'opencode', 'tool.execute.before', throwing)
    const blocked = await dispatch(
      hooks,
      'PreToolUse',
      toolPayload('PreToolUse', MODEL_API_TOOLS.readFile, { path: '.env' }),
      adapterWith(host()),
    )
    expect(blocked.blockedReason).toBe('Do not read .env files')
    const passed = await dispatch(
      hooks,
      'PreToolUse',
      toolPayload('PreToolUse', MODEL_API_TOOLS.readFile, { path: 'a.ts' }),
      adapterWith(host()),
    )
    expect(passed.blockedReason).toBeUndefined()
    const crashing = writePlugin(
      `export const Crash = async () => ({ 'tool.execute.before': async () => { process.exit(9) } })`,
    )
    const crashed = await dispatch(
      definitions('PreToolUse', 'opencode', 'tool.execute.before', crashing),
      'PreToolUse',
      toolPayload('PreToolUse', MODEL_API_TOOLS.readFile, { path: 'a.ts' }),
      adapterWith(host()),
    )
    expect(crashed.blockedReason).toContain('opencode')
  })

  it('an OpenCode in-place args rewrite narrows the call, under our argument names (P2 9)', async () => {
    const plugin = writePlugin(
      `export const Shield = async () => ({ 'tool.execute.before': async (input, output) => { if (input.tool === 'read') output.args.filePath = 'safe.txt' } })`,
    )
    const result = await dispatch(
      definitions('PreToolUse', 'opencode', 'tool.execute.before', plugin),
      'PreToolUse',
      toolPayload('PreToolUse', MODEL_API_TOOLS.readFile, { path: '.env' }),
      adapterWith(host()),
    )
    expect(result.updatedInput).toEqual({ path: 'safe.txt' })
  })

  it('every exported OpenCode plugin function runs, in load order (P2 10)', async () => {
    const plugin = writePlugin(
      [
        `export const First = async () => ({ 'tool.execute.before': async (input, output) => { output.args.command = output.args.command + ' --first' } })`,
        `export const Second = async () => ({ 'tool.execute.before': async (input, output) => { output.args.command = output.args.command + ' --second' } })`,
      ].join('\n'),
    )
    const result = await dispatch(
      definitions('PreToolUse', 'opencode', 'tool.execute.before', plugin),
      'PreToolUse',
      toolPayload('PreToolUse', 'bash', { command: 'ls' }),
      adapterWith(host()),
    )
    expect(result.updatedInput).toEqual({ command: 'ls --first --second' })
  })

  it('a plugin past its timeout is ended and fails by its rule', async () => {
    const plugin = writePlugin(
      `export const Slow = async () => ({ 'tool.execute.before': async () => { await new Promise((resolve) => setTimeout(resolve, 60000)) } })`,
    )
    const hooks = parseForeignHooks(
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              format: 'opencode',
              sourceEvent: 'tool.execute.before',
              plugin,
              hooks: [{ type: 'plugin', timeout: 1 }],
            },
          ],
        },
      }),
      'user',
      process.platform,
    ).hooks
    const started = Date.now()
    const result = await dispatch(
      hooks,
      'PreToolUse',
      toolPayload('PreToolUse', 'bash', { command: 'ls' }),
      adapterWith(host()),
    )
    expect(result.blockedReason).toContain('timed out')
    expect(Date.now() - started).toBeLessThan(15_000)
  })

  it('the session’s dispose ends a running plugin child', async () => {
    const marker = path.join(mkdtempSync(path.join(tmpdir(), 'm91b-pid-')), 'pid')
    const plugin = writePlugin(
      `import { writeFileSync } from 'node:fs'\nexport const Hang = async () => ({ 'tool.execute.before': async () => { writeFileSync(${JSON.stringify(marker)}, String(process.pid)); await new Promise((resolve) => setTimeout(resolve, 60000)) } })`,
    )
    const adapter = adapterWith(host())
    const pending = dispatch(
      definitions('PreToolUse', 'opencode', 'tool.execute.before', plugin),
      'PreToolUse',
      toolPayload('PreToolUse', 'bash', { command: 'ls' }),
      adapter,
    )
    const pid = await markedPid(marker)
    adapter.dispose?.()
    // Well before the hook's own 20-second timeout would end it.
    await expectEnded(pid)
    await pending
  })
})

/** The host side for the installed bun: its folder on the allowlisted PATH. */
function bunHost(): PluginHostDeps {
  return {
    env: { PATH: `${path.dirname(BUN ?? '')}:/usr/bin:/bin` },
    containment: () => Promise.resolve({ kind: 'processGroup' }),
    warn: () => undefined,
    now: () => 0,
  }
}

describe.runIf(IS_REAL && process.platform === 'linux' && BUN !== undefined)(
  'OpenCode under the installed bun, bounded by prlimit (P2 12)',
  () => {
    it('runs a guard under the real runtime', async () => {
      const guard = writePlugin(
        `export const EnvProtection = async () => ({ 'tool.execute.before': async (input, output) => { if (input.tool === 'read' && output.args.filePath.includes('.env')) throw new Error('Do not read .env files') } })`,
      )
      const result = await dispatch(
        definitions('PreToolUse', 'opencode', 'tool.execute.before', guard),
        'PreToolUse',
        toolPayload('PreToolUse', MODEL_API_TOOLS.readFile, { path: '.env' }),
        adapterWith(bunHost()),
      )
      expect(result.blockedReason).toBe('Do not read .env files')
    })

    it('refuses an allocation past the bound', async () => {
      const hungry = writePlugin(
        `export const Hungry = async () => ({ 'tool.execute.before': async (input, output) => { const block = Buffer.alloc(1300 * 1024 * 1024, 1); output.args.command = 'allocated ' + block.length } })`,
      )
      const result = await dispatch(
        definitions('PreToolUse', 'opencode', 'tool.execute.before', hungry),
        'PreToolUse',
        toolPayload('PreToolUse', 'bash', { command: 'ls' }),
        adapterWith(bunHost()),
      )
      expect(result.updatedInput).toBeUndefined()
      expect(result.blockedReason).toBeDefined()
    })
  },
)

describe('plugin dispatch without real children', () => {
  it('runs plugin hooks under the host-wide cap', async () => {
    let running = 0
    let peak = 0
    const adapter: ForeignHookAdapter = {
      prepare: () =>
        Promise.resolve({
          outcome: 'plugin',
          run: async () => {
            running += 1
            peak = Math.max(peak, running)
            await new Promise((resolve) => setTimeout(resolve, 30))
            running -= 1
            return { status: 'completed' }
          },
        }),
      answer: () => ({ status: 'failed' }),
    }
    const hooks = Array.from({ length: HOOK_MAX_RUNNING_COMMANDS + 3 }, (_, index) =>
      definitions('PreToolUse', 'amp', 'tool.call', `/plugins/p${String(index)}.mjs`),
    ).flat()
    await dispatch(
      hooks,
      'PreToolUse',
      toolPayload('PreToolUse', 'bash', { command: 'ls' }),
      adapter,
    )
    expect(peak).toBe(HOOK_MAX_RUNNING_COMMANDS)
  })

  it('strips a grant from a plugin answer, as from every imported hook', async () => {
    const adapter: ForeignHookAdapter = {
      prepare: () =>
        Promise.resolve({
          outcome: 'plugin',
          run: () =>
            Promise.resolve({
              status: 'completed',
              permissionDecision: 'allow',
              approvalDecision: 'allow',
            }),
        }),
      answer: () => ({ status: 'failed' }),
    }
    const result = await dispatch(
      definitions('PreToolUse', 'amp', 'tool.call', '/plugins/p.mjs'),
      'PreToolUse',
      toolPayload('PreToolUse', 'bash', { command: 'ls' }),
      adapter,
    )
    expect(result.approvalDecision).toBeUndefined()
    expect(result.forceApproval).toBe(false)
  })

  it('without containment, a plugin hook fails by its rule and says why in the user’s language', async () => {
    const plugins: PluginHostDeps = {
      env: {},
      containment: () => Promise.resolve({ kind: 'unavailable', notice: 'Translated notice' }),
      warn: () => undefined,
      now: () => 0,
    }
    const closed = await dispatch(
      definitions('PreToolUse', 'opencode', 'tool.execute.before', '/plugins/p.mjs'),
      'PreToolUse',
      toolPayload('PreToolUse', 'bash', { command: 'ls' }),
      adapterWith(plugins),
    )
    expect(closed.blockedReason).toContain('cannot be contained')
    expect(closed.messages).toEqual(['Translated notice'])
    const open = await dispatch(
      definitions('PreToolUse', 'amp', 'tool.call', '/plugins/p.mjs'),
      'PreToolUse',
      toolPayload('PreToolUse', 'bash', { command: 'ls' }),
      adapterWith(plugins),
    )
    expect(open.blockedReason).toBeUndefined()
    expect(open.messages).toEqual(['Translated notice'])
  })

  it('without the host side, a plugin hook is refused by its rule and never runs natively', async () => {
    const result = await dispatch(
      definitions('PreToolUse', 'opencode', 'tool.execute.before', '/plugins/p.mjs'),
      'PreToolUse',
      toolPayload('PreToolUse', 'bash', { command: 'ls' }),
      adapterWith(undefined),
    )
    expect(result.blockedReason).toContain('cannot run here')
  })
})
