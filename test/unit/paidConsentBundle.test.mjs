import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { expect, it } from 'vitest'
import { deferredCohort } from '../../scripts/lib/deferredBundles.mjs'
import { EN } from '../../src/shared/l10n/en'

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
    await writeFile(
      path.join(directory, 'foreignHooks.js'),
      `let table, locale;
exports.setUiText = (text, language) => { table = text; locale = language; };
exports.paidUseQuestion = (request) => ({ title: table.paidUseVoiceTitle, detail: locale + ':' + request.feature });`,
    )
    await expect(consent.paidUseQuestion({ feature: 'voice' })).resolves.toEqual({
      title: EN.paidUseVoiceTitle,
      detail: 'fr:voice',
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
