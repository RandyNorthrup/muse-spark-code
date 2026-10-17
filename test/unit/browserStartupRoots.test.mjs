import path from 'node:path'
import { expect, it } from 'vitest'
import { browserStartupRoots } from '../../scripts/lib/uiTextRegions.mjs'

it('retains real startup entries when the whole committed clone is beneath temp', () => {
  const root = path.resolve('temp/int0180/ci-clone')
  const chat = path.join(root, 'src/webview/main.tsx')
  const models = path.join(root, 'src/webview/modelsMain.tsx')
  const probe = path.join(root, 'temp/english-probe.ts')
  expect(browserStartupRoots([chat, models, probe], root)).toEqual([chat, models])
})
it('excludes project-relative synthetic probes while retaining real readers', () => {
  expect(browserStartupRoots(['src/webview/main.tsx', 'temp/probe.ts'])).toEqual([
    'src/webview/main.tsx',
  ])
})
it('keeps the reference page behind its own English boundary', () => {
  expect(
    browserStartupRoots(['src/webview/main.tsx', 'src/webview/reference/ReferencePage.tsx']),
  ).toEqual(['src/webview/main.tsx'])
})
