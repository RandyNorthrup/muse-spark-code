// M97 CM971-R3 (RVCM971B P2-4): the build records the SHA-256 of the exact
// bytes esbuild compiled, captured in its own onLoad hook, so a source
// edited after compilation can never be paired with the old output.

import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as esbuild from 'esbuild'
import { describe, expect, it } from 'vitest'
import {
  compiledInputHashes,
  compiledSourceRecorder,
  readCompiledSource,
} from '../../scripts/lib/compiledSources.mjs'

const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

function workspaceKey(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join('/')
}

describe('build-captured input hashes', () => {
  it('records the bytes esbuild compiled, not the file after the build', async () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'legal-build-')))
    const entry = path.join(dir, 'value.ts')
    const compiled = '\u{FEFF}export const value = 1\n'
    writeFileSync(entry, compiled)
    const result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      metafile: true,
      format: 'esm',
      logLevel: 'silent',
      plugins: [compiledSourceRecorder],
    })
    // The source changes after compilation, at the same byte length.
    writeFileSync(entry, '\u{FEFF}export const value = 2\n')
    const key = workspaceKey(entry)
    expect(Object.keys(result.metafile.inputs)).toContain(key)
    expect(compiledInputHashes([key])).toEqual({ [key]: sha(compiled) })
    expect(result.outputFiles[0]?.text).toContain('1')
  })

  it('records plugin reads and drops a file read twice with different bytes', () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'legal-build-')))
    const file = path.join(dir, 'table.ts')
    writeFileSync(file, 'export const a = 1\n')
    expect(readCompiledSource(file)).toBe('export const a = 1\n')
    const key = workspaceKey(file)
    expect(compiledInputHashes([key])).toEqual({ [key]: sha('export const a = 1\n') })
    writeFileSync(file, 'export const a = 2\n')
    readCompiledSource(file)
    expect(compiledInputHashes([key])).toEqual({})
  })

  it('leaves an input the recorder never saw unrecorded', () => {
    expect(compiledInputHashes(['src/never-loaded.ts'])).toEqual({})
  })
})
