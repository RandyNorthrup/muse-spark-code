// The ACP agent's process (M96 lane W, PLAN.md D75): spawned in the
// window's process-lifetime container through lane K's launcher, with the
// scrubbed environment, presets found on the PATH, terminal sign-in, and
// Install. The SDK adapter turns a spawned agent into lane W's
// `AcpAgentConnection`.
//
// Containment itself is lane K's launcher behind `TeamChildLauncher` (M27's
// job object on Windows); this module's contract is the scrubbed
// environment with the launch marker, and never passing a credential.

import type { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import * as z from 'zod/mini'
import type { CoreLogger } from '../../core/logging'
import {
  AcpAuthRequiredError,
  AcpMethodNotFoundError,
  AcpModelSelectionError,
  type AcpAgentConnection,
  type AcpPermissionOption,
  type AcpPermissionToolCall,
  type AcpPreset,
  type AcpPresetId,
} from '../../core/team/workers/acpWorker'
import { assertWorkerRoot } from '../../core/team/workers/museCodeWorker'
import type { RealPathIo } from '../../core/workspacePath'
import { scrubWorkerEnv } from '../../core/team/workers/workerEnv'

/** The launch marker lane K's journal records; every team child carries it. */
const LAUNCH_ID_ENV = 'MUSE_SPARK_LAUNCH_ID'

/** A child process with its stdio, as lane K's launcher hands it over. */
export interface TeamChildProcess {
  readonly stdin: Writable
  readonly stdout: Readable
  readonly wait: () => Promise<{ readonly exitCode: number | null }>
  readonly kill: () => void
}

/** The process start lane K's launcher lends team children. */
export interface TeamChildLauncher {
  readonly spawn: (input: {
    readonly command: string
    readonly args: readonly string[]
    readonly cwd: string
    readonly env: NodeJS.ProcessEnv
  }) => Promise<TeamChildProcess>
}

/** Finds a preset's command on the PATH: the directory entries and a file probe, injected. */
export function findAcpPresetCommand(
  preset: AcpPreset,
  platform: NodeJS.Platform,
  pathEntries: readonly string[],
  isFile: (filePath: string) => boolean,
): string | undefined {
  const names =
    platform === 'win32'
      ? [preset.command, `${preset.command}.exe`, `${preset.command}.cmd`]
      : [preset.command]
  for (const entry of pathEntries) {
    if (entry === '') {
      continue
    }
    const separator = platform === 'win32' ? '\\' : '/'
    const base = entry.endsWith(separator) ? entry : `${entry}${separator}`
    for (const name of names) {
      const candidate = `${base}${name}`
      if (isFile(candidate)) {
        return candidate
      }
    }
  }
  return undefined
}

/** How a missing preset installs, shown in M55's modal before anything runs. */
export interface AcpPresetInstall {
  /** The exact command the modal shows: `npx` with the registry-pinned version. */
  readonly package: string
  readonly termsUrl: string
}

/**
 * The install source per preset, from the ACP registry's distributions
 * (research §4.6). `gemini`, `copilot` and our own agent have none here:
 * the user installs those CLIs themselves, or the extension bundles ours.
 */
export const ACP_PRESET_INSTALLS: Readonly<Record<AcpPresetId, AcpPresetInstall | undefined>> = {
  claude: {
    package: '@agentclientprotocol/claude-agent-acp',
    termsUrl: 'https://code.claude.com/docs/en/legal-and-compliance',
  },
  codex: {
    package: '@agentclientprotocol/codex-acp',
    termsUrl: 'https://learn.chatgpt.com/docs/auth',
  },
  gemini: undefined,
  copilot: undefined,
  own: undefined,
}

/** The exact install command for the modal: the package at the pinned version. */
export function buildPresetInstallCommand(
  install: AcpPresetInstall,
  version: string,
): { readonly command: string; readonly args: readonly string[] } {
  return { command: 'npx', args: ['-y', `${install.package}@${version}`] }
}

export interface SpawnAcpAgentInput {
  readonly preset: AcpPreset
  /** The resolved command (lane W's PATH lookup); the preset's name when already resolved. */
  readonly command: string
  readonly extraArgs?: readonly string[]
  readonly cwd: string
  readonly workspaceRoot: string
  readonly io: RealPathIo
  readonly baseEnv: NodeJS.ProcessEnv
  readonly platform: NodeJS.Platform
  /** Profile-declared names the agent may receive, and nothing else. */
  readonly passthrough?: readonly string[]
  /** Lane K's launch id, carried in the environment for recovery. */
  readonly launchId: string
  readonly launcher: TeamChildLauncher
}

/**
 * Spawns the agent through lane K's launcher with the scrubbed environment:
 * no credential variable except the profile's passthrough names, and the
 * launch marker. The per-preset switch for leaving out the user's own MCP
 * servers is appended only once step 1 has captured it.
 */
export async function spawnAcpAgent(input: SpawnAcpAgentInput): Promise<TeamChildProcess> {
  await assertWorkerRoot({ ...input, folder: input.cwd })
  const presetSwitch = input.preset.withoutUserServersSwitch
  if (
    presetSwitch === undefined ||
    presetSwitch.length === 0 ||
    (input.extraArgs?.length ?? 0) > 0
  ) {
    throw new AcpUserServersSwitchError(input.preset.id)
  }
  const env = scrubWorkerEnv({
    platform: input.platform,
    baseEnv: input.baseEnv,
    passthrough: input.passthrough,
  })
  env[LAUNCH_ID_ENV] = input.launchId
  const args = [...input.preset.defaultArgs, ...presetSwitch]
  return await input.launcher.spawn({ command: input.command, args, cwd: input.cwd, env })
}

/** Step 1 has not captured the preset's switch for leaving out the user's MCP servers. */
export class AcpUserServersSwitchError extends Error {
  public constructor(readonly preset: AcpPresetId) {
    super(`Starting ${preset} without the user's servers waits on the step 1 capture`)
    this.name = 'AcpUserServersSwitchError'
  }
}

/** A VS Code terminal that runs the agent's program interactively. */
export interface AcpTerminal {
  readonly runInteractive: (
    command: string,
    args: readonly string[],
  ) => Promise<{ readonly exitCode: number }>
}

/**
 * Terminal sign-in (research §4.1): runs the agent's program interactively
 * and reports its exit code. The caller reconnects when it exits 0, and
 * never sends `authenticate` for a terminal method.
 */
export async function runTerminalSignIn(input: {
  readonly command: string
  readonly args: readonly string[]
  readonly terminal: AcpTerminal
}): Promise<{ readonly exitCode: number }> {
  return await input.terminal.runInteractive(input.command, input.args)
}

/** The client side of one spawned agent, bound to lane W's policy handlers. */
export interface AcpClientHandlers {
  readonly onPermissionRequest: (
    toolCall: AcpPermissionToolCall,
    options: readonly AcpPermissionOption[],
  ) => Promise<{ readonly optionId: string } | undefined>
  readonly onFsRead: (
    path: string,
  ) => Promise<{ readonly content: string } | { readonly error: string }>
  readonly onFsWrite: (
    path: string,
    content: string,
  ) => Promise<{ readonly ok: true } | { readonly error: string }>
  readonly onUpdate: (text: string | undefined) => void
}

// Stable ACP v1 shapes from the pinned SDK and the recorded fake stdio
// exchange (m96-w.md). Loose objects retain future fields at the boundary.
const agentMessageChunk = z.looseObject({
  sessionUpdate: z.literal('agent_message_chunk'),
  content: z.looseObject({ type: z.literal('text'), text: z.string() }),
})
const authFields = {
  id: z.string(),
  name: z.string(),
  description: z.optional(z.nullable(z.string())),
}
const authMethod = z.union([
  z.looseObject({
    ...authFields,
    type: z.literal('terminal'),
    args: z.optional(z.array(z.string())),
    env: z.optional(z.record(z.string(), z.string())),
  }),
  z.looseObject({ ...authFields, type: z.optional(z.literal('agent')) }),
])
function sdkAuthMethod(method: z.infer<typeof authMethod>): acp.AuthMethod {
  const common = {
    ...Object.fromEntries(Object.entries(method).filter(([, value]) => value !== undefined)),
    id: method.id,
    name: method.name,
    ...(method.description !== undefined && { description: method.description }),
  }
  return method.type === 'terminal'
    ? {
        ...common,
        type: 'terminal',
        ...(method.args !== undefined && { args: method.args }),
        ...(method.env !== undefined && { env: method.env }),
      }
    : common
}

const initializeResponse = z.looseObject({
  protocolVersion: z.int().check(z.minimum(1)),
  authMethods: z.optional(z.nullable(z.array(authMethod))),
})
const sessionResponse = z.looseObject({
  sessionId: z.string().check(z.minLength(1)),
  modes: z.optional(
    z.nullable(z.looseObject({ availableModes: z.array(z.looseObject({ id: z.string() })) })),
  ),
  configOptions: z.optional(z.nullable(z.array(z.unknown()))),
})
const promptResponse = z.looseObject({ stopReason: z.string() })
const configResponse = z.looseObject({ configOptions: z.array(z.unknown()) })
const configValue = z.looseObject({ value: z.string() })
const configGroup = z.looseObject({ group: z.string(), options: z.array(configValue) })
const configSelector = z.looseObject({
  id: z.string(),
  type: z.literal('select'),
  category: z.optional(z.nullable(z.string())),
  currentValue: z.string(),
  options: z.array(z.union([configValue, configGroup])),
})

function selectorOf(
  options: readonly unknown[],
  category: string,
): z.infer<typeof configSelector> | undefined {
  for (const option of options) {
    const parsed = configSelector.safeParse(option)
    if (parsed.success && parsed.data.category === category) return parsed.data
  }
  return undefined
}
function valuesOf(selector: z.infer<typeof configSelector>): readonly string[] {
  return selector.options.flatMap((option) => {
    const value = configValue.safeParse(option)
    if (value.success) return [value.data.value]
    const group = configGroup.safeParse(option)
    return group.success ? group.data.options.map((entry) => entry.value) : []
  })
}

/** Only agent message text contributes to the worker report. */
export function updateTextOf(update: unknown): string | undefined {
  const parsed = agentMessageChunk.safeParse(update)
  return parsed.success ? parsed.data.content.text : undefined
}

/**
 * Loosens the SDK client's constructor router exactly as headless `exec`
 * does (`src/runtime/exec/execClient.ts`): lane W drives the agent through
 * `request()`, never the active-session helpers, so unknown updates reach
 * the loose boundary instead of the closed-union router.
 */
function loosenClientRouter(clientApp: ReturnType<typeof acp.client>): void {
  const builder: unknown = Reflect.get(clientApp, 'builder')
  if (typeof builder !== 'object' || builder === null) {
    throw new Error('The ACP client changed shape')
  }
  const handlers: unknown = Reflect.get(builder, 'handlers')
  if (!Array.isArray(handlers) || handlers.length !== 1) {
    throw new Error('The ACP client changed shape')
  }
  const router: unknown = handlers[0]
  if (
    typeof router !== 'object' ||
    router === null ||
    !('describe' in router) ||
    typeof router.describe !== 'function'
  ) {
    throw new Error('The ACP client changed shape')
  }
  const description: unknown = Reflect.apply(router.describe, router, [])
  if (description !== 'client-session-update-router') {
    throw new Error('The ACP client changed shape')
  }
  handlers.shift()
}

/** JSON-RPC's method-not-found code, and the server-error range lane W refuses with. */
const JSON_RPC_METHOD_NOT_FOUND = -32_601
const JSON_RPC_WORKER_REFUSAL = -32_000

/** A spawned agent's stdout as the web stream the SDK reads. */
function webReadable(nodeReadable: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeReadable.on('data', (chunk: Buffer) => {
        controller.enqueue(chunk)
      })
      nodeReadable.on('end', () => {
        controller.close()
      })
      nodeReadable.on('error', (error: Error) => {
        controller.error(error)
      })
    },
    cancel() {
      nodeReadable.destroy()
    },
  })
}

