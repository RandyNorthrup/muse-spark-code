// M125 lane H: registration and removal on scratch. The record
// round-trips byte for byte; missing or corrupt reads as not
// registered; remove deletes exactly the setup-owned paths and only
// them. Real files, real deletion, nothing outside scratch.
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  readJudgeRegistration,
  writeJudgeRegistration,
  type JudgeSetupRecord,
} from '../../src/core/judge/setup/register'
import { removeJudgeInstall } from '../../src/core/judge/setup/remove'
import { FIXTURE_HOOK_TIMEOUT_MS } from './helpers/fixtureBudget'

const DIGEST = 'ab'.repeat(32)

function testRecord(): JudgeSetupRecord {
  return {
    version: 1,
    endpoint: '127.0.0.1:11434',
    model: 'tev1:4b',
    digest: DIGEST,
    runtimePath: '/test/judge/runtime/0.35.1',
    modelsDir: '/test/judge/models',
    contextWindow: 2048,
    timeoutMs: 5000,
    fingerprint: 'test-fingerprint',
    registeredAt: '2026-10-22',
  }
}

describe('setup registration and removal', () => {
  let scratch = ''

  beforeAll(async () => {
    scratch = await mkdtemp(path.join(tmpdir(), 'judge-setup-'))
  }, FIXTURE_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    if (scratch) await rm(scratch, { recursive: true, force: true })
  })

  it('round-trips the registration record', async () => {
    const file = path.join(scratch, 'registration.json')
    writeJudgeRegistration(file, testRecord())
    expect(readJudgeRegistration(file)).toEqual(testRecord())
    expect(await readFile(file, 'utf8')).toContain('"model": "tev1:4b"')
  })

  it('reads missing or corrupt registrations as not registered', async () => {
    expect(readJudgeRegistration(path.join(scratch, 'nope.json'))).toBeUndefined()
    const garbage = path.join(scratch, 'garbage.json')
    await writeFile(garbage, '{nope')
    expect(readJudgeRegistration(garbage)).toBeUndefined()
    const wrong = path.join(scratch, 'wrong.json')
    await writeFile(wrong, JSON.stringify({ version: 1 }))
    expect(readJudgeRegistration(wrong)).toBeUndefined()
  })

  it('removes only what setup added', async () => {
    const root = path.join(scratch, 'install')
    const runtimeRoot = path.join(root, 'judge', 'runtime', '0.35.1')
    const modelsDir = path.join(root, 'judge', 'models')
    const lock = path.join(root, 'judge', 'runtime.lock')
    const record = path.join(root, 'judge', 'registration.json')
    await mkdir(runtimeRoot, { recursive: true })
    await mkdir(modelsDir, { recursive: true })
    await writeFile(path.join(runtimeRoot, 'ollama'), 'binary')
    await writeFile(path.join(modelsDir, 'blob'), 'weights')
    await writeFile(lock, 'lock')
    await writeFile(record, 'record')
    const userFile = path.join(root, 'user-ollama-models', 'mine')
    await mkdir(path.dirname(userFile), { recursive: true })
    await writeFile(userFile, 'mine')
    const removed = await removeJudgeInstall({ runtimeRoot, modelsDir, lock, record })
    expect(new Set(removed.removed)).toEqual(new Set([lock, modelsDir, record, runtimeRoot]))
    expect(removed.missing).toEqual([])
    expect(await readFile(userFile, 'utf8')).toBe('mine')
    const again = await removeJudgeInstall({ runtimeRoot, modelsDir, lock, record })
    expect(again.removed).toEqual([])
    expect(again.missing).toHaveLength(4)
  })
})
