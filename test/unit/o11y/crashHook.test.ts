// M111 lane OB: the crash hook records an uncaught exception or an
// unhandled rejection and the process still exits non-zero. A real child
// Node process runs the hook from a bundled build and dies; the parent
// reads the record file.
import { execFile } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { parseCrashLine } from '../../../src/core/o11y/crash'
import { nodeTempRoot } from '../helpers/nodeNative'

const built: { dir: string; hook: string } = { dir: '', hook: '' }

beforeAll(async () => {
  built.dir = await nodeTempRoot('m111-ob-crashhook-')
  built.hook = path.join(built.dir, 'hook.mjs')
  await build({
    entryPoints: ['src/runtime/o11y/crashHook.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: built.hook,
    logLevel: 'silent',
  })
}, 60_000)

afterAll(async () => {
  if (built.dir !== '') await rm(built.dir, { recursive: true, force: true })
})

async function crashChild(
  script: string,
  recordFile: string,
): Promise<{ code: number; record: string }> {
  const driver = path.join(
    built.dir,
    `driver-${String(Date.now())}-${String(Math.floor(Math.random() * 1_000_000))}.mjs`,
  )
  await writeFile(
    driver,
    `import { appendFileSync } from 'node:fs';
import { installO11yCrashHook } from ${JSON.stringify(built.hook)};
installO11yCrashHook({ component: 'node', writeLine: (line) => appendFileSync(${JSON.stringify(recordFile)}, line) });
${script}\n`,
    'utf8',
  )
  try {
    await promisify(execFile)(process.execPath, [driver], { cwd: tmpdir() })
    return { code: 0, record: '' }
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error
    const code = 'code' in error ? error.code : undefined
    const { readFile } = await import('node:fs/promises')
    let record: string | undefined
    try {
      record = await readFile(recordFile, 'utf8')
    } catch (readError: unknown) {
      // No record file: the child died before writing.
      if (!(readError instanceof Error)) throw readError
      record = undefined
    }
    return { code: typeof code === 'number' ? code : -1, record: record ?? '' }
  } finally {
    await rm(driver, { force: true })
  }
}

describe('o11y crash hook', () => {
  it('records an uncaught exception and still exits non-zero', async () => {
    const recordFile = path.join(built.dir, 'crash-uncaught.jsonl')
    const child = await crashChild(`throw new TypeError('test boom');`, recordFile)
    expect(child.code).toBe(1)
    const record = parseCrashLine(child.record.trimEnd())
    expect(record).toMatchObject({ component: 'node', kind: 'uncaught', code: 'TypeError' })
  })

  it('records an unhandled rejection and still exits non-zero', async () => {
    const recordFile = path.join(built.dir, 'crash-rejection.jsonl')
    const child = await crashChild(`Promise.reject(new RangeError('test rejection'));`, recordFile)
    expect(child.code).toBe(1)
    const record = parseCrashLine(child.record.trimEnd())
    expect(record).toMatchObject({ component: 'node', kind: 'uncaught', code: 'RangeError' })
  })
})
