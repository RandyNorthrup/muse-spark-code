// The frozen M75 harness (M101 lane C-M101-2): the arms and tasks the
// counted run uses, named exactly, with the digest of their frozen bytes
// (including executed bundle bytes and explicitly declared fixtures).
// Changing any arm or task breaks this file on purpose: re-freeze by
// recording the new digest here and in docs/certification/m101-eval-arms.md,
// never by weakening the comparison.

import pin from '../../../src/core/eval/frozen.json'
import { buildSync } from 'esbuild'
import config from '../../../vitest.config'
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { JOB_SOURCE_FILES } from '../../../src/host/backend/jobSource'
import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { EVAL_HELD_DEPS } from '../../../src/core/eval/heldDeps'
import {
  AUTO_COMPACTION_ARM,
  BASELINE_ARM,
  EVAL_ARMS,
  OBSERVATION_PACKING_ARM,
  STRICT_TOOLS_ARM,
  canonicalDigestPath,
  canonicalDigestText,
  compareDigestPath,
  evalHarnessSources,
  evalHarnessDigest,
  assertEvalHarnessDigest,
  freezeEvalHarness,
  frozenSourceDigests,
  frozenBundleChange,
  trackedSourceFamily,
} from '../../../src/core/eval/mechanisms'
import type { EvalArm } from '../../../src/core/eval/runner'
import type { ModelApiHostDeps } from '../../../src/core/backends/modelapi/ModelApiHost'
import { EVAL_TASKS } from '../../../src/core/eval/tasks'
import { FakeLogOutputChannel } from '../helpers/fakes'
import { fakeModelApi, fakeModelApiClient } from '../helpers/fakeModelApi'
import { memoryToolIo } from '../helpers/fakeToolIo'
import { fakeModelApiHostDeps } from '../helpers/modelApiHostDeps'

// Share the expensive snapshot; each guard keeps its independent assertion.
const snapshot: { frozen?: ReturnType<typeof freezeEvalHarness> } = {}
beforeAll(() => {
  snapshot.frozen = freezeEvalHarness()
})

function frozenSnapshot(): ReturnType<typeof freezeEvalHarness> {
  if (snapshot.frozen === undefined) throw new Error('the snapshot setup did not run')
  return snapshot.frozen
}

