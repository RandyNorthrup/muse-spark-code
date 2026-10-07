import { build } from 'esbuild'
import { describe, expect, it, vi } from 'vitest'
import { isAcpQuestionBundle, questionDeferralLoader } from '../../src/acp/questionDeferralBundle'
import { UI_TEXT, ACP_QUESTIONS_BUNDLE_FILE } from '../../src/shared/constants'
import { builtForTests, lazyLoaderCases } from './helpers/lazyBundles'
import { FakeLogOutputChannel } from './helpers/fakes'
import { FakeQuestionClock } from './helpers/questions/clock'
import { ScriptedQuestionSession } from './helpers/questions/session'
import { FakeAcpQuestionRegistry } from './helpers/questions/acpRegistry'
import {
  deferredCohort,
  sharedUiText,
  sharedValidation,
  sharedWire,
} from '../../scripts/lib/deferredBundles.mjs'

const built = builtForTests('src/acp/questionDeferralEntry.ts', ACP_QUESTIONS_BUNDLE_FILE)

describe('ACP question loader', () => {
  lazyLoaderCases(questionDeferralLoader, built, () => UI_TEXT.questionAnswerFailed)

  it('rejects a nonfunction factory export', () => {
    expect(isAcpQuestionBundle({ createAcpQuestions: 1 })).toBe(false)
    expect(isAcpQuestionBundle(null)).toBe(false)
    expect(isAcpQuestionBundle({ createAcpQuestions: vi.fn(), acpElicitation: 1 })).toBe(false)
  })

  it('installs the caller language before the same-build factory handles a question', () => {
    const bundle = questionDeferralLoader({
      bundlePath: built.file,
      log: new FakeLogOutputChannel(),
    })()
    const clock = new FakeQuestionClock()
    const session = new ScriptedQuestionSession('session-1', 'test-model')
    const registry = new FakeAcpQuestionRegistry({
      session,
      deliver: () => Promise.resolve('taken'),
    })
    const controller = bundle.createAcpQuestions(
      {
        registry,
        clock,
        session,
        seconds: 0,
        notice: vi.fn(),
        failed: vi.fn(),
      },
      { ...UI_TEXT, questionNoOpen: 'PRIVATE-LOCALE-CANARY' },
      'de',
    )
    expect(controller.list()).toBe('PRIVATE-LOCALE-CANARY')
    controller.dispose()
  })
})

describe('M112 ACP question split', () => {
  it('keeps question implementation out of ACP startup and CLI argument parsing', async () => {
    const result = await build({
      entryPoints: ['src/runtime/main.ts'],
      outfile: 'dist/acp.js',
      write: false,
      bundle: true,
      minify: true,
      metafile: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: ['@napi-rs/keyring'],
      plugins: [sharedUiText, sharedValidation, deferredCohort, sharedWire],
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
    })
    expect(Object.keys(result.metafile.inputs)).not.toContain('src/acp/questionDeferral.ts')
  })
})
