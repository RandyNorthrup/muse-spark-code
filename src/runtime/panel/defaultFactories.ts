import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { createRuntimeEngineFactory } from './engineEntry'
import { presentationLoader, contextLoader } from './panelLoader'
import {
  RUNTIME_PRESENTATION_BUNDLE_FILE,
  RUNTIME_CONTEXT_BUNDLE_FILE,
  UI_TEXT,
  ACP_PAID_OPTIONS,
} from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import type { RuntimeFeatureContext, RuntimeFeatureFactories } from './runtimeFeatures'
import type { RuntimePresentationOptions } from '../../host/views/runtimePresentationEntry'
import { RuntimePresentationViews, type RuntimePresentationPage } from './presentationViews'
import { HOST_ACTIONS, type HostAction } from '../../shared/protocol'
import type { RuntimeEngineOptions } from './engineEntry'
import { isSignedInByStructure } from '../../core/backends/musecode/credentialFile'
import { sharedPresentationPages } from './sharedPages'
import type { PlanFiles } from '../../host/conversation/conversationController'
import type { MhpPanelBinding } from '../../shared/hostApi/panel'
import { isProcessAlive } from '../../host/checkpoints/windowPresence'

export interface RuntimeFactoryOptions {
  readonly distDir: string
  readonly dataRoot: string
  readonly version: string
  readonly hasStoredKey: () => Promise<boolean>
  readonly onSurfaceClosed: NonNullable<RuntimePresentationOptions['onSurfaceClosed']>
  readonly prepareHtml: (binding: MhpPanelBinding, html: string, nonce: string) => Promise<string>
  readonly pages?: (
    context: RuntimeFeatureContext,
  ) => Partial<Record<HostAction, RuntimePresentationPage>>
  readonly engineOptions?: (context: RuntimeFeatureContext) => RuntimeEngineOptions
  readonly presentationOptions?: (context: RuntimeFeatureContext) => RuntimePresentationOptions
}

