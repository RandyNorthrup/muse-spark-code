// `serve --team` in the real ACP agent process (M96b, RLF-ACPTEAM):
// the freshly bundled agent over real stdio, an isolated HOME with the
// editor-chat rig's real local providers file for its models (no key, no
// network: a session starts locally and no turn is sent). A new session
// is admitted on the stored team in the agent data folder: without a
// second usable model it refuses in the two-model sentence; with one it
// opens as a team session and says so in its config options.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { agentDataFolder } from '../../src/runtime/dataFolder'
import { webReadable } from '../../src/runtime/webStreams'
import { storedTeamSnapshotFile } from '../../src/runtime/teamSnapshotFile'
import { PROVIDERS_CONFIG_DIR_NAME, UI_TEXT } from '../../src/shared/constants'
import { writeEditorChatProvidersFile } from './helpers/editorChatRig'
import { removeFolder } from './helpers/temporaryFolders'
import { stageAgentBundle } from './helpers/stageAgentBundle'

const directory = mkdtempSync(path.join(tmpdir(), 'acp-team-serve-'))
const agent = path.join(directory, 'dist', 'acp.js')
const config = path.join(directory, 'config')
const data = path.join(directory, 'data')
const workspace = path.join(directory, 'workspace')

beforeAll(async () => {
  await stageAgentBundle(directory)
  // The Model API route loads its account services from the sibling
  // bundle beside the agent, as the packed layout ships it.
  const { build } = await import('esbuild')
  for (const [entry, outfile] of [
    [path.resolve('src', 'runtime', 'providers', 'accountsEntry.ts'), 'runtimeAccounts.js'],
    [path.resolve('src', 'host', 'backend', 'modelApiEntry.ts'), 'modelApi.js'],
    [
      path.resolve('src', 'runtime', 'questions', 'questionRegistryEntry.ts'),
      'runtimeQuestions.js',
    ],
  ] as const) {
    await build({
      entryPoints: [entry],
      outfile: path.join(directory, 'dist', outfile),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: ['@napi-rs/keyring'],
      logLevel: 'silent',
    })
  }
  // The configured services read their catalog beside the agent bundle.
  await writeFile(
    path.join(directory, 'dist', 'providerCatalog.json'),
    JSON.stringify({ providers: {} }),
  )
  mkdirSync(workspace, { recursive: true })
  mkdirSync(path.join(config, PROVIDERS_CONFIG_DIR_NAME), { recursive: true })
  const { configFile } = writeEditorChatProvidersFile(path.join(config, PROVIDERS_CONFIG_DIR_NAME))
  // A strict Model API start needs the file's default model, as a
  // person's providers file names one.
  const providers = JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>
  providers['defaultModel'] = 'probe-custom/custom-model'
  writeFileSync(configFile, JSON.stringify(providers))
})

afterAll(async () => {
  await removeFolder(directory)
})

function launch(): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [agent, '--team', '--backend', 'modelApi'], {
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: directory,
      XDG_CONFIG_HOME: config,
      XDG_DATA_HOME: data,
      NODE_PATH: path.resolve('node_modules'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

/** One served run: initialize, then the caller's exchanges; the process is stopped after. */
async function served(
  run: (
    ctx: Parameters<Parameters<ReturnType<typeof acp.client>['connectWith']>[1]>[0],
  ) => Promise<void>,
): Promise<void> {
  const child = launch()
  const failures: unknown[] = []
  child.on('error', (error) => {
    failures.push(error)
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })
  const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), webReadable(child.stdout))
  try {
    await acp.client({ name: 'acp-team-serve' }).connectWith(stream, async (ctx) => {
      await ctx.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      await run(ctx)
    })
  } catch (error: unknown) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nagent stderr:\n${stderr}`,
      {
        cause: error,
      },
    )
  } finally {
    child.kill()
    await new Promise<void>((resolve) => {
      child.on('exit', () => {
        resolve()
      })
    })
  }
  expect(failures).toEqual([])
}

/** The refusal text a new session answered with, or undefined when it opened. */
async function newSessionRefusal(
  ctx: Parameters<Parameters<ReturnType<typeof acp.client>['connectWith']>[1]>[0],
): Promise<string | undefined> {
  try {
    await ctx.request('session/new', { cwd: workspace, mcpServers: [] })
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
  return undefined
}

describe('serve --team over real stdio', () => {
  it('refuses a new session when no team is stored', async () => {
    await served(async (ctx) => {
      expect(await newSessionRefusal(ctx)).toContain(UI_TEXT.teamNeedsSecondModel)
    })
  })

  it('opens a team session for the stored team and shows its state', async () => {
    const dataFolder = agentDataFolder({
      platform: process.platform,
      env: { XDG_DATA_HOME: data },
      homeDir: directory,
    })
    const file = storedTeamSnapshotFile(dataFolder, workspace)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(
      file,
      JSON.stringify({
        roles: [
          {
            role: 'engineering',
            workspace: 'own-branch',
            pool: [
              {
                id: 'e1',
                concurrent: 1,
                caps: [],
                agent: {
                  kind: 'engine',
                  agentId: 'probe-offable:offable-model',
                  model: 'probe-offable/offable-model',
                  pays: 'local',
                },
              },
            ],
          },
        ],
        intensity: 'balanced',
      }),
    )
    await served(async (ctx) => {
      const created = await ctx.request('session/new', { cwd: workspace, mcpServers: [] })
      expect(created.configOptions?.find((row) => row.id === 'team')).toMatchObject({
        currentValue: 'on',
      })
      await ctx.request('session/close', { sessionId: created.sessionId })
    })
  })
})
