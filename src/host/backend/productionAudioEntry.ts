// The production audio bundle's entry (M105 lane V seam 3B):
// dist/productionAudio.js. The Model API bundle requires it on the first turn
// that carries an attached video or audio part, so Muse Voice's batch
// transcription, its paid seams and the trusted converter never load at
// activation, nor with a text-only session. Its one export builds the host's
// audio port from the deps the bundle factory already holds.
import type { ProviderClient } from '../../core/backends/modelapi/client'
import type { OwnedSessionBudgetScope } from '../../core/backends/modelapi/sessionBudget'
import type { MediaConversionOptions } from '../../core/media/convert'
import { createProductionAudio } from '../../core/voice/productionAudio'
import { UI_TEXT } from '../../shared/constants'
import { isPositiveUsd } from '../../shared/usd'
import {
  createPrivateDirectory,
  openPrivateRoot,
  type PrivateRoot,
} from '../../runtime/privateDirectory'
import type { LeasedRoot } from '../../runtime/privateRootLease'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import type { ModelApiBundleDeps } from './modelApiBundle'

/** Each host's private media root, opened (and verified) and leased once per process. */
const privateRoots = new Map<string, Promise<LeasedRoot>>()

/**
 * The host's root, opened once; a refused root is refused again, never
 * retried quietly. Opening it takes this process's lease and reclaims the
 * folders owners proven gone left behind (RVMEDIAV3 3); the lease is held
 * here for the process's life. The lease code is the media bundle's, which
 * this host already loaded (dist/productionMedia.js).
 */
export function privateRootFor(directory: string): () => Promise<LeasedRoot> {
  return async () => {
    let root = privateRoots.get(directory)
    if (root === undefined) {
      root = openLeased(directory)
      privateRoots.set(directory, root)
    }
    return await root
  }
}

async function openLeased(directory: string): Promise<LeasedRoot> {
  const opened = await openPrivateRoot(directory)
  const media = await import('./productionMediaEntry.js')
  return await media.leasePrivateRoot(opened)
}

/**
 * Lane VB's platform bindings for each conversion:
 * - a fresh owner-only folder inside the host's verified private root (its
 *   own storage, never a shared temporary folder);
 * - Windows: the kernel job's memory cap, no RSS sampler, so the kernel
 *   path is taken; a missing launcher refuses, never runs unbounded;
 * - macOS: a `ps` sampler fenced to each encoder child, loaded from the
 *   resource governor's bundle, which alone carries M107's policy modules;
 * - Linux keeps its `/proc` sampler.
 */
export async function conversionBindings(
  jobExecutable: (() => Promise<string | undefined>) | undefined,
  privateRoot: (() => Promise<PrivateRoot>) | undefined,
): Promise<MediaConversionOptions> {
  const darwin =
    process.platform === 'darwin'
      ? await import('../../core/resources/resourceGovernorEntry')
      : undefined
  const windows =
    process.platform === 'win32'
      ? await import('../../core/resources/resourceProcessEntry')
      : undefined
  return {
    // No root, no folder: conversion refuses rather than use a temporary one.
    createPrivateDirectory: async () => {
      if (privateRoot === undefined) throw new Error('No private media root')
      return await createPrivateDirectory(await privateRoot())
    },
    ...(windows !== undefined && {
      memoryLimitedRun: windows.jobMemoryLimitedRun({
        jobExecutable: jobExecutable ?? (() => Promise.resolve(undefined)),
      }),
    }),
    ...(darwin !== undefined && {
      readRssBytesFor: (child) => darwin.macRssSampler(child),
    }),
  }
}

/** The host's one `prepareAudioMessage`, or none without a registry or the transcription POST. */
export function productionAudioFor(
  bundle: { readonly uiText: UiText; readonly uiLocale: string },
  host: ModelApiBundleDeps['host'],
  client: ProviderClient,
  accountId: string,
  sessionScope: OwnedSessionBudgetScope | undefined,
) {
  setUiText(bundle.uiText, bundle.uiLocale)
  const attached = host.attachedMedia
  const transcription =
    'requestTranscription' in client ? client.requestTranscription.bind(client) : undefined
  if (attached === undefined || transcription === undefined) return
  // A cap with no scope to charge is fail-closed, like the microphone's own
  // press: the batch cost would otherwise leave the conversation's total.
  if (sessionScope === undefined && isPositiveUsd(host.sessionBudgetUsd()))
    throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
  const privateRoot =
    host.mediaPrivateRoot === undefined ? undefined : privateRootFor(host.mediaPrivateRoot)
  return createProductionAudio({
    isPaidFeatureOn: host.isPaidFeatureOn,
    allowsPaidUse: host.allowsPaidUse,
    notePaidUse: host.notePaidUse,
    reservePaidExtra: host.reservePaidExtra,
    attached,
    postTranscription: (post) =>
      transcription(post.route, post.signal, post, accountId, post.dispatch),
    converterPath: () => host.mediaConverterPath?.(),
    audioAction: host.mediaAudioAction,
    conversionOptions: () => conversionBindings(host.mediaJobExecutable, privateRoot),
    session: sessionScope,
  })
}
