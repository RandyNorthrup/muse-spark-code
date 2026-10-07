import { copyFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runtimeQuestionsLoader } from '../../src/runtime/questions/questionRegistryBundle'
import { RUNTIME_QUESTIONS_BUNDLE_FILE, UI_TEXT } from '../../src/shared/constants'
import { builtForTests } from './helpers/lazyBundles'
import { FakeLogOutputChannel } from './helpers/fakes'
import { EN } from '../../src/shared/l10n/en'

const built = builtForTests(
  'src/runtime/questions/questionRegistryEntry.ts',
  RUNTIME_QUESTIONS_BUNDLE_FILE,
)

describe('the real runtime question bundle', () => {
  it('installs the caller language when removal is the first runtime question operation', async () => {
    const bundle = runtimeQuestionsLoader(built.file, new FakeLogOutputChannel())()
    const table = { ...EN, answerNotAccepted: 'Localized invalid session' }
    await expect(
      bundle.removeRuntimeQuestions(built.folder, '../foreign', table, 'de'),
    ).rejects.toThrow(table.answerNotAccepted)
  })

  it('requires the same-build factories once and retries a repaired malformed module', () => {
    const file = path.join(built.folder, 'wrong.js')
    writeFileSync(file, 'module.exports = { createRuntimeQuestionRegistry() {} }')
    const load = runtimeQuestionsLoader(file, new FakeLogOutputChannel())
    expect(load).toThrow(UI_TEXT.questionAnswerFailed)
    copyFileSync(built.file, file)
    const first = load()
    expect(load()).toBe(first)
    expect(first.createRuntimeQuestionRegistry).toBeTypeOf('function')
    expect(first.removeRuntimeQuestions).toBeTypeOf('function')
  })

  it('rejects a nonfunction registry factory even with a valid removal factory', () => {
    const file = path.join(built.folder, 'malformed.js')
    writeFileSync(
      file,
      'module.exports = { createRuntimeQuestionRegistry: 1, removeRuntimeQuestions() {} }',
    )
    expect(runtimeQuestionsLoader(file, new FakeLogOutputChannel())).toThrow(
      UI_TEXT.questionAnswerFailed,
    )
  })
})
