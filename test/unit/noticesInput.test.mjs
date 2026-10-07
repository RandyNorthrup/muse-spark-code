import { expect, it } from 'vitest'
import { noticePackageDir } from '../../scripts/lib/noticesInput.mjs'

it('includes deferred validation licences using their real POSIX and Windows package paths', () => {
  expect(noticePackageDir('resource-validation:/repo/node_modules/zod/v4/mini/index.js')).toBe(
    '/repo/node_modules/zod',
  )
  expect(
    noticePackageDir(String.raw`resource-validation:C:\repo\node_modules\zod\v4\mini\index.js`),
  ).toBe('C:/repo/node_modules/zod')
  expect(noticePackageDir('node_modules/@muse-code/sdk/dist/index.js')).toBe(
    'node_modules/@muse-code/sdk',
  )
  expect(noticePackageDir('node_modules/a/node_modules/b/index.js')).toBe(
    'node_modules/a/node_modules/b',
  )
  expect(noticePackageDir('src/shared/resources.ts')).toBeUndefined()
})
