// One `muse-spark-code-acp panel --stdio` run's surroundings, shared by the
// runtime panel suites: a folder of the suite's own holding the runtime's home,
// its data folder and the workspace, the packed agent of the shared production
// build, and the editor side of the connection (helpers/mhpHost.ts). No
// provider, key or network is touched.
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { agentDataFolder } from '../../../src/runtime/dataFolder'
import { MHP } from '../../../src/shared/constants'
import type { MhpParams } from '../../../src/shared/hostApi/methods'
import { isolatedRuntimeEnvironment } from './isolatedRuntimeEnvironment'
import { startMhpHost, type MhpHost } from './mhpHost'
import { removeFolder } from './temporaryFolders'

export interface PanelRun {
  readonly folder: string
  readonly home: string
  readonly workspace: string
  readonly dataFolder: string
  environment(): NodeJS.ProcessEnv
  /** Starts the packed agent with these arguments, in the workspace. */
  serve(args: readonly string[]): MhpHost
  /** A handshake the way an editor sends it. */
  initializeParams(overrides?: Partial<MhpParams<'initialize'>>): MhpParams<'initialize'>
  /** Makes the workspace and any further folders. */
  prepare(...folders: readonly string[]): void
  /** Ends every process still running and removes the folder. */
  dispose(): Promise<void>
}

export function createPanelRun(prefix: string, root = process.cwd()): PanelRun {
  const folder = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)))
  const home = path.join(folder, 'home')
  const workspace = path.join(folder, 'workspace')
  const started = new Set<ChildProcessWithoutNullStreams>()
  const environment = () => isolatedRuntimeEnvironment(home, folder)
  return {
    folder,
    home,
    workspace,
    dataFolder: agentDataFolder({ platform: process.platform, env: environment(), homeDir: home }),
    environment,
    serve: (args) =>
      startMhpHost(process.execPath, [path.join(root, 'dist', 'acp.js'), ...args], {
        cwd: workspace,
        env: environment(),
        started,
      }),
    initializeParams: (overrides = {}) => ({
      host: { id: 'runtime-panel-suite', version: '1.0.0' },
      protocolRange: { minimum: MHP.minimumVersion, maximumExclusive: MHP.maximumVersionExclusive },
      capabilities: ['lifecycle', 'ui'],
      locale: 'en',
      theme: { kind: 'dark', tokens: {} },
      folders: [{ uri: pathToFileURL(workspace).href, name: 'workspace' }],
      trusted: true,
      ...overrides,
    }),
    prepare: (...folders) => {
      mkdirSync(workspace, { recursive: true })
      for (const extra of folders) mkdirSync(extra, { recursive: true })
    },
    dispose: async () => {
      for (const child of started) child.kill()
      await removeFolder(folder)
    },
  }
}
