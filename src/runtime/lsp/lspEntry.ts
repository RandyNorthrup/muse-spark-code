import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import type { Readable, Writable } from 'node:stream'
import type { PaidUseConsent } from '../../core/paid/paidConsent'
import type { PaidFeature } from '../../shared/constants'
import { MODEL_API_BASE_URL, SECRET_KEYS, UI_TEXT, RUNTIME_STOP } from '../../shared/constants'
import { setUiText, fill } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'
import type { UiText } from '../../shared/l10n/en'
import type { SecretStore } from '../../host/auth/credentialStore'
import type { Logger } from '../../host/logger'
import type { LspOptions } from '../cliArgs'
import { paidGrantFile } from '../paidGrants'
import { runtimeTab } from '../tabServe'
import { connectWorkspaceBroker, startWorkspaceBroker } from './broker'
import { stopWorkspace } from './supervisor'
import type { LspTransport } from './transport'

export interface LspRuntimeDeps {
  readonly stdin: Readable
  readonly stdout: Writable
  readonly executable: string
  readonly entry: string
  readonly packageRoot?: string
  readonly watchdogFile?: string
  readonly registry: string
  readonly dataFolder: string
  readonly grantsFile: string
  readonly secrets: SecretStore
  readonly env: NodeJS.ProcessEnv
  readonly log: Logger
  readonly table: UiText
  readonly locale: string
  readonly runGit: (args: readonly string[], cwd: string) => Promise<string>
}
const answerSchema = z.nullable(z.object({ title: z.string() }))

