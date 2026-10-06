// Build the real shipped entries: separation is a property of their output,
// rather than a source-import mock. The production build is serial here.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import type * as validation from '../../src/shared/validationEntry'

const metafileSchema = z.looseObject({
  outputs: z.record(
    z.string(),
    z.looseObject({
      inputs: z.record(z.string(), z.object({ bytesInOutput: z.number() })),
    }),
  ),
})

beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build.mjs', '--production'], { stdio: 'pipe' })
})

function inputs(name: string): string[] {
  const raw: unknown = JSON.parse(readFileSync(`dist/meta/${name}.json`, 'utf8'))
  if (typeof raw !== 'object' || raw === null || !('inputs' in raw)) {
    throw new Error('Invalid build metafile')
  }
  if (typeof raw.inputs !== 'object' || raw.inputs === null) {
    throw new Error('Missing build inputs')
  }
  return Object.keys(raw.inputs).map((file) => file.split(path.sep).join('/'))
}

describe('deferred cohort bundles', () => {
  it('uses the real shared parser for boundary checks without inlining it in Node bundles', () => {
    const require = createRequire(path.resolve('dist/validation.js'))
    const parser: typeof validation = require(path.resolve('dist/validation.js'))
    expect(parser.object({ value: parser.string() }).safeParse({ value: 1 }).success).toBe(false)
    expect(parser.object({ value: parser.string() }).safeParse({ value: 'captured' }).success).toBe(
      true,
    )
    for (const name of [
      'extension',
      'modelApi',
      'browserCheck',
      'browserRuntime',
      'whatsNew',
      'checkpointStore',
      'pageWorker',
      'searchWorker',
    ]) {
      expect(inputs(name).filter((file) => file.startsWith('node_modules/zod/v4/mini/'))).toEqual(
        [],
      )
      expect(readFileSync(`dist/${name}.js`, 'utf8')).toContain('./validation.js')
    }
  })

  it('loads the activation entry without requiring either action bundle', () => {
    const entry = path.resolve('dist/extension.js')
    expect(readFileSync(entry, 'utf8')).toContain('./sessionBoard.js')
    expect(readFileSync('dist/modelApi.js', 'utf8')).toContain('./reviewer.js')
    const nativeRequire = createRequire(entry)
    const loaded: string[] = []
    const module: { exports: unknown } = { exports: {} }
    const run = vm.compileFunction(
      readFileSync(entry, 'utf8'),
      ['require', 'module', 'exports', '__dirname', '__filename'],
      { filename: entry },
    )
    Reflect.apply(run, undefined, [
      (file: string): unknown => {
        loaded.push(file)
        return file === 'vscode' ? {} : nativeRequire(file)
      },
      module,
      module.exports,
      path.dirname(entry),
      entry,
    ])
    expect(module.exports).toHaveProperty('activate', expect.any(Function))
    expect(loaded).not.toContain('./sessionBoard.js')
    expect(loaded).not.toContain('./reviewer.js')
    expect(loaded).not.toContain('./providers.js')
    expect(loaded).not.toContain('./modelsPanel.js')
  })

  it('keeps board and best-of-N execution out of activation', () => {
    const files = inputs('extension')
    expect(files).not.toContain('src/host/bestOfN/bestOfNManager.ts')
    expect(files).not.toContain('src/core/bestOfN/bestOfNRunner.ts')
    expect(files).not.toContain('src/host/sessionBoard.ts')
  })

  it('keeps code intelligence answers and voice drivers in their own bundles', () => {
    const activation = inputs('extension')
    for (const file of ['src/core/codeIntel/codeIntelTools.ts', 'src/core/voice/dictation.ts']) {
      expect(activation).not.toContain(file)
    }
    expect(inputs('codeIntel')).toContain('src/core/codeIntel/codeIntelTools.ts')
    expect(inputs('voice')).toContain('src/core/voice/dictation.ts')
    // The tool list and the helper's location stay where they are read.
    expect(activation).toContain('src/core/codeIntel/definitions.ts')
    expect(activation).toContain('src/core/voice/helperLocation.ts')
  })

  it('keeps the Auto reviewer on Muse Code and M78’s reviewer core out of activation (M90)', () => {
    const activation = inputs('extension')
    for (const file of [
      'src/host/review/museCodeReviewer.ts',
      'src/host/review/reviewedApprovals.ts',
      'src/core/backends/modelapi/autoReviewer.ts',
    ]) {
      expect(activation).not.toContain(file)
      expect(inputs('museCodeReviewer')).toContain(file)
    }
    // The port that requires it on the first review stays where it is asked.
    expect(activation).toContain('src/host/review/museCodeReviewerBundle.ts')
  })

  it('carries every captured codec only in the providers bundle', () => {
    for (const codec of ['anthropic', 'chat', 'gemini', 'ollama', 'responses']) {
      const source = `src/core/backends/modelapi/codecs/${codec}.ts`
      expect(inputs('providers')).toContain(source)
      for (const bundle of ['extension', 'modelApi', 'modelsPanel']) {
        expect(inputs(bundle)).not.toContain(source)
      }
    }
    expect(inputs('providers')).toContain('src/core/providers/providersFile.ts')
  })

  it('keeps paid review execution out of the session first-turn bundle', () => {
    expect(inputs('modelApi')).not.toContain('src/core/backends/modelapi/reviewerEntry.ts')
    expect(inputs('reviewer')).toContain('src/core/backends/modelapi/reviewerEntry.ts')
  })

  it.each([
    ['extension', 'src/host/bestOfN/bestOfNManager.ts', 'on its first action'],
    ['modelsPanel', 'src/shared/protocol.ts', 'chat schemas'],
    ['modelApi', 'node_modules/zod/v4/mini/future.js', 'shared mini-parser'],
    ['webview', 'src/webview/components/UsageDialog.tsx', 'deferred webview chunk'],
    ['modelApi', 'src/core/backends/modelapi/reviewerEntry.ts', 'on its first action'],
    // Split out of activation on 2026-10-03 (PLAN.md D6).
    ['extension', 'src/core/codeIntel/codeIntelQuery.ts', 'on the first code intelligence call'],
    ['extension', 'src/core/voice/museVoice.ts', 'on the first recording'],
    // M95: membership injection must fail in every parent bundle.
    ['extension', 'src/core/backends/modelapi/codecs/anthropic.ts', 'in dist/providers.js'],
    ['modelApi', 'src/core/backends/modelapi/codecs/anthropic.ts', 'in dist/providers.js'],
    ['acp', 'src/core/backends/modelapi/codecs/anthropic.ts', 'in dist/providers.js'],
    ['pageWorker', 'src/core/backends/modelapi/codecs/future.ts', 'in dist/providers.js'],
    ['extension', 'src/core/backends/modelapi/codecs/gemini.ts', 'in dist/providers.js'],
    ['modelApi', 'src/core/backends/modelapi/codecs/responses.ts', 'in dist/providers.js'],
    ['modelsPanel', 'src/core/providers/providersFile.ts', 'in dist/providers.js'],
    ['providers', 'src/core/backends/modelapi/codecs/anthropic.ts', 'missing'],
    ['providers', 'src/core/backends/modelapi/codecs/gemini.ts', 'missing'],
    ['providers', 'src/core/backends/modelapi/codecs/responses.ts', 'missing'],
    ['providers', 'src/core/backends/modelapi/codecs/chat.ts', 'missing'],
    ['providers', 'src/core/backends/modelapi/codecs/ollama.ts', 'missing'],
    // M90: the Auto reviewer on Muse Code, required on the first review.
    ['extension', 'src/host/review/museCodeReviewer.ts', 'on the first review'],
  ])(
    'fires the %s split guard for %s and restores its metafile byte-exact',
    (name, source, use) => {
      const file = `dist/${name === 'acp' ? 'meta-acp' : 'meta'}/${name}.json`
      const original = readFileSync(file)
      const hash = createHash('sha256').update(original).digest('hex')
      const meta = metafileSchema.parse(JSON.parse(original.toString('utf8')))
      const output = meta.outputs[name === 'webview' ? 'dist/webview/main.js' : `dist/${name}.js`]
      if (output === undefined) throw new Error('Missing bundle output')
      try {
        if (name === 'providers') Reflect.deleteProperty(output.inputs, source)
        else output.inputs[source] = { bytesInOutput: 1 }
        writeFileSync(file, JSON.stringify(meta))
        const red = spawnSync(process.execPath, ['scripts/check-bundle-split.mjs'], {
          encoding: 'utf8',
        })
        expect(red.status).toBe(1)
        let message = `dist/${name}.js carries ${source}, which loads only ${use}`
        if (name === 'webview') {
          message = `${source} must occur in exactly one deferred webview chunk`
        } else if (use === 'chat schemas') {
          message = 'dist/modelsPanel.js carries unrelated chat schemas'
        } else if (use === 'shared mini-parser') {
          message = 'dist/modelApi.js inlines the shared mini-parser'
        } else if (name === 'providers') {
          message = `dist/providers.js no longer carries ${source}`
        }
        expect(red.stderr).toContain(message)
      } finally {
        writeFileSync(file, original)
      }
      expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash)
      const green = spawnSync(process.execPath, ['scripts/check-bundle-split.mjs'], {
        encoding: 'utf8',
      })
      expect(green.status, green.stderr).toBe(0)
    },
  )
})
