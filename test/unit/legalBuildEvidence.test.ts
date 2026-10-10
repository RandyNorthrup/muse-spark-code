// M97 CM971-R3 (RVCM971B P2-4 and the lead's no-residual ruling): the
// build records the SHA-256 of the exact bytes esbuild compiled and of
// the contents every plugin handed it, captured in the build's own load
// hooks, per build: a source edited after compilation can never be paired
// with the old output, and generated modules, binary inputs and esbuild's
// disabled stand-ins are all attributed.

import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as esbuild from 'esbuild'
import { describe, expect, it } from 'vitest'
import {
  compiledRecordFor,
  newBuildRecord,
  readCompiledSource,
  withCompiledRecording,
} from '../../scripts/lib/compiledSources.mjs'

const sha = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

function workspaceKey(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join('/')
}

function tempDir(): string {
  return realpathSync(mkdtempSync(path.join(tmpdir(), 'legal-build-')))
}

describe('build-captured input hashes', () => {
  it('records the bytes esbuild compiled, not the file after the build', async () => {
    const entry = path.join(tempDir(), 'value.ts')
    const compiled = '\u{FEFF}export const value = 1\n'
    writeFileSync(entry, compiled)
    const record = newBuildRecord()
    const result = await esbuild.build(
      withCompiledRecording(
        {
          entryPoints: [entry],
          bundle: true,
          write: false,
          metafile: true,
          format: 'esm',
          logLevel: 'silent',
        },
        record,
      ),
    )
    // The source changes after compilation, at the same byte length.
    writeFileSync(entry, '\u{FEFF}export const value = 2\n')
    const key = workspaceKey(entry)
    expect(Object.keys(result.metafile.inputs)).toContain(key)
    expect(compiledRecordFor([key], record).inputs).toEqual({ [key]: sha(compiled) })
    expect(result.outputFiles[0]?.text).toContain('1')
  })

  it('records plugin reads and drops a file read twice with different bytes', () => {
    const file = path.join(tempDir(), 'table.ts')
    writeFileSync(file, 'export const a = 1\n')
    expect(readCompiledSource(file)).toBe('export const a = 1\n')
    const key = workspaceKey(file)
    expect(compiledRecordFor([key], newBuildRecord()).inputs).toEqual({
      [key]: sha('export const a = 1\n'),
    })
    writeFileSync(file, 'export const a = 2\n')
    readCompiledSource(file)
    expect(compiledRecordFor([key], newBuildRecord()).inputs).toEqual({})
  })

  it('hashes generated modules and plugin-generated file contents where they are handed over', async () => {
    const dir = tempDir()
    const entry = path.join(dir, 'entry.ts')
    const replaced = path.join(dir, 'replaced.ts')
    writeFileSync(
      entry,
      "import 'virtual-english'\nimport { value } from './replaced'\nconsole.log(value)\n",
    )
    writeFileSync(replaced, 'export const value = 1\n')
    const generatedContents = 'export const value = 2\n'
    const plugin: esbuild.Plugin = {
      name: 'test-generator',
      setup(build) {
        build.onResolve({ filter: /^virtual-english$/ }, () => ({
          path: 'table',
          namespace: 'virtual-english',
        }))
        build.onLoad({ filter: /.*/, namespace: 'virtual-english' }, () => ({
          contents: 'globalThis.EN = 1',
          loader: 'js',
        }))
        build.onLoad({ filter: /replaced\.ts$/ }, () => ({
          contents: generatedContents,
          loader: 'ts',
        }))
      },
    }
    const record = newBuildRecord()
    const result = await esbuild.build(
      withCompiledRecording(
        {
          entryPoints: [entry],
          bundle: true,
          write: false,
          metafile: true,
          format: 'esm',
          logLevel: 'silent',
          plugins: [plugin],
        },
        record,
      ),
    )
    const keys = Object.keys(result.metafile.inputs)
    expect(keys).toContain('virtual-english:table')
    const { inputs, generated } = compiledRecordFor(keys, record)
    expect(generated['virtual-english:table']).toBe(sha('globalThis.EN = 1'))
    const replacedKey = workspaceKey(replaced)
    // The source bytes are pinned at the hand-over; the generated contents are recorded beside them.
    expect(inputs[replacedKey]).toBe(sha('export const value = 1\n'))
    expect(generated[replacedKey]).toBe(sha(generatedContents))
  })

  it('hashes binary inputs as exact bytes and disabled modules as empty', async () => {
    const dir = tempDir()
    const entry = path.join(dir, 'entry.ts')
    const image = path.join(dir, 'pixel.png')
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01])
    writeFileSync(entry, "import pixel from './pixel.png'\nconsole.log(pixel)\n")
    writeFileSync(image, bytes)
    const record = newBuildRecord()
    const result = await esbuild.build(
      withCompiledRecording(
        {
          entryPoints: [entry],
          bundle: true,
          write: false,
          metafile: true,
          format: 'esm',
          logLevel: 'silent',
          loader: { '.png': 'dataurl' },
        },
        record,
      ),
    )
    const imageKey = workspaceKey(image)
    expect(compiledRecordFor(Object.keys(result.metafile.inputs), record).inputs[imageKey]).toBe(
      sha(bytes),
    )
    expect(compiledRecordFor(['(disabled):fs'], record).generated).toEqual({
      '(disabled):fs': sha(new Uint8Array()),
    })
  })

  it('leaves an input the build never loaded unrecorded', () => {
    expect(compiledRecordFor(['src/never-loaded.ts'], newBuildRecord())).toEqual({
      inputs: {},
      generated: {},
    })
  })
})