/** The web stream the SDK writes as the spawned agent's stdin. */
function webWritable(nodeWritable: Writable): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        nodeWritable.write(chunk, (error: Error | null | undefined) => {
          if (error === null || error === undefined) {
            resolve()
          } else {
            reject(error)
          }
        })
      })
    },
    close() {
      nodeWritable.end()
    },
  })
}

/** Maps the SDK's failure to lane W's errors: `auth_required` becomes the sign-in handoff. */
export function asAcpSdkError(
  error: unknown,
  method: string,
  authMethods: readonly acp.AuthMethod[],
): unknown {
  if (error instanceof acp.RequestError) {
    if (error.code === JSON_RPC_METHOD_NOT_FOUND) {
      return new AcpMethodNotFoundError(method)
    }
    const data = typeof error.data === 'object' && error.data !== null ? error.data : undefined
    if (
      (data !== undefined && 'code' in data && data.code === 'auth_required') ||
      error.message === 'auth_required' ||
      (error.code === JSON_RPC_WORKER_REFUSAL &&
        (error.message === 'Authentication required' ||
          error.message.startsWith('Authentication required: ')))
    ) {
      return new AcpAuthRequiredError(authMethods)
    }
  }
  return error
}

/**
 * Connects the SDK client to the spawned agent's stdio and adapts it to
 * lane W's connection: `initialize`, `session/new` with `cwd` and the
 * bridge's servers, the mode, the prompt, and cancel. Pending permission
 * requests answer `cancelled` on cancel, as the protocol requires.
 */
