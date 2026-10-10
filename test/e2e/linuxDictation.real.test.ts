import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LineSplitter, parseHelperLine } from '../../src/core/voice/dictation'

// Only absence of the separately downloaded model skips this suite; a supplied model requires a real helper.
const model = process.env['MUSE_DICTATION_MODEL']
const helper = path.resolve('native/linux', process.arch, 'muse-dictate')
// Cold model loading and full CPU inference are real long operations, not protocol-only assertions.
const REAL_OFFLINE_RECOGNITION_TIMEOUT_MS = 30_000
const expected = [
  'Please open the project and run the tests.',
  'Create a new fellow and save the changes.',
  'The microphone records speech on this computer.',
]
const children: ReturnType<typeof spawn>[] = []
afterEach(() => {
  for (const child of children.splice(0)) child.kill()
})

describe.skipIf(model === undefined || !existsSync(model))(
  'real Linux helper recognition (requires MUSE_DICTATION_MODEL)',
  () => {
    it('confines every native loader search to the helper directory', () => {
      const directory = path.dirname(helper)
      const files = readdirSync(directory).filter(
        (file) => file === 'muse-dictate' || /^lib(?:ggml|whisper).*\.so/.test(file),
      )
      expect(files.length).toBeGreaterThan(1)
      for (const file of files) {
        const dynamic = execFileSync('readelf', ['-d', path.join(directory, file)], {
          encoding: 'utf8',
        })
        const search = /\((?:RUNPATH|RPATH)\).*\[([^\]]*)\]/.exec(dynamic)?.[1]
        expect(search, file).toBe('$ORIGIN')
      }
    })
    for (const [index, sentence] of [...expected, expected[0]].entries()) {
      it(
        index === expected.length
          ? 'refuses workspace and environment backend injection'
          : `transcribes libflite fixture ${String(index + 1)} through the pinned real model`,
        async () => {
          expect(process.platform).toBe('linux')
          expect(existsSync(helper)).toBe(true)
          const hostile =
            index === expected.length ? await mkdtemp(path.join(tmpdir(), 'm9-plugin-')) : undefined
          const marker = hostile === undefined ? undefined : path.join(hostile, 'loaded')
          const plugin =
            hostile === undefined ? undefined : path.join(hostile, 'libggml-cpu-evil.so')
          if (plugin !== undefined)
            execFileSync('cc', [
              '-shared',
              '-fPIC',
              'test/native/dictation-linux/plugin.c',
              '-o',
              plugin,
            ])
          const child = spawn(
            helper,
            [
              '--model',
              model ?? '',
              '--input-wav',
              path.resolve(
                `test/fixtures/dictation-linux/${String((index % expected.length) + 1)}.wav`,
              ),
            ],
            {
              stdio: ['pipe', 'pipe', 'pipe'],
              cwd: hostile,
              env:
                plugin === undefined
                  ? {}
                  : { GGML_BACKEND_PATH: plugin, MUSE_PLUGIN_MARKER: marker },
            },
          )
          children.push(child)
          const splitter = new LineSplitter()
          const phrases: string[] = []
          const seen: string[] = []
          const finished = Promise.withResolvers<undefined>()
          child.on('error', finished.reject)
          child.stdout.on('data', (chunk: Buffer) => {
            for (const raw of splitter.push(chunk)) {
              const line = parseHelperLine(raw)
              if (line === undefined) {
                finished.reject(new Error('Invalid helper protocol'))
                return
              }
              seen.push(line.type)
              switch (line.type) {
                case 'ready': {
                  child.stdin.write('start\n')
                  continue
                }
                case 'error': {
                  finished.reject(new Error(line.reason))
                  return
                }
                case 'text': {
                  phrases.push(line.text.trim())
                  continue
                }
                case 'stopped': {
                  child.stdin.end('quit\n')
                  finished.resolve(undefined)
                  continue
                }
                default: {
                  continue
                }
              }
            }
          })
          child.on('exit', (code) => {
            if (!seen.includes('stopped'))
              finished.reject(new Error(`Helper exited ${String(code)} before stopped`))
          })
          try {
            await finished.promise
          } finally {
            if (hostile !== undefined) {
              const wasLoaded = marker !== undefined && existsSync(marker)
              await rm(hostile, { recursive: true, force: true })
              expect(wasLoaded).toBe(false)
            }
          }
          expect(phrases.join(' ')).toBe(sentence)
          expect(seen).toEqual(['ready', 'listening', 'text', 'stopped'])
        },
        REAL_OFFLINE_RECOGNITION_TIMEOUT_MS,
      )
    }
  },
)
