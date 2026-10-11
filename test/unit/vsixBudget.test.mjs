import { closeSync, ftruncateSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { checkVsixSize, MAX_VSIX_BYTES } from '../../scripts/check-vsix-size.mjs'

it('accepts the approved compressed cap and rejects one byte above it', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'train15g-vsix-budget-'))
  const file = path.join(folder, 'boundary.vsix')
  const descriptor = openSync(file, 'w')
  try {
    ftruncateSync(descriptor, MAX_VSIX_BYTES)
    expect(checkVsixSize(file)).toBe(MAX_VSIX_BYTES)
    ftruncateSync(descriptor, MAX_VSIX_BYTES + 1)
    expect(() => checkVsixSize(file)).toThrow(`budget is ${MAX_VSIX_BYTES} bytes`)
  } finally {
    closeSync(descriptor)
    rmSync(folder, { recursive: true, force: true })
  }
})