describe('the frozen evaluation harness', () => {
  it('freezes the four arms in run order', () => {
    expect(EVAL_ARMS).toEqual([
      BASELINE_ARM,
      OBSERVATION_PACKING_ARM,
      AUTO_COMPACTION_ARM,
      STRICT_TOOLS_ARM,
    ])
    expect(EVAL_ARMS.map((arm) => arm.name)).toEqual([
      'baseline',
      'packing',
      'auto-compaction',
      'strict-tools',
    ])
  })

  it('freezes the sixteen tasks in run order', () => {
    expect(EVAL_TASKS.map((task) => [task.id, task.split])).toEqual([
      ['accept-long-compaction', 'accept'],
      ['heldout-long-compaction', 'heldout'],
      ['accept-long-middle-value', 'accept'],
      ['heldout-long-middle-rule', 'heldout'],
      ['accept-off-by-one', 'accept'],
      ['accept-null-guard', 'accept'],
      ['accept-await-read', 'accept'],
      ['accept-import-path', 'accept'],
      ['accept-no-secret', 'accept'],
      ['accept-empty-average', 'accept'],
      ['heldout-strict-equal', 'heldout'],
      ['heldout-clear-timer', 'heldout'],
      ['heldout-sort-numbers', 'heldout'],
      ['heldout-await-write', 'heldout'],
      ['accept-multi-edit', 'accept'],
      ['heldout-multi-edit', 'heldout'],
    ])
  })

  it('keeps the frozen digest', () => {
    expect(assertEvalHarnessDigest(undefined, frozenSnapshot())).toBe(pin.sha256)
  })

  it('refuses an uncertified live harness before any call', () => {
    expect(() => assertEvalHarnessDigest('deliberately wrong', frozenSnapshot())).toThrow(
      'no live call may run',
    )
  })

  it('freezes every local source in the live-test and launcher resolver graph', () => {
    const frozen = frozenSnapshot()
    expect(frozen.sources).toEqual(evalHarnessSources())
    const runner = z
      .object({
        resolve: z.object({ alias: z.record(z.string(), z.string()) }),
        test: z.object({ setupFiles: z.array(z.string()), globalSetup: z.array(z.string()) }),
      })
      .parse(config)
    const graph = buildSync({
      entryPoints: [
        'test/e2e/eval.live.e2e.test.ts',
        'scripts/m101-e.mjs',
        'vitest.config.ts',
        ...runner.test.setupFiles,
        ...runner.test.globalSetup,
        ...Object.values(runner.resolve.alias),
      ],
      outdir: 'graph-test',
      bundle: true,
      write: false,
      metafile: true,
      packages: 'external',
      platform: 'node',
      format: 'esm',
    }).metafile
    for (const input of Object.keys(graph.inputs)) {
      const file = input.replaceAll('\\', '/').replace(/ with \{.*\}$/u, '')
      if (file !== 'src/core/eval/frozen.json') expect(frozen.sources).toContain(file)
    }
    for (const file of [
      'src/core/eval/wire.ts',
      'src/core/eval/driver.ts',
      'src/core/eval/report.ts',
      'src/core/eval/workspace.ts',
      'test/e2e/evalLiveSupport.ts',
      'test/e2e/eval.live.e2e.test.ts',
      'scripts/m101-e.mjs',
      'src/core/eval/tasks.ts',
      'src/core/eval/plan.json',
      'package.json',
      'tsconfig.json',
      'tsconfig.base.json',
      'test/e2e/tsconfig.json',
      'test/unit/tsconfig.json',
      'src/webview/tsconfig.json',
    ])
      expect(frozen.sources).toContain(file)
    for (const file of Object.values(JOB_SOURCE_FILES))
      expect(frozen.sources).toContain(file.replaceAll('\\', '/'))
    expect(frozen.sources.some((file) => file.includes('\\'))).toBe(false)
    // The actual global setup also compiles UI entries and scans regional readers as data.
    // The walk covers the committed family only, like the digest: untracked
    // scratch never moves it (proved below), so the assertion reads the
    // same tracked set.
    const tracked = trackedSourceFamily(process.cwd())
    const dataInputs = readdirSync('src', { recursive: true, withFileTypes: true })
    for (const entry of dataInputs) {
      if (!entry.isFile()) continue
      const file = canonicalDigestPath(
        path.relative(process.cwd(), path.join(entry.parentPath, entry.name)),
      )
      if (file !== 'src/core/eval/frozen.json' && tracked.has(file))
        expect(frozen.sources).toContain(file)
    }
  })

  it('hashes one value for a CRLF tree and an LF tree, including lone carriage returns', () => {
    // The digest folds line endings before hashing: a checkout whose line
    // endings were converted hashes like the bytes Git stores.
    const lf = 'line one\nline two\n'
    const crlf = 'line one\r\nline two\r\n'
    expect(canonicalDigestText(crlf)).toBe(lf)
    expect(canonicalDigestText('a\rb')).toBe('a\nb')
    expect(canonicalDigestText(lf)).toBe(lf)
    const fromLf = frozenSourceDigests([
      { path: 'src/core/eval/a.ts', text: lf },
      { path: 'src/core/eval/b.ts', text: 'export const x = 1\n' },
    ])
    const fromCrlf = frozenSourceDigests([
      { path: 'src/core/eval/a.ts', text: crlf },
      { path: 'src/core/eval/b.ts', text: 'export const x = 1\r\n' },
    ])
    expect(fromCrlf).toEqual(fromLf)
  })

  it('hashes one value for backslash and forward-slash paths in byte order', () => {
    // A Windows-style file list hashes like the POSIX one; entries hash
    // in UTF-8 byte order whatever order they arrive in.
    expect(canonicalDigestPath(String.raw`src\core\eval\a.ts`)).toBe('src/core/eval/a.ts')
    const forward = frozenSourceDigests([
      { path: 'src/core/eval/b.ts', text: 'two\n' },
      { path: 'src/core/eval/a.ts', text: 'one\n' },
    ])
    const backward = frozenSourceDigests([
      { path: String.raw`src\core\eval\a.ts`, text: 'one\n' },
      { path: String.raw`src\core\eval\b.ts`, text: 'two\n' },
    ])
    expect(backward).toEqual(forward)
    expect(forward.map((entry) => entry.path)).toEqual(['src/core/eval/a.ts', 'src/core/eval/b.ts'])
  })

  it('sorts this tree identically in byte order and code-unit order', () => {
    // The byte-order sort changes nothing on this ASCII tree: swapping
    // the comparator cannot move the pin by itself.
    const sources = frozenSnapshot().sources
    expect([...sources].toSorted(compareDigestPath)).toEqual(sources)
    expect(
      [...sources].toSorted((left, right) => Number(left > right) - Number(left < right)),
    ).toEqual(sources)
  })

  it('leaves an untracked file under src/ out of the hashed sources', () => {
    // Untracked scratch, editor backups and merge leftovers never move
    // the digest on one machine: the family walk covers tracked files
    // only, while files the run loads stay hashed through the graph.
    const probe = 'src/m101-untracked-probe.tmp'
    writeFileSync(probe, 'untracked scratch\n')
    try {
      expect(trackedSourceFamily(process.cwd()).has(probe)).toBe(false)
      expect(evalHarnessSources()).toEqual(frozenSnapshot().sources)
    } finally {
      rmSync(probe)
    }
  })

  it('binds actual input bytes and the freshly emitted worker to the receipt', () => {
    const frozen = frozenSnapshot()
    const receipt = EVAL_ARMS.map((arm) => ({
      name: arm.name,
      mechanism: arm.mechanism ?? null,
      sha256: frozen.bundles.get(arm.name)?.sha256 ?? null,
    }))
    const sources = frozen.sources.map((file) => ({
      path: file,
      sha256: createHash('sha256')
        .update(readFileSync(file, 'utf8').replaceAll('\r\n', '\n'))
        .digest('hex'),
    }))
    const hash = (inputs: typeof sources, worker = frozen.searchWorker.sha256) =>
      createHash('sha256')
        .update(JSON.stringify({ receipt, sources: inputs, searchWorker: worker }))
        .digest('hex')
    expect(hash(sources)).toBe(frozen.sha256)
    for (const file of [
      'vitest.config.ts',
      'test/unit/setup.ts',
      'test/unit/globalSetup.mjs',
      'test/unit/mocks/vscode.ts',
      'tsconfig.json',
      'tsconfig.base.json',
      'package.json',
      'src/core/eval/plan.json',
      'scripts/m101-e.mjs',
    ]) {
      expect(sources.some((source) => source.path === file)).toBe(true)
      expect(
        hash(
          sources.map((source) =>
            source.path === file ? { ...source, sha256: 'changed bytes' } : source,
          ),
        ),
      ).not.toBe(frozen.sha256)
    }
    expect(createHash('sha256').update(frozen.searchWorker.code).digest('hex')).toBe(
      frozen.searchWorker.sha256,
    )
    expect(hash(sources, createHash('sha256').update('process.exit(0)').digest('hex'))).not.toBe(
      frozen.sha256,
    )
    expect(frozen.sources).not.toContain('dist/searchWorker.js')
  })

  it('changes each arm in one mechanism only, never a held harness dependency', () => {
    // M101 R2: an arm pair isolates its mechanism only when both arms share
    // every other harness dependency. Each frozen arm therefore touches
    // exactly its mechanism's dependency keys — and no held one (the
    // window, the memory store, the client, the workspace, the paid hooks).
    const api = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const io = memoryToolIo({}, '/ws')
    const base: ModelApiHostDeps = fakeModelApiHostDeps({
      client: fakeModelApiClient(api, log),
      workspaceRoot: '/ws',
      io,
      log,
    })
    const changedKeys = (arm: EvalArm): string[] => {
      if (arm.change === undefined) {
        return []
      }
      const changed = arm.change(base)
      const original = new Map(Object.entries(base))
      return Object.entries(changed)
        .filter(([key, value]) => value !== original.get(key))
        .map(([key]) => key)
        .toSorted((left, right) => left.localeCompare(right))
    }
    expect(new Map(EVAL_ARMS.map((arm) => [arm.name, changedKeys(arm)]))).toEqual(
      new Map([
        ['baseline', []],
        ['packing', ['observationPacking']],
        ['auto-compaction', ['admitAutoCompaction', 'autoCompaction', 'autoCompactionEvaluated']],
        ['strict-tools', ['modelFacts']],
      ]),
    )
    for (const arm of EVAL_ARMS) {
      const held = new Set<string>(EVAL_HELD_DEPS)
      expect(changedKeys(arm).filter((key) => held.has(key))).toEqual([])
    }
  })

  it('freezes four executable snapshots with only declared fixture paths', () => {
    const frozen = frozenSnapshot()
    expect(frozen.bundles.size).toBe(EVAL_ARMS.length)
    expect(new Set(frozen.bundles.keys())).toEqual(new Set(EVAL_ARMS.map((arm) => arm.name)))
    expect(frozen.sha256).toBe(pin.sha256)
    for (const arm of EVAL_ARMS) {
      const bundle = frozen.bundles.get(arm.name)!
      expect(bundle.fixtures.map((fixture) => fixture.path)).toEqual([
        'armSources.ts',
        'mechanisms.ts',
        'runner.ts',
        'heldDeps.ts',
        'tasks.ts',
        'conditions.json',
      ])
      expect(() => frozenBundleChange(bundle)).not.toThrow()
    }
  })

  it('freezes the arm behaviour, not only its names and descriptions', () => {
    // M101 R2: a digest over names and descriptions alone stays green when
    // an arm's implementation changes. The frozen digest must therefore
    // differ from a hash over the same arms and tasks with every
    // implementation byte left out; the red drills flip an arm latch and
    // narrow strict tools to watch this test fail.
    const descriptionOnly = createHash('sha256')
      .update(
        EVAL_ARMS.map((arm) => `${arm.name}:${arm.mechanism ?? ''}`).join('\n') +
          EVAL_TASKS.map((task) => `${task.id}:${task.split}:${task.title}`).join('\n'),
        'utf8',
      )
      .digest('hex')
    expect(evalHarnessDigest(frozenSnapshot())).not.toBe(descriptionOnly)
    for (const arm of EVAL_ARMS) {
      if (arm.change === undefined) {
        continue
      }
      expect(typeof arm.change.toString()).toBe('string')
      expect(arm.change.toString().length).toBeGreaterThan(0)
    }
  })
})
