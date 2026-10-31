import { build } from 'esbuild'
import vm from 'node:vm'
import { expect, it } from 'vitest'
import {
  browserConstantTables,
  browserHardwareText,
} from '../../scripts/lib/hardwareGuardSplit.mjs'
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

it('PORTM103 preserves browser constants and omits unrelated literal products', async () => {
  const result = await build({
    stdin: {
      contents: "export { SHELL_TOOLS, RESOURCE_DISK_TREND_MS } from './src/shared/constants.ts'",
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    write: false,
    plugins: [browserConstantTables],
    logLevel: 'silent',
  })
  const text = result.outputFiles[0].text
  expect(text).not.toContain('RUNTIME_MAKER_MAX_BYTES =')
  const module = { exports: {} }
  vm.runInNewContext(text, { module, exports: module.exports })
  expect([...module.exports.SHELL_TOOLS]).toEqual(['bash', 'powershell', 'shell', 'cmd'])
  expect(module.exports.RESOURCE_DISK_TREND_MS).toBe(300_000)
})
