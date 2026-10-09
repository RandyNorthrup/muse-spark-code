// The production audio bundle's entry (M105 lane V seam 3B):
// dist/productionAudio.js. The Model API bundle requires it on the first turn
// that carries an attached video or audio part, so Muse Voice's batch
// transcription, its paid seams and the trusted converter never load at
// activation, nor with a text-only session. Its one export builds the host's
// audio port from the deps the bundle factory already holds.
import type { ProviderClient } from '../../core/backends/modelapi/client'
import type { MediaConversionOptions } from '../../core/media/convert'
import { createProductionAudio } from '../../core/voice/productionAudio'
import { createPrivateDirectory } from '../../runtime/privateDirectory'
import { jobMemoryLimitedRun } from './mediaJobRun'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import type { ModelApiBundleDeps } from './modelApiBundle'

/**
 * Lane VB's platform bindings for each conversion: an owner-only folder
 * everywhere; on Windows the kernel job's memory cap (no RSS sampler, so
 * the kernel path is taken); Linux keeps its `/proc` sampler. macOS's `ps`
 * sampler (`core/media/macRss.ts`) reads through M107's resource-policy
 * modules, which only the governor's bundle may carry, so it is not bound
 * here yet and macOS conversion refuses (a named gap). A missing launcher
 * refuses, never runs unbounded.
 */
export function conversionBindings(
  jobExecutable: (() => Promise<string | undefined>) | undefined,
): MediaConversionOptions {
  return {
    createPrivateDirectory: () => createPrivateDirectory(),
    ...(process.platform === 'win32' && {
      memoryLimitedRun: jobMemoryLimitedRun({
        jobExecutable: jobExecutable ?? (() => Promise.resolve(undefined)),
      }),
    }),
  }
}

/** The host's one `prepareAudioMessage`, or none without a registry or the transcription POST. */
export function productionAudioFor(
  bundle: { readonly uiText: UiText; readonly uiLocale: string },
  host: ModelApiBundleDeps['host'],
  client: ProviderClient,
  accountId: string,
) {
  setUiText(bundle.uiText, bundle.uiLocale)
  const attached = host.attachedMedia
  const transcription =
    'requestTranscription' in client ? client.requestTranscription.bind(client) : undefined
  if (attached === undefined || transcription === undefined) return
  return createProductionAudio({
    isPaidFeatureOn: host.isPaidFeatureOn,
    allowsPaidUse: host.allowsPaidUse,
    notePaidUse: host.notePaidUse,
    reservePaidExtra: host.reservePaidExtra,
    attached,
    postTranscription: (post) => transcription(post.route, post.signal, post, accountId),
    converterPath: () => host.mediaConverterPath?.(),
    conversionOptions: () => conversionBindings(host.mediaJobExecutable),
    session: {
      capUsd: host.sessionBudgetUsd,
      journal: host.store?.budget,
      accountId: host.getAccountId,
    },
  })
}
