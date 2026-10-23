// The governor's lazy Windows tree bundle
// (src/core/resources/trees/windowsEntry.ts): the factory builds the very
// reader the governor constructed inline, so a Windows job launch binds
// the same tree through the chunk.
import { expect, it } from 'vitest'
import { WindowsResourceTreeReader } from '../../src/core/resources/trees/windows'
import { createWindowsResourceTreeReader } from '../../src/core/resources/trees/windowsEntry'

it('builds the same reader the governor constructed inline', () => {
  const reader = createWindowsResourceTreeReader({
    assemblyPath: String.raw`C:\helpers\MuseSparkJob.dll`,
    systemRoot: String.raw`C:\Windows`,
  })
  expect(reader).toBeInstanceOf(WindowsResourceTreeReader)
})

it('refuses relative helper paths with the reader sentence', () => {
  expect(() =>
    createWindowsResourceTreeReader({
      assemblyPath: 'relative.dll',
      systemRoot: String.raw`C:\Windows`,
    }),
  ).toThrow('Resource helper paths must be absolute')
})
