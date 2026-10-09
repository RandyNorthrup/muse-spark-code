import { build } from 'esbuild'
import { expect, it } from 'vitest'
import { browserHardwareText } from '../../scripts/lib/hardwareGuardSplit.mjs'
import { UI_TEXT } from '../../src/shared/constants'

it('Design 5 review P3 browser fallback ships the hardware migration message', async () => {
  const result = await build({
    stdin: {
      contents: "export { EN } from './src/shared/l10n/en.ts'",
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    plugins: [browserHardwareText],
  })
  const text = result.outputFiles[0].text
  expect(text).toContain(UI_TEXT.hardwareBindingUnavailable)
  expect(text).not.toContain(UI_TEXT.hardwareRefused)
})
