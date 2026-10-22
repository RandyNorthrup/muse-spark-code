import type * as RuntimeContextBundle from './contextEntry'
import type * as RuntimeBackendBundle from './backendEntry'
import type * as RuntimeEnginesBundle from './engineEntry'
import type * as RuntimePresentationBundle from '../../host/views/runtimePresentationEntry'
import type * as RuntimePanelPortsBundle from './runtimeFeaturesEntry'
import type * as RuntimePanelBundle from './panelEntry'
import path from 'node:path'
import { lazyBundleLoader, type LazyBundleLoaderOptions } from '../../host/lazyBundle'
import type { Logger } from '../../host/logger'
import {
  CONVERSATION_BUNDLE_FILE,
  RUNTIME_PANEL_BUNDLE_FILE,
  UI_TEXT,
} from '../../shared/constants'

type Bundle = typeof RuntimePanelBundle
/** The packaged same-build factory's callable signature is trusted after its entry guard (PLAN §8). */
function isBundle(value: unknown): value is Bundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runRuntimePanel' in value &&
    typeof value.runRuntimePanel === 'function' &&
    'createAcpConversations' in value &&
    typeof value.createAcpConversations === 'function' &&
    'ControllerRegistry' in value &&
    typeof value.ControllerRegistry === 'function'
  )
}
export function panelLoader(
  deps: Pick<LazyBundleLoaderOptions<Bundle>, 'bundlePath' | 'log' | 'loadBundle'>,
): () => Bundle {
  return lazyBundleLoader({
    ...deps,
    isBundle,
    label: 'runtime panel bundle',
    unavailable: () => UI_TEXT.actionFailed,
  })
}

/** What a headless run needs of the panel: the bundle, loaded with the run's own log, and the conversation bundle's path. */
export interface ExecPanelPort {
  panel: (log: Logger) => Bundle
  conversationBundle: string
}

/**
The headless run's panel port for a package's `dist` folder. The process
entry calls this (dist/acp.js): the guarded loader and both file names stay
out of dist/headless.js, whose budget has no room for them (PLAN.md D6).
*/
export function execPanelPort(distDir: string): ExecPanelPort {
  return {
    panel: (log) =>
      panelLoader({ bundlePath: path.join(distDir, RUNTIME_PANEL_BUNDLE_FILE), log })(),
    conversationBundle: path.join(distDir, CONVERSATION_BUNDLE_FILE),
  }
}

// The signature belongs to this exact packaged build; only callable factories cross the loader.
export function panelPortsLoader(
  deps: Pick<
    LazyBundleLoaderOptions<typeof RuntimePanelPortsBundle>,
    'bundlePath' | 'log' | 'loadBundle'
  >,
): () => typeof RuntimePanelPortsBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: (value): value is typeof RuntimePanelPortsBundle =>
      typeof value === 'object' &&
      value !== null &&
      'createRuntimePanelPorts' in value &&
      typeof value.createRuntimePanelPorts === 'function',
    label: 'runtime panel ports bundle',
    unavailable: () => UI_TEXT.actionFailed,
  })
}

/** Exact same-build factory signatures are trusted after callable guards (PLAN §8). */
export function engineLoader(
  deps: Pick<
    LazyBundleLoaderOptions<typeof RuntimeEnginesBundle>,
    'bundlePath' | 'log' | 'loadBundle'
  >,
): () => typeof RuntimeEnginesBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: (value): value is typeof RuntimeEnginesBundle =>
      typeof value === 'object' &&
      value !== null &&
      [
        'createRuntimeEngineFactory',
        'createRuntimeFactories',
        'runtimeEditorContext',
        'RuntimePresentationViews',
      ].every((key) => typeof Reflect.get(value, key) === 'function'),
    label: 'runtime engines bundle',
    unavailable: () => UI_TEXT.actionFailed,
  })
}

/** Exact same-build factory signatures are trusted after callable guards (PLAN §8). */
export function presentationLoader(
  deps: Pick<
    LazyBundleLoaderOptions<typeof RuntimePresentationBundle>,
    'bundlePath' | 'log' | 'loadBundle'
  >,
): () => typeof RuntimePresentationBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: (value): value is typeof RuntimePresentationBundle =>
      typeof value === 'object' &&
      value !== null &&
      'createRuntimePresentation' in value &&
      typeof value.createRuntimePresentation === 'function' &&
      'createRuntimePresentationFactory' in value &&
      typeof value.createRuntimePresentationFactory === 'function',
    label: 'runtime presentation bundle',
    unavailable: () => UI_TEXT.actionFailed,
  })
}

/** Exact same-build signatures are trusted after callable guards (PLAN §8). */
export function backendLoader(
  deps: Pick<
    LazyBundleLoaderOptions<typeof RuntimeBackendBundle>,
    'bundlePath' | 'log' | 'loadBundle'
  >,
): () => typeof RuntimeBackendBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: (value): value is typeof RuntimeBackendBundle =>
      typeof value === 'object' &&
      value !== null &&
      [
        'createConfiguredPanelBackend',
        'createPanelBackendOptions',
        'createRuntimeCheckpoints',
        'createRuntimeVerify',
        'createRuntimeHooks',
        'createRuntimeMcp',
        'createRuntimeCodeIntel',
        'createRuntimeWebFetch',
        'createRuntimeBrowser',
        'createRuntimeAutoReviewer',
        'createRuntimePaidBudget',
        'RuntimePaidUse',
        'runtimePaidRequestAdmission',
        'createRuntimeTab',
        'createFileScheduleStore',
        'createNativeGitHub',
        'createNativeKeySignIn',
      ].every((key) => typeof Reflect.get(value, key) === 'function'),
    label: 'runtime backend services bundle',
    unavailable: () => UI_TEXT.actionFailed,
  })
}

/** The installed factory signature is trusted after the same-build callable guard (PLAN §8). */
export function contextLoader(
  deps: Pick<
    LazyBundleLoaderOptions<typeof RuntimeContextBundle>,
    'bundlePath' | 'log' | 'loadBundle'
  >,
): () => typeof RuntimeContextBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: (value): value is typeof RuntimeContextBundle =>
      typeof value === 'object' &&
      value !== null &&
      'createRuntimePlans' in value &&
      typeof value.createRuntimePlans === 'function',
    label: 'runtime context bundle',
    unavailable: () => UI_TEXT.actionFailed,
  })
}
