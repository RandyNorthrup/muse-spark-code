import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { afterAll, describe, expect, it } from 'vitest'
import { sharedValidation, sharedUiText } from '../../scripts/lib/deferredBundles.mjs'
import { HOST_PLUGINS } from '../../scripts/lib/hostPlugins.mjs'
import { deferredTeamView } from '../../scripts/lib/deferredTeamView.mjs'
import { removeFolder } from './helpers/temporaryFolders'
import { EN } from '../../src/shared/l10n/en'

const require = createRequire(import.meta.url)
const folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'm96-startup-')))
afterAll(async () => {
  expect(path.dirname(path.resolve(folder))).toBe(realpathSync(tmpdir()))
  await removeFolder(folder)
})
const nodeBuild = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20.18',
  minify: true,
  logLevel: 'silent',
}

describe('M96 production startup boundary', () => {
  it('excludes the named view/pricing implementations and all team runtime modules', async () => {
    const result = await build({
      ...nodeBuild,
      entryPoints: ['src/extension.ts', 'src/host/backend/modelApiEntry.ts', 'src/runtime/main.ts'],
      outdir: folder,
      write: false,
      metafile: true,
      external: ['vscode', '@napi-rs/keyring', './sessionBoardEntry.js', './reviewerEntry.js'],
      // The plugins dist/extension.js ships with (scripts/lib/hostPlugins.mjs).
      plugins: [...HOST_PLUGINS],
      define: { 'process.env.NODE_ENV': '"production"' },
    })
    const inputs = Object.keys(result.metafile.inputs)
    expect(inputs).not.toContain('src/shared/teamView.ts')
    expect(inputs).not.toContain('src/core/team/teamPaid.ts')
    expect(inputs.filter((file) => /^src\/(core|host)\/(?:team|runners)\//.test(file))).toEqual([])
    expect(inputs).not.toContain('src/shared/team.ts')
    const activation = result.outputFiles.find(
      (file) => path.basename(file.path) === 'extension.js',
    )
    // Independently reproduced pre-M96 main: 604,810 B; acceptance 31 adds at most 4 KiB.
    expect(activation.contents.byteLength).toBeLessThanOrEqual(604_810 + 4096)
  })

  it('discards the unused canonical role table while retaining paid feature identities', async () => {
    const result = await build({
      ...nodeBuild,
      stdin: {
        contents: 'export { PAID_FEATURES } from "./src/shared/constants"',
        resolveDir: process.cwd(),
      },
      write: false,
      plugins: [sharedUiText],
    })
    expect(result.outputFiles[0].text).toContain('teamWorkers')
    expect(result.outputFiles[0].text).not.toContain('code-review')
    expect(result.outputFiles[0].text).not.toContain('workspaceSymbols')
  })

  it('keeps ordinary parsing independent of team.js and validates every deferred payload', async () => {
    await build({
      ...nodeBuild,
      entryPoints: ['src/shared/validationEntry.ts'],
      outfile: path.join(folder, 'validation.js'),
    })
    await build({
      ...nodeBuild,
      stdin: {
        contents:
          'export * from "./src/shared/protocol"; export { itemSnapshotSchema } from "./src/shared/agentEvents"',
        resolveDir: process.cwd(),
      },
      outfile: path.join(folder, 'protocol.js'),
      plugins: [deferredTeamView, sharedValidation],
    })
    const protocol = require(path.join(folder, 'protocol.js'))
    const item = { itemId: 'ordinary', kind: 'agentMessage', status: 'completed', text: 'hello' }
    expect(protocol.parseHostToWebviewMessage({ type: 'focusInput' }).ok).toBe(true)
    expect(protocol.parseWebviewToHostMessage({ type: 'ready' }).ok).toBe(true)
    expect(protocol.itemSnapshotSchema.parse(item)).toEqual(item)
    expect(require.cache[path.join(folder, 'team.js')]).toBeUndefined()

    await build({
      ...nodeBuild,
      entryPoints: ['src/core/team/teamEntry.ts'],
      outfile: path.join(folder, 'team.js'),
    })
    const fields = {
      teamPlan: { items: [{ disposition: 'kept', role: 'docs', reason: 'small' }], dryRun: false },
      teamSwitch: { roleId: 'docs', fromEntry: 'first', toEntry: 'second', reason: 'capped' },
      teamWaiting: { waitingId: 'waiting', roleId: 'docs' },
      teamMerge: {
        taskId: 'task',
        roleId: 'docs',
        brief: 'docs',
        branch: 'task',
        review: 'reviewed',
      },
      teamReport: { taskId: 'task', roleId: 'docs', summary: 'done' },
      teamWorker: { roleId: 'docs', agentLabel: 'second', taskId: 'task' },
    }
    for (const [key, value] of Object.entries(fields)) {
      const row = { ...item, [key]: value }
      expect(protocol.itemSnapshotSchema.parse(row)).toEqual(row)
      expect(protocol.itemSnapshotSchema.safeParse({ ...item, [key]: {} }).success).toBe(false)
      expect(
        protocol.itemSnapshotSchema.parse({ ...item, [key]: { ...value, unapproved: true } }),
      ).toEqual(row)
    }
    const tree = {
      orchestrator: { model: 'second', backend: 'modelApi', slot: 'override' },
      roles: [],
    }
    expect(protocol.parseHostToWebviewMessage({ type: 'teamTree', tree }).ok).toBe(true)
    expect(protocol.parseHostToWebviewMessage({ type: 'teamTree' }).ok).toBe(false)
    expect(
      protocol.parseHostToWebviewMessage({ type: 'teamTree', tree: { ...tree, roles: 'wrong' } })
        .ok,
    ).toBe(false)
    const figures = { tasks: 1, inputTokens: 1, outputTokens: 1, costUsd: 0, estimated: false }
    const team = { today: figures, window: figures, byRole: [], byEntry: [] }
    expect(
      protocol.parseHostToWebviewMessage({ type: 'usageReport', backend: 'modelApi', team }).ok,
    ).toBe(true)
    expect(
      protocol.parseHostToWebviewMessage({
        type: 'usageReport',
        backend: 'modelApi',
        team: { ...team, today: {} },
      }).ok,
    ).toBe(false)
    expect(require.cache[path.join(folder, 'team.js')]).toBeDefined()
    const runtime = require(path.join(folder, 'team.js')).createTeamRuntime(
      { ...EN, paidTeamWorkersTitle: 'Compiled translated team title' },
      'de',
    )
    const question = runtime.teamWorkerQuestion({
      feature: 'teamWorkers',
      tasks: [],
      dailyBudgetUsd: 1,
    })
    expect(question.title).toBe('Compiled translated team title')
    expect(question.detail).toContain('1,00')
  })

  it.each([{}, { createTeamViewSchemas: 'wrong' }])(
    'refuses a malformed deferred factory %j',
    async (exports) => {
      const file = path.join(folder, `malformed-${Object.keys(exports).length}.js`)
      await build({
        ...nodeBuild,
        entryPoints: ['src/shared/protocol.ts'],
        outfile: file,
        plugins: [deferredTeamView, sharedValidation],
      })
      const teamFile = path.join(folder, 'team.js')
      Reflect.deleteProperty(require.cache, require.resolve(teamFile))
      writeFileSync(teamFile, `module.exports = ${JSON.stringify(exports)}`)
      const protocol = require(file)
      expect(protocol.parseHostToWebviewMessage({ type: 'focusInput' }).ok).toBe(true)
      expect(() => protocol.parseHostToWebviewMessage({ type: 'teamTree', tree: {} })).toThrow(
        /factory is unavailable/,
      )
    },
  )
})
