// Real VS Code host bindings, real Git/file tools and the captured fake HTTP boundary.
import * as assert from 'node:assert/strict'
import * as vscode from 'vscode'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createTeamPanelHost } from '../../src/host/models/modelsPanelEntry'
import { TeamHostBinding } from '../../src/host/teamHostBinding'
import { createTeamHost } from '../../src/host/team/teamHostEntry'
import { type TeamHostBundleDeps } from '../../src/host/team/teamEnginePorts'
import { processTeamGit } from '../../src/core/team/workers/workerOps'
import { ModelApiBackendManager } from '../../src/host/backend/modelApiBackendManager'
import { createToolIo } from '../../src/host/backend/toolIo'
import { fakeManagerDeps } from '../unit/helpers/modelApiManager'
import { fakeModelApi } from '../unit/helpers/fakeModelApi'
import { buildTeamModelOffers } from '../../src/core/team/teamModelRegistry'
import { metaCapabilityRecord } from '../../src/core/providers/capabilityRecord'
import { TEAM_WORKSPACE_KEYS } from '../../src/shared/teamConversation'
import { Usd } from '../../src/shared/usd'
import type { UsdAmount } from '../../src/shared/usd'
import {
  MODEL_API_PRICES_PER_MILLION,
  OPTIONAL_RUNTIME_AVAILABILITY,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import type { TeamTreeData } from '../../src/shared/teamView'
import { workerEnvironment } from '../../src/core/team/workers/workerEnv'
import { EXTENSION_QUALIFIED_ID } from '../../src/shared/constants'

suite('saved team composition in VS Code', () => {
  test('creates a saved team through host bindings and completes plan, worker, review, merge and cost tally', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_QUALIFIED_ID)
    assert.ok(extension)
    const root = await mkdtemp(path.join(tmpdir(), 'cm963jr2-composition-'))
    const repo = path.join(root, 'repo')
    const storage = path.join(root, 'storage')
    await mkdir(repo)
    await mkdir(storage)
    const git = processTeamGit(process.platform)
    const env = workerEnvironment(process.env, process.platform)
    env['GIT_CONFIG_NOSYSTEM'] = '1'
    env['GIT_CONFIG_GLOBAL'] = process.platform === 'win32' ? 'NUL' : '/dev/null'
    const channel = vscode.window.createOutputChannel('M96 composition', { log: true })
    const values = new Map<string, unknown>()
    const state = {
      get: (key: string) => values.get(key),
      update: (key: string, value: unknown) => {
        values.set(key, value)
        return Promise.resolve()
      },
    }
    let tree: TeamTreeData | undefined
    let consentCount = 0
    const managers: ModelApiBackendManager[] = []
    let binding: TeamHostBinding | undefined
    // The feature's own suites run with the release latch open
    // (teamAvailability certifies the closed latch); the latch ships closed.
    OPTIONAL_RUNTIME_AVAILABILITY.team = true
    try {
      await git(['init', '--initial-branch=main'], repo, undefined, env)
      await writeFile(path.join(repo, 'tracked.txt'), 'before\n')
      await git(['add', 'tracked.txt'], repo, undefined, env)
      await git(
        [
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          'commit',
          '-m',
          'seed',
        ],
        repo,
        undefined,
        env,
      )
      const api = fakeModelApi()
      api.script(
        {
          calls: [
            {
              name: 'edit_file',
              arguments: '{"path":"tracked.txt","find":"before","replace":"after"}',
            },
          ],
          usage: { input: 12, output: 3 },
        },
        {
          text: '```muse-team-report\n{"status":"done","summary":"Edited the tracked file."}\n```',
          usage: { input: 14, output: 4 },
        },
        {
          text: '```muse-team-report\n{"status":"done","summary":"Reviewed the exact branch head.","findings":[]}\n```',
          usage: { input: 16, output: 5 },
        },
      )
      const io = createToolIo({
        platform: process.platform,
        listFiles: () => Promise.resolve(['tracked.txt']),
        systemRoot: process.env['SystemRoot'],
        env: () => env,
        searchWorkerPath: path.join(extension.extensionPath, 'dist', 'searchWorker.js'),
        log: (message) => {
          channel.warn(message)
        },
        unsavedFiles: () => [],
      })
      const models = api.models
        .filter((id) => id.startsWith('muse-spark'))
        .map((modelId) => ({
          modelId,
          displayLabel: modelId,
          isDefault: modelId === 'muse-spark-1.2',
          isActive: false,
          contextLimit: undefined,
        }))
      const offers = buildTeamModelOffers({
        engine: models.map((model) => ({
          model,
          record: metaCapabilityRecord(model.modelId),
          preset: 'meta',
        })),
        museCode: [],
        limits: [],
        maxWorkers: 2,
        canRunKind: (kind) => kind === 'engine',
      }).offers
      const ports: TeamHostBundleDeps = {
        state,
        settings: {
          isTeamOn: () => true,
          isTeamWorkersOn: () => true,
          maxWorkers: () => 2,
          isTrusted: () => vscode.workspace.isTrusted,
        },
        orchestrator: {
          modelId: () => 'muse-spark-1.2',
          backend: () => 'modelApi',
          approvalMode: () => 'allowAll',
        },
        paid: {
          allowKeyTasks: () => {
            consentCount += 1
            return Promise.resolve(true)
          },
        },
        cards: {
          show: (_session, card) => {
            if (!(card.kind === 'teamMerge' && card.status === 'inProgress')) {
              return
            }

            assert.equal(card.teamMerge.review, 'reviewed')
            void binding?.handle({
              type: 'decideTeamMerge',
              taskId: card.teamMerge.taskId,
              decision: 'merge',
            })
          },
        },
        newId: randomUUID,
        now: Date.now,
        log: channel,
        engine: {
          repositoryRoot: () => repo,
          storageRoot: storage,
          platform: process.platform,
          isTrusted: () => vscode.workspace.isTrusted,
          listModels: () => Promise.resolve(models.map((model) => model.modelId)),
          now: Date.now,
          log: channel,
          startWorker: async ({ folder, modelId, approvalMode, admit, noteUsage, fenceIo }) => {
            assert.ok(consentCount > 0, 'consent precedes the first paid worker dispatch')
            const manager = new ModelApiBackendManager(
              fakeManagerDeps(api, channel, {
                workspaceRoot: folder,
                bundlePath: path.join(extension.extensionPath, 'dist', 'modelApi.js'),
                io,
                contextIo: {
                  readFile: () => Promise.resolve(undefined),
                  listDirectory: () => Promise.resolve([]),
                  realPath: (file) => Promise.resolve(file),
                },
                newId: randomUUID,
                now: Date.now,
                confirmContributorModel: () => Promise.resolve(true),
              }),
            )
            managers.push(manager)
            const host = await manager.buildTeamWorkerHost(
              folder,
              admit,
              noteUsage,
              undefined,
              fenceIo,
            )
            const session = await host.startSession({
              workspaceRoot: folder,
              modelId,
              approvalMode,
            })
            return {
              session,
              toolNames: host.sessionToolNames(session.sessionId) ?? [],
              close: () => host.close(),
            }
          },
        },
      }
      binding = new TeamHostBinding({
        ports,
        canRunKind: (kind) => kind === 'engine',
        loadFactory: () => Promise.resolve(createTeamHost),
        uiText: () => EN,
        uiLocale: () => 'en',
        showTree: (value) => {
          tree = value
        },
        openRoles: () => Promise.resolve(),
        showDiff: () => Promise.resolve(),
      })
      const panelHost = createTeamPanelHost({
        l10n: { table: EN, locale: 'en' },
        team: {
          state,
          isEnabled: () => binding?.canConfigure() ?? false,
          reload: () => binding?.reload(),
          tree: () => binding?.tree(),
          onTreeChange: (listener) => binding?.onTreeChange(listener) ?? (() => undefined),
          handle: (message) => binding?.handle(message) ?? Promise.resolve(),
          snapshots: { remainingDailyBudgetUsd: () => Usd.from(10).toAmount(), records: () => [] },
          configuration: {
            offers: () => Promise.resolve(offers),
            defaultRef: () => 'engine:muse-spark-1.2',
            maxWorkers: () => 2,
            confirmOrchestrator: () => Promise.resolve(),
          },
        },
      })
      const panel = await panelHost?.load()
      assert.ok(panel, 'first-time setup loads before any team is stored')
      await panel.read()
      for (const [role, modelRef] of [
        ['engineering', 'engine:muse-spark-1.3'],
        ['code-review', 'engine:muse-spark-1.3-contributor'],
      ] as const) {
        await panel.handle({ type: 'roles/addRole', role })
        await panel.handle({ type: 'roles/addEntry', role, modelRef })
        const draft = await panel.read()
        const defaultEntry = draft?.document.roles
          .find((item) => item.role === role)
          ?.pool.find((item) => item.agent === undefined)
        assert.ok(defaultEntry)
        await panel.handle({ type: 'roles/removeEntry', role, entryId: defaultEntry.id })
      }
      // The tracked-file worker must edit: only bypassPermissions allows
      // everything, and the untouched selector reads as Plan.
      await panel.handle({
        type: 'roles/updateRole',
        role: 'engineering',
        fields: { permissionMode: 'bypassPermissions' },
      })
      await panel.handle({ type: 'roles/save' })
      assert.ok(
        values.has(TEAM_WORKSPACE_KEYS.team),
        'the production panel saved canonical workspace state',
      )
      await binding.open()
      const context = {
        sessionId: 'composition',
        orchestratorModelId: 'muse-spark-1.2',
        approvalMode: 'allowAll',
        signal: new AbortController().signal,
      }
      const args = {
        tasks: [
          {
            role: 'engineering',
            brief: 'Replace before with after in tracked.txt.',
            reason: { code: 'specialty', detail: 'Implement the requested change.' },
            files: ['tracked.txt'],
          },
        ],
      }
      const plan = await binding.seams.teamRunner.preview({ ...args, dry_run: true }, context)
      assert.ok(!plan.output.startsWith('Error:'), plan.output)
      const delegated = await binding.seams.teamRunner.delegate(args, context)
      assert.ok(!delegated.output.startsWith('Error:'), delegated.output)
      while (
        tree?.roles.some(
          (role) => role.queued.length > 0 || role.entries.some((entry) => entry.running > 0),
        )
      ) {
        await binding.seams.teamRunner.collect({ wait_seconds: 10 }, context)
      }
      const result = await binding.seams.teamRunner.collect({ wait_seconds: 10 }, context)
      assert.ok(!result.output.startsWith('Error:'), result.output)
      const worker = tree?.roles.find((role) => role.id === 'engineering')?.unmerged[0]
      assert.ok(
        worker,
        `the real worker retained its branch for integration: ${result.output} ${JSON.stringify(tree)}`,
      )
      const reviewing = await binding.seams.teamRunner.merge({ task_id: worker.taskId }, context)
      assert.ok(reviewing.output.startsWith('Error:'), reviewing.output)
      assert.ok(
        reviewing.output.includes('a reviewer started checking this branch'),
        reviewing.output,
      )
      while (
        tree?.roles.some(
          (role) => role.queued.length > 0 || role.entries.some((entry) => entry.running > 0),
        )
      ) {
        await binding.seams.teamRunner.collect({ wait_seconds: 10 }, context)
      }
      const merged = await binding.seams.teamRunner.merge({ task_id: worker.taskId }, context)
      assert.ok(!merged.output.startsWith('Error:'), merged.output)
      assert.equal(await readFile(path.join(repo, 'tracked.txt'), 'utf8'), 'after\n')
      assert.equal(api.requests.filter((request) => request.path.endsWith('/responses')).length, 3)
      assert.equal(consentCount, 2, 'one worker consent and one review consent')
      // The tally reports the settled engine costs exactly: two worker turns
      // at the standard tariff and the review at the contributor tariff.
      const rates = MODEL_API_PRICES_PER_MILLION
      const microUsd = (tokens: number, rate: UsdAmount): Usd =>
        Usd.from(rate).times(tokens).divide(1_000_000)
      const expectedTally = microUsd(12, rates.standard.input)
        .add(microUsd(3, rates.standard.output))
        .add(microUsd(14, rates.standard.input))
        .add(microUsd(4, rates.standard.output))
        .add(microUsd(16, rates.contributor.input))
        .add(microUsd(5, rates.contributor.output))
        .toAmount()
      assert.ok(tree, 'the settled engine costs reach the team tally')
      assert.equal(tree.spentUsdToday, expectedTally)
      assert.equal(tree.budgetUsdToday, expectedTally)
      const stored = values.get('museSpark.team.tasks')
      assert.ok(stored, 'task claims and their settlement are persisted')
      panel.dispose()
    } finally {
      OPTIONAL_RUNTIME_AVAILABILITY.team = false
      await binding?.dispose()
      for (const manager of managers) await manager.dispose()
      channel.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
