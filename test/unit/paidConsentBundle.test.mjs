import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { expect, it } from 'vitest'
import { deferredCohort } from '../../scripts/lib/deferredBundles.mjs'
import { EN } from '../../src/shared/l10n/en'
import { fill } from '../../src/shared/l10n/text'
import { Usd } from '../../src/shared/usd'

it('loads the paid question on first use, refuses a missing chunk and retries with the installed language', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'trainact-consent-'))
  try {
    const file = path.join(directory, 'consent.cjs')
    await build({
      stdin: {
        contents:
          "export { paidUseQuestion } from './src/core/paid/paidConsent'; export { setUiText } from './src/shared/l10n/text'",
        resolveDir: process.cwd(),
        loader: 'ts',
      },
      outfile: file,
      bundle: true,
      minify: true,
      platform: 'node',
      format: 'cjs',
      plugins: [deferredCohort],
      logLevel: 'silent',
    })
    const consent = createRequire(import.meta.url)(file)
    consent.setUiText(EN, 'fr')
    // Construction needs no chunk; the first question refuses its absence.
    await expect(consent.paidUseQuestion({ feature: 'voice' })).rejects.toThrow('foreignHooks.js')
    await build({
      entryPoints: ['src/core/backends/modelapi/foreignHooksEntry.ts'],
      outfile: path.join(directory, 'foreignHooks.js'),
      bundle: true,
      minify: true,
      platform: 'node',
      format: 'cjs',
      plugins: [deferredCohort],
      logLevel: 'silent',
    })
    await expect(consent.paidUseQuestion({ feature: 'voice' })).resolves.toEqual({
      title: EN.paidUseVoiceTitle,
      detail: fill(EN.paidUseVoiceDetail, {
        price: `${new Intl.NumberFormat('fr', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(0.18)} per hour of audio`,
      }),
    })
    consent.setUiText(EN, 'en')
    const search = await consent.paidUseQuestion({
      feature: 'webSearch',
      priceUsd: Usd.from('0.0000002').toAmount(),
    })
    expect(search.detail).toContain('$0.00020 per 1,000 searches')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
