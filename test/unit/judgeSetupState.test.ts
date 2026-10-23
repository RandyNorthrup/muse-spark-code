// M125 lane W (D107): the setup reads the section, the status item
// and the remove flow share. Real files under a scratch root: a
// written registration reads back installed, a missing or corrupt
// one reads as nothing installed, and removal deletes only what
// setup added, after the question.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeJudgeRegistration } from '../../src/core/judge/setup/register'
import type { JudgeSetupRecord } from '../../src/core/judge/setup/register'
import {
  isJudgeSetupDeferred,
  readJudgeSetupState,
  didRemoveJudgeSetupInstall,
  type JudgeSetupPanelPaths,
} from '../../src/host/judgeSetup/judgeSetupState'
import { UI_TEXT } from '../../src/shared/constants'

const roots: string[] = []
afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

const scratchPaths = (): JudgeSetupPanelPaths => {
  const storageRoot = mkdtempSync(path.join(tmpdir(), 'judge-setup-state-'))
  roots.push(storageRoot)
  return {
    storageRoot,
    tableFile: path.join(storageRoot, 'judgeModels.json'),
    recordFile: path.join(storageRoot, 'judge', 'registration.json'),
  }
}

const recordFor = (storageRoot: string): JudgeSetupRecord => ({
  version: 1,
  endpoint: 'http://127.0.0.1:11434',
  model: 'qwen3:8b',
  digest: '0123456789abcdef'.repeat(4),
  runtimePath: path.join(storageRoot, 'judge', 'runtime', 'current', 'ollama'),
  modelsDir: path.join(storageRoot, 'judge', 'models'),
  contextWindow: 8192,
  timeoutMs: 30_000,
  fingerprint: 'fp',
  registeredAt: '2026-10-23T00:00:00.000Z',
})

const silentLog = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

describe('setup state', () => {
  it('reads nothing installed without a registration', () => {
    const state = readJudgeSetupState(scratchPaths())
    expect(state.isInstalled).toBe(false)
    expect(state.model).toBeUndefined()
  })

  it('reads a written registration back installed', () => {
    const paths = scratchPaths()
    mkdirSync(path.dirname(paths.recordFile), { recursive: true })
    writeJudgeRegistration(paths.recordFile, recordFor(paths.storageRoot))
    expect(readJudgeSetupState(paths)).toMatchObject({ isInstalled: true, model: 'qwen3:8b' })
  })

  it('reads a corrupt registration as nothing installed', () => {
    const paths = scratchPaths()
    mkdirSync(path.dirname(paths.recordFile), { recursive: true })
    writeFileSync(paths.recordFile, '{oops')
    expect(readJudgeSetupState(paths).isInstalled).toBe(false)
  })

  it('reads the deferred flag only when true', () => {
    expect(isJudgeSetupDeferred(() => undefined)).toBe(false)
    expect(isJudgeSetupDeferred(() => 'yes')).toBe(false)
    expect(isJudgeSetupDeferred(() => true)).toBe(true)
  })
})

describe('setup remove', () => {
  it('answers nothing installed with no question', async () => {
    const paths = scratchPaths()
    const infos: string[] = []
    let isAsked = false
    const isRemoved = await didRemoveJudgeSetupInstall({
      paths,
      log: silentLog,
      confirm: () => {
        isAsked = true
        return Promise.resolve(true)
      },
      info: (message) => {
        infos.push(message)
      },
    })
    expect(isRemoved).toBe(false)
    expect(isAsked).toBe(false)
    expect(infos).toEqual([UI_TEXT.judgeSetupWizard.removeNone])
  })

  it('changes nothing on a declined question', async () => {
    const paths = scratchPaths()
    mkdirSync(path.dirname(paths.recordFile), { recursive: true })
    writeJudgeRegistration(paths.recordFile, recordFor(paths.storageRoot))
    const isRemoved = await didRemoveJudgeSetupInstall({
      paths,
      log: silentLog,
      confirm: () => Promise.resolve(false),
      info: () => undefined,
    })
    expect(isRemoved).toBe(false)
    expect(readJudgeSetupState(paths).isInstalled).toBe(true)
  })

  it('deletes only what setup added on confirm', async () => {
    const paths = scratchPaths()
    const record = recordFor(paths.storageRoot)
    mkdirSync(path.dirname(record.runtimePath), { recursive: true })
    mkdirSync(record.modelsDir, { recursive: true })
    mkdirSync(path.dirname(paths.recordFile), { recursive: true })
    writeFileSync(record.runtimePath, 'ollama')
    writeFileSync(path.join(record.modelsDir, 'blob'), 'weights')
    const kept = path.join(paths.storageRoot, 'elsewhere.txt')
    writeFileSync(kept, 'mine')
    writeJudgeRegistration(paths.recordFile, record)
    const infos: string[] = []
    const isRemoved = await didRemoveJudgeSetupInstall({
      paths,
      log: silentLog,
      confirm: () => Promise.resolve(true),
      info: (message) => {
        infos.push(message)
      },
    })
    expect(isRemoved).toBe(true)
    expect(readJudgeSetupState(paths).isInstalled).toBe(false)
    expect(infos).toEqual(['Removed qwen3:8b.'])
  })
})