/** Actual installed assets/native operations, with no browser-supplied command IDs or key entry. */
export function createDefaultFactories(
  options: RuntimeFactoryOptions,
  createEngines: typeof createRuntimeEngineFactory,
): RuntimeFeatureFactories {
  const savedPlans = new WeakMap<RuntimeFeatureContext, PlanFiles>()
  return {
    engines: createEngines(async (context) => {
      const nativeEnding = new AbortController()
      const signal = () =>
        context.signal === undefined
          ? nativeEnding.signal
          : AbortSignal.any([context.signal, nativeEnding.signal])
      const assertCurrent = () => {
        signal().throwIfAborted()
      }
      const plans = await contextLoader({
        bundlePath: path.join(options.distDir, RUNTIME_CONTEXT_BUNDLE_FILE),
        log: context.ports.log,
      })().createRuntimePlans(context, options.distDir, UI_TEXT, uiLocale())
      savedPlans.set(context, plans)
      const isStored = await options.hasStoredKey()
      return {
        plans,
        keyPresence: () => isStored,
        transfer: {
          platform: process.platform,
          assertCurrent,
          cancelPrompts: () => {
            nativeEnding.abort()
          },
          pickFile: async (title, requestSignal) =>
            (await context.ports.host.request(
              'ui/openFile',
              { title },
              AbortSignal.any([requestSignal, signal()]),
            )) ?? undefined,
          confirm: async (title, message, requestSignal) =>
            (await context.ports.host.request(
              'ui/confirm',
              {
                title,
                message,
                choices: [
                  { id: ACP_PAID_OPTIONS.allowOnce, title: UI_TEXT.allowOnce },
                  { id: ACP_PAID_OPTIONS.deny, title: UI_TEXT.paidDeny },
                ],
              },
              AbortSignal.any([requestSignal, signal()]),
            )) === ACP_PAID_OPTIONS.allowOnce,
        },
        ...options.engineOptions?.(context),
      }
    }),
    presentation: async (context, table, locale) => {
      const configured = options.presentationOptions?.(context)
      const host = context.ports.host
      const nonces = new Map<string, string>()
      context.own(() => {
        nonces.clear()
        return Promise.resolve()
      })
      const factory = presentationLoader({
        bundlePath: path.join(options.distDir, RUNTIME_PRESENTATION_BUNDLE_FILE),
        log: context.ports.log,
      })().createRuntimePresentationFactory(() => ({
        onSurfaceClosed: options.onSurfaceClosed,
        whatsNew: {
          current: options.version,
          readContent: () => readFile(path.join(options.distDir, 'whatsNew.json'), 'utf8'),
          assets: (binding) => {
            const nonce = randomUUID()
            nonces.set(binding.surface, nonce)
            return {
              cspSource: "'self'",
              nonce,
              scriptUri: '/assets/portable/whatsNew.js',
              styleUri: '/assets/portable/whatsNew.css',
              locale,
            }
          },
          present: async (binding, html) => {
            const nonce = nonces.get(binding.surface)
            if (nonce === undefined) throw new Error('MHP_PRESENTATION_NONCE_MISSING')
            const document = await options.prepareHtml(binding, html, nonce)
            await host.request(
              'surfaces/presentHtml',
              { surfaceId: binding.surface, sessionId: binding.sessionId, html: document },
              context.signal,
            )
          },
          executeCommand: async (id) => {
            await host.request('commands/run', { id, args: [] }, context.signal)
          },
          openSetting: async (key) => {
            await host.request('ui/showSetting', { key }, context.signal)
          },
          isShownOnUpdate: () => context.ports.settings.current().showWhatsNewOnUpdate,
          setShownOnUpdate: async (isShown) => {
            await context.ports.store.updateSetting(
              'museSpark.showWhatsNewOnUpdate',
              isShown,
              'user',
            )
          },
        },
        reports: {
          deps: {
            journal: {
              globalStorageDir: options.dataRoot,
              instance: randomUUID(),
              ext: options.version,
              host: process.versions.node,
              pid: process.pid,
              log: context.ports.log,
              isAlive: isProcessAlive,
              extensionRoot: path.dirname(options.distDir),
              now: Date.now,
            },
            readFacts: async () => {
              const cli = context.ports.runtime.museCode
              const credential = cli.credentialFileVerdict()
              return {
                extensionVersion: options.version,
                nodeVersion: process.versions.node,
                platform: process.platform,
                backend: context.ports.runtime.backend.kind,
                sandbox: context.ports.options.shellSandbox,
                cliFound: cli.resolveLaunch().ok,
                cliSignIn: isSignedInByStructure(credential === 'absent' ? undefined : credential),
                hasStoredApiKey: await options.hasStoredKey(),
                hasEnvironmentApiKey: cli.hasEnvironmentKey(),
                settingNames: await context.ports.store.settingNames(),
              }
            },
            readScrub: () => ({
              workspaceRoots: [context.ports.workspaceRoot],
              homeDir: homedir(),
              extraLiterals: [],
            }),
            saveText: async (text) =>
              await host.request(
                'ui/saveText',
                { title: UI_TEXT.reportTitle, suggestedName: 'muse-spark-report.md', text },
                context.signal,
              ),
          },
          onCrashOffer: () => context.queueAfterReady?.({ type: 'openReport' }),
        },
        ...configured,
      }))
      const contribution = await factory(context, table, locale)
      const pages = {
        ...sharedPresentationPages(context, savedPlans.get(context)),
        ...options.pages?.(context),
      }
      const views = new RuntimePresentationViews(context, (code) =>
        contribution.features.reports?.recordWebviewError({
          kind: 'reactBoundary',
          source: 'render',
          code,
          frames: [],
        }),
      )
      context.own(() => views.dispose())
      const actions: Partial<Record<HostAction, () => Promise<void>>> = { ...contribution.actions }
      for (const [id, page] of Object.entries(pages)) {
        const action = HOST_ACTIONS.find((candidate) => candidate === id)
        if (action === undefined || actions[action] !== undefined)
          throw new Error('MHP_COMPOSITION_ACTION_CONFLICT')
        actions[action] = () => views.show(page)
      }
      const stop = options.onSurfaceClosed((id) => {
        views.closed(id)
      })
      context.own(() => {
        stop()
        return Promise.resolve()
      })
      return {
        ...contribution,
        actions,
        view: (binding) => views.view(binding) ?? contribution.view?.(binding),
      }
    },
  }
}
