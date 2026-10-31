import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { checkNativeBundleSize } from '../check-bundle-size.mjs'

function fixture(run) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'muse-native-size-'))
  try {
    writeFileSync(path.join(directory, 'main.inline.js'), Buffer.alloc(950 * 1024))
    writeFileSync(path.join(directory, 'whatsNew.inline.js'), Buffer.alloc(25 * 1024))
    run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('native startup gate counts all folded deferred bytes and rejects oversized main', () => {
  fixture((directory) => {
    checkNativeBundleSize(directory)
    writeFileSync(path.join(directory, 'main.inline.js'), Buffer.alloc(950 * 1024 + 1))
    assert.throws(() => checkNativeBundleSize(directory), /OVER native main/u)
  })
})

test('native startup gate rejects oversized notes and missing shipped entries', () => {
  fixture((directory) => {
    writeFileSync(path.join(directory, 'whatsNew.inline.js'), Buffer.alloc(25 * 1024 + 1))
    assert.throws(() => checkNativeBundleSize(directory), /OVER native whatsNew/u)
    rmSync(path.join(directory, 'main.inline.js'))
    assert.throws(() => checkNativeBundleSize(directory), /ENOENT/u)
  })
})
