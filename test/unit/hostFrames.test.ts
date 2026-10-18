// The host frame filter (src/host/support/hostFrames.ts): a stack location
// the URL parser itself rejects drops the frame, while a packaged file
// under the installed root keeps its package name.
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { expect, it } from 'vitest'
import { REPORT_PACKAGE_FRAME_PATHS } from '../../src/shared/constants'
import { hostPackagePath } from '../../src/host/support/hostFrames'

it('drops a location the URL parser rejects', () => {
  for (const raw of ['file://[::1', 'file://%']) {
    expect(() => fileURLToPath(raw)).toThrow(TypeError)
    expect(hostPackagePath(raw, '/root')).toBeUndefined()
  }
})

it('keeps a packaged file under the installed root', () => {
  expect(REPORT_PACKAGE_FRAME_PATHS.has('dist/extension.js')).toBe(true)
  const root = path.parse(process.cwd()).root
  const location = pathToFileURL(path.join(root, 'ext', 'dist', 'extension.js')).href
  expect(hostPackagePath(location, path.join(root, 'ext'))).toBe('dist/extension.js')
  expect(
    hostPackagePath('https://example.com/dist/extension.js', path.join(root, 'ext')),
  ).toBeUndefined()
})