/** No native store access until an opted-in, consented Tab request sends. */
export async function runLsp(options: LspOptions, deps: LspRuntimeDeps): Promise<number> {
  setUiText(deps.table, deps.locale)
  const workspace = await realpath(options.workspace)
  const configuration = JSON.stringify({ ...options, workspace, brokerWorker: false })
  if (!options.brokerWorker) {
    const status = { didFail: false }
    const workerArgs = [
      'lsp',
      '--workspace',
      workspace,
      '--backend',
      options.backend,
      '--tab-model',
      options.tabModel,
      '--tab-daily-budget-usd',
      options.tabBudgetUsd,
      '--shell-sandbox',
      options.shellSandbox,
      '--broker-worker',
    ]
    if (options.tabOn) workerArgs.push('--tab')
    if (options.trustWorkspace) workerArgs.push('--trust-workspace')
    if (options.allowsContributorModels) workerArgs.push('--allow-contributor-models')
    if (options.isVerbose) workerArgs.push('--verbose')
    if (options.museBinary !== '') workerArgs.push('--muse-binary', options.museBinary)
    const socket = await connectWorkspaceBroker({
      registry: deps.registry,
      workspace,
      configuration,
      launch: async () => {
        const packageRoot = deps.packageRoot ?? path.resolve(deps.entry, '../..')
        const { processAuthority } = await import('./processAuthority')
        const authority = await processAuthority(packageRoot, deps.registry)
        const launched = await authority.launch(
          deps.executable,
          [deps.entry, 'supervise', ...workerArgs],
          workspace,
          deps.env,
          deps.watchdogFile ?? path.join(packageRoot, 'dist', 'runtimeWatchdog.js'),
          true,
        )
        const { child, ticket } = launched
        child.on('error', () => {
          status.didFail = true
        })
        child.once('close', () => {
          authority.registry.unregister(ticket)
        })
        launched.admit()
        child.stdin.end()
        child.stdout.destroy()
        child.stderr.destroy()
        child.unref()
      },
    })
    const ending = new AbortController()
    const closed = new Promise<void>((resolve) => {
      ending.signal.addEventListener(
        'abort',
        () => {
          resolve()
        },
        { once: true },
      )
    })
    socket.once('error', () => {
      status.didFail = true
    })
    socket.once('close', () => {
      ending.abort()
    })
    deps.stdin.once('end', () => {
      socket.end()
    })
    deps.stdin.once('error', () => {
      socket.destroy()
    })
    socket.pipe(deps.stdout, { end: false })
    deps.stdin.pipe(socket)
    await closed
    deps.stdin.unpipe(socket)
    deps.stdin.destroy()
    return status.didFail ? 1 : 0
  }
  const paid = await import('../runtimeEngineEntry')
  paid.setUiText(deps.table, deps.locale)
  const { PaidFeatureGate, PaidUsage, PaidUseConsent, paidUseQuestion } = paid
  let isEnabled = options.tabOn
  let accepted: ReadonlySet<PaidFeature> = new Set()
  const gate = new PaidFeatureGate({
    isSettingOn: (feature) => feature === 'tab' && isEnabled,
    setSetting: (_feature, on) => {
      isEnabled = on
      return Promise.resolve()
    },
    readAccepted: () => accepted,
    writeAccepted: (value) => {
      accepted = value
      return Promise.resolve()
    },
    confirm: () => Promise.resolve(false),
    isWindowFocused: () => true,
    asksOnFirstUse: new Set(['tab']),
    log: deps.log,
  })
  await gate.review()
  const grants = paidGrantFile({
    file: deps.grantsFile,
    log: deps.log,
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms)
      }),
  })
  if (!options.tabOn) {
    try {
      await grants.forget(['tab'])
    } catch {
      deps.log.warn('ELSP_GRANTS')
    }
  }
  const usage = new PaidUsage(deps.log)
  const snoozed = new WeakSet<LspTransport>()
  const consents = new WeakMap<LspTransport, PaidUseConsent>()
  const { createModelApiClient } = await import('../../host/backend/modelApiEntry')
  const client = createModelApiClient(
    {
      apiKey: async () => await deps.secrets.get(SECRET_KEYS.modelApiKey),
      baseUrl: MODEL_API_BASE_URL,
      fetch: globalThis.fetch.bind(globalThis),
      now: Date.now,
      random: Math.random,
      sleep: (ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms)
        }),
      log: deps.log,
    },
    deps.table,
    deps.locale,
  )
  const tab = runtimeTab({
    workspace,
    ledgerDirectory: path.join(deps.dataFolder, 'tab-spend'),
    instance: randomUUID(),
    log: deps.log,
    model: options.tabModel,
    budgetUsd: options.tabBudgetUsd,
    trusted: options.trustWorkspace,
    gate,
    usage,
    stream: (body, signal, budget) => client.streamResponse(body, signal, undefined, budget),
    runGit: deps.runGit,
    consent: async (transport) => {
      if (snoozed.has(transport)) return false
      let consent = consents.get(transport)
      if (consent === undefined) {
        consent = new PaidUseConsent({
          isOn: (feature) => gate.isOn(feature),
          canRemember: () => options.trustWorkspace,
          readGrants: () => grants.read(workspace),
          writeGrants: async (value) => {
            await grants.add(workspace, [...value])
          },
          windowOnceFeatures: new Set(['tab']),
          log: deps.log,
          ask: async (request, remember) => {
            const question = await paidUseQuestion(request)
            const answer = answerSchema.parse(
              await transport.request('window/showMessageRequest', {
                type: 2,
                message: `${question.title}\n\n${question.detail}`,
                actions: [
                  { title: UI_TEXT.allowOnce },
                  ...(remember ? [{ title: UI_TEXT.paidAllowAlways }] : []),
                  { title: UI_TEXT.paidDeny },
                ],
              }),
            )
            if (answer?.title === UI_TEXT.allowOnce) return 'once'
            if (remember && answer?.title === UI_TEXT.paidAllowAlways) return 'always'
            snoozed.add(transport)
            return 'deny'
          },
        })
        consents.set(transport, consent)
      }
      return await consent.allows({
        feature: 'tab',
        modelId: options.tabModel,
        budgetUsd: options.tabBudgetUsd,
      })
    },
  })
  const broker = await startWorkspaceBroker(deps.registry, workspace, configuration, {
    trusted: options.trustWorkspace,
    complete: tab.complete,
    supportsReview: false,
    command: (command, _document, _range, transport) => {
      switch (command) {
        case 'muse.stop': {
          setTimeout(() => {
            void stopWorkspace(deps.registry, workspace).catch(() => {
              deps.log.warn('ELSP_STOP')
            })
          }, RUNTIME_STOP.graceMs)
          return Promise.resolve({ stopping: true })
        }
        case 'muse.usage': {
          const current = tab.usage()
          transport.notify('window/showMessage', {
            type: 3,
            message: `${UI_TEXT.paidTabName}\n${fill(UI_TEXT.usagePaidTabCostToday, { cost: formatUsd(current.totalUsd, 2) })}\n${fill(UI_TEXT.usagePaidTabBudget, { budget: formatUsd(current.budgetUsd, 2) })}`,
          })
          return Promise.resolve(current)
        }
        case 'muse.help': {
          transport.notify('window/showMessage', { type: 3, message: UI_TEXT.lspUsage })
          return Promise.resolve({ help: UI_TEXT.lspUsage })
        }
        default: {
          return Promise.reject(new Error('ELSP_PANEL_CONTROLLER_UNAVAILABLE'))
        }
      }
    },
  })
  await broker.closed
  return 0
}
