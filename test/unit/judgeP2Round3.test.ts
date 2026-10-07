import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { judgeFeaturesLoader } from '../../src/runtime/judge/judgeBundle'
import { createLogger } from '../../src/host/logger'
import { buildForeignStdin } from '../../src/core/backends/modelapi/hookFormats'
import { FakeLogOutputChannel } from './helpers/fakes'
import { lintRunDependencies } from './helpers/judgeLint'
import { command, io, source } from './judgeCliFixtures'
import { fill, UI_TEXT } from '../../src/shared/l10n/text'
import { removeFolder } from './helpers/temporaryFolders'
import { PAYLOAD, hookDeps, riskOutcome } from './judgeHookCliFixtures'

beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build.mjs', '--production'], { stdio: 'pipe' })
})

function features() {
  return judgeFeaturesLoader({
    bundlePath: path.resolve('dist/judgeP2.js'),
    log: createLogger(new FakeLogOutputChannel()),
  })()
}

describe('round-3 production judge factories', () => {
  it.each(['judgeLint.js', 'judgeHook.js', 'judgeLocal.js', 'judgeUses.js'] as const)(
    'retries %s after a missing or malformed child is repaired',
    async (child) => {
      for (const isMalformed of [false, true]) {
        const folder = mkdtempSync(path.join(tmpdir(), 'muse-judge-child-'))
        try {
          // judgeHook.js externalizes the train's shared boundary bundle. The other children do not.
          for (const file of [
            'judgeP2.js',
            'uiText.js',
            'validation.js',
            'modelApiBoundaries.js',
          ]) {
            copyFileSync(path.resolve('dist', file), path.join(folder, file))
          }
          if (isMalformed)
            writeFileSync(
              path.join(folder, child),
              'module.exports = { createJudgeLintFeatures: true, createJudgeHookFeatures: true, createJudgeLocalFeatures: true, createJudgeUsesFeatures: true }',
            )
          const root = judgeFeaturesLoader({
            bundlePath: path.join(folder, 'judgeP2.js'),
            log: createLogger(new FakeLogOutputChannel()),
          })()
          const load = () => {
            switch (child) {
              case 'judgeLint.js': {
                return root.loadLint()
              }
              case 'judgeHook.js': {
                return root.loadHook()
              }
              case 'judgeLocal.js': {
                return root.loadLocal()
              }
              case 'judgeUses.js': {
                return root.loadUses()
              }
            }
          }
          expect(() => {
            void load()
          }).toThrow(fill(UI_TEXT.judgeNoAnswer, { reason: 'source-unavailable' }))
          copyFileSync(path.resolve('dist', child), path.join(folder, child))
          await expect(load()).resolves.toBeDefined()
        } finally {
          await removeFolder(folder)
        }
      }
    },
  )

  it('keeps missing lint extraction visibly incomplete without inference', async () => {
    const lint = await features().loadLint()
    const deps = lintRunDependencies()
    const result = await lint.runJudgeLint(
      { format: 'json' },
      {
        ...deps,
        extractors: {
          symbols: () => Promise.resolve(undefined),
          syntax: () => Promise.resolve(undefined),
        },
      },
      new AbortController().signal,
    )
    expect(result.exitCode).toBe(2)
    expect(result.report.coverage).toContainEqual(
      expect.objectContaining({ status: 'not-checked' }),
    )
    expect(result.report.incomplete).toBe(true)
    expect(deps.evaluator.judgeAdmitted).not.toHaveBeenCalled()
    expect(() => lint.decodeLintConfig('{"museSpark":true}')).toThrow()
  })

  it('runs injected lint evaluation through the shipped factory', async () => {
    const lint = await features().loadLint()
    const deps = lintRunDependencies()
    const result = await lint.runJudgeLint({}, deps, new AbortController().signal)
    expect(result.exitCode).toBe(0)
    expect(result.report.incomplete).toBe(false)
    expect(result.report.coverage).toContainEqual(expect.objectContaining({ status: 'checked' }))
    expect(deps.evaluator.judgeAdmitted).toHaveBeenCalledOnce()
  })

  it('never registers any Cursor blocking row', async () => {
    const hook = await features().loadHook()
    const events = hook.judgeHookEvents('cursor')
    for (const blocked of [
      'preToolUse',
      'beforeShellExecution',
      'beforeMCPExecution',
      'beforeReadFile',
      'beforeSubmitPrompt',
    ]) {
      expect(events).not.toContain(blocked)
    }
    expect(events).toContain('postToolUse')
  })

  it('delivers Cursor observations and neutral paid refusals through the shipped hook factory', async () => {
    const hook = await features().loadHook()
    const payload = buildForeignStdin(
      'cursor',
      'PostToolUse',
      { ...PAYLOAD, cwd: '/workspace', tool_response: 'clean' },
      { sourceEvent: 'postToolUse', platform: 'linux', workspaceRoot: '/workspace' },
    )
    if (payload.outcome !== 'run') throw new Error('Captured contract refused observation')
    const selected = source('paid', 0.01)
    selected.judge.mockResolvedValue(riskOutcome())
    const refused = io(payload.stdin)
    expect(
      await hook.runJudgeHookCommand(
        command().options,
        { format: 'cursor', event: 'postToolUse' },
        refused,
        hookDeps(selected.value),
      ),
    ).toBe(0)
    expect(refused.output()).toBe('{}\n')
    expect(selected.judge).not.toHaveBeenCalled()
    const admitted = source()
    admitted.judge.mockResolvedValue(riskOutcome())
    const streams = io(payload.stdin)
    expect(
      await hook.runJudgeHookCommand(
        command().options,
        { format: 'cursor', event: 'postToolUse' },
        streams,
        hookDeps(admitted.value),
      ),
    ).toBe(0)
    expect(streams.output()).toContain('Judge caution:')
    expect(admitted.judge).toHaveBeenCalledOnce()
  })
})