export function connectAcpAgent(input: {
  readonly stdin: Writable
  readonly stdout: Readable
  readonly handlers: AcpClientHandlers
  readonly log: CoreLogger
  /** The host can reproduce this configured invocation in an interactive terminal. */
  readonly supportsTerminalAuth: boolean
  /** Ends this owned child through the window launcher, including failed/cancelled turns. */
  readonly disposeProcess: () => void
}): AcpAgentConnection {
  const { handlers, log } = input
  const clientApp = acp.client({ name: 'muse-spark-team' })
  loosenClientRouter(clientApp)
  const settlePermission = (
    answer: { readonly optionId: string } | undefined,
  ): acp.RequestPermissionResponse => ({
    outcome:
      answer === undefined
        ? { outcome: 'cancelled' }
        : { outcome: 'selected', optionId: answer.optionId },
  })
  const pendingPermissions = new Set<(answer: { readonly optionId: string } | undefined) => void>()
  const sessionMessages = new Map<string, string[]>()
  const sessionConfigurations = new Map<string, readonly unknown[]>()
  const messagesOf = (sessionId: string): string[] => {
    const existing = sessionMessages.get(sessionId)
    if (existing !== undefined) {
      return existing
    }
    const created: string[] = []
    sessionMessages.set(sessionId, created)
    return created
  }
  // Loose boundaries, as headless `exec` keeps them: anything the wire
  // adds later arrives rather than failing the parse (PLAN.md D36).
  const permissionParams = z.looseObject({
    toolCall: z.looseObject({
      toolCallId: z.string(),
      title: z.optional(z.nullable(z.string())),
      kind: z.optional(z.nullable(z.string())),
      locations: z.optional(z.nullable(z.array(z.looseObject({ path: z.string() })))),
      rawInput: z.optional(z.unknown()),
    }),
    options: z.array(z.looseObject({ optionId: z.string(), kind: z.string() })),
  })
  const fsReadParams = z.looseObject({ path: z.string() })
  const fsWriteParams = z.looseObject({ path: z.string(), content: z.string() })
  const updateNotification = z.looseObject({ sessionId: z.string(), update: z.unknown() })
  const optionKinds = ['allow_once', 'allow_always', 'reject_once', 'reject_always'] as const
  clientApp
    .onRequest(
      'session/request_permission',
      permissionParams,
      ({ params }): Promise<acp.RequestPermissionResponse> => {
        const toolCall: AcpPermissionToolCall = {
          toolCallId: params.toolCall.toolCallId,
          title: params.toolCall.title ?? params.toolCall.toolCallId,
          kind: params.toolCall.kind ?? undefined,
          locations: params.toolCall.locations?.map((location) => ({ path: location.path })) ?? [],
          rawInput: params.toolCall.rawInput,
        }
        const options: AcpPermissionOption[] = []
        for (const option of params.options) {
          const kind = optionKinds.find((known) => known === option.kind)
          if (kind !== undefined) {
            options.push({ optionId: option.optionId, kind })
          }
        }
        return new Promise<acp.RequestPermissionResponse>((resolve) => {
          const settle = (answer: { readonly optionId: string } | undefined): void => {
            if (pendingPermissions.delete(settle)) {
              resolve(settlePermission(answer))
            }
          }
          pendingPermissions.add(settle)
          void (async () => {
            try {
              settle(await handlers.onPermissionRequest(toolCall, options))
            } catch {
              settle(undefined)
            }
          })()
        })
      },
    )
    .onRequest(
      'fs/read_text_file',
      fsReadParams,
      async ({ params }): Promise<acp.ReadTextFileResponse> => {
        const result = await handlers.onFsRead(params.path)
        if ('content' in result) {
          return { content: result.content }
        }
        throw new acp.RequestError(JSON_RPC_WORKER_REFUSAL, result.error)
      },
    )
    .onRequest(
      'fs/write_text_file',
      fsWriteParams,
      async ({ params }): Promise<acp.WriteTextFileResponse> => {
        const result = await handlers.onFsWrite(params.path, params.content)
        if ('ok' in result) {
          return {}
        }
        throw new acp.RequestError(JSON_RPC_WORKER_REFUSAL, result.error)
      },
    )
    .onNotification('session/update', updateNotification, ({ params }) => {
      const text = updateTextOf(params.update)
      if (text !== undefined) {
        messagesOf(params.sessionId).push(text)
      }
      handlers.onUpdate(text)
    })
  let authMethods: readonly acp.AuthMethod[] = []
  const stream = acp.ndJsonStream(webWritable(input.stdin), webReadable(input.stdout))
  const connection = clientApp.connect(stream)
  const agent = connection.agent
  const requesting = async <response>(
    method: string,
    work: Promise<response>,
  ): Promise<response> => {
    try {
      return await work
    } catch (error: unknown) {
      throw asAcpSdkError(error, method, authMethods)
    }
  }
  return {
    initialize: async () => {
      const response = await requesting(
        'initialize',
        agent.request('initialize', {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: false,
            auth: { terminal: input.supportsTerminalAuth },
          },
        }),
      )
      const parsed = initializeResponse.parse(response)
      authMethods = (parsed.authMethods ?? []).map((method) => sdkAuthMethod(method))
      return { protocolVersion: parsed.protocolVersion, authMethods }
    },
    sessionNew: async (params) => {
      const response = await requesting(
        'session/new',
        agent.request('session/new', {
          cwd: params.cwd,
          mcpServers: [...params.mcpServers],
        }),
      )
      const parsed = sessionResponse.parse(response)
      sessionConfigurations.set(parsed.sessionId, parsed.configOptions ?? [])
      const modeSelector = selectorOf(parsed.configOptions ?? [], 'mode')
      return {
        sessionId: parsed.sessionId,
        advertisedModes:
          parsed.modes?.availableModes.map((mode) => mode.id) ??
          (modeSelector === undefined ? [] : valuesOf(modeSelector)),
      }
    },
    setConfigOption: async (sessionId, value) => {
      const selector = selectorOf(sessionConfigurations.get(sessionId) ?? [], 'mode')
      if (selector === undefined) throw new AcpMethodNotFoundError('session/set_config_option')
      const response = configResponse.parse(
        await requesting(
          'session/set_config_option',
          agent.request('session/set_config_option', { sessionId, configId: selector.id, value }),
        ),
      )
      sessionConfigurations.set(sessionId, response.configOptions)
      if (selectorOf(response.configOptions, 'mode')?.currentValue !== value)
        throw new Error('The ACP agent did not confirm its mode')
    },
    setMode: async (sessionId, mode) => {
      z.looseObject({}).parse(
        await requesting(
          'session/set_mode',
          agent.request('session/set_mode', { sessionId, modeId: mode }),
        ),
      )
    },
    setModel: async (sessionId, modelId) => {
      const selector = selectorOf(sessionConfigurations.get(sessionId) ?? [], 'model')
      if (selector === undefined || !valuesOf(selector).includes(modelId) || modelId.trim() === '')
        throw new AcpModelSelectionError()
      if (selector.currentValue === modelId) return modelId
      const response = configResponse.parse(
        await requesting(
          'session/set_config_option',
          agent.request('session/set_config_option', {
            sessionId,
            configId: selector.id,
            value: modelId,
          }),
        ),
      )
      sessionConfigurations.set(sessionId, response.configOptions)
      const selected = selectorOf(response.configOptions, 'model')
      if (selected?.id !== selector.id || selected.currentValue !== modelId)
        throw new AcpModelSelectionError()
      return selected.currentValue
    },
    prompt: async (sessionId, text) => {
      messagesOf(sessionId).length = 0
      const response = await requesting(
        'session/prompt',
        agent.request('session/prompt', {
          sessionId,
          prompt: [{ type: 'text', text }],
        }),
      )
      const messages = messagesOf(sessionId).join('')
      return {
        stopReason: promptResponse.parse(response).stopReason,
        lastMessage: messages === '' ? undefined : messages,
      }
    },
    cancel: async (sessionId) => {
      for (const answer of pendingPermissions) {
        answer(undefined)
      }
      pendingPermissions.clear()
      try {
        await agent.notify('session/cancel', { sessionId })
      } catch {
        // ACP cancel is a notification: the agent may already be gone.
        log.warn('An ACP worker cancel settled elsewhere')
      }
    },
    close: () => {
      for (const settle of pendingPermissions) settle(undefined)
      pendingPermissions.clear()
      sessionConfigurations.clear()
      sessionMessages.clear()
      try {
        connection.close()
      } finally {
        input.disposeProcess()
      }
    },
  }
}
