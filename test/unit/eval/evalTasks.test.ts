import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  EVAL_FLOOR_ACCEPT_PASS_RATE,
  EVAL_FLOOR_HELDOUT_PASS_RATE,
  EVAL_MODEL_ID,
} from '../../../src/shared/constants'
import { modelApiPaidTier } from '../../../src/shared/paid'
import {
  EVAL_TASKS,
  evalTaskSchema,
  evalTasksOfSplit,
  isEvalPath,
  type EvalTask,
} from '../../../src/core/eval/tasks'
import {
  createEvalWorkspace,
  listWorkspaceFiles,
  removeEvalWorkspace,
  runEvalVerifier,
  type EvalVerdict,
} from '../../../src/core/eval/workspace'
import { removeFolder } from '../helpers/temporaryFolders'
import { EVAL_CANONICAL_FIXES, EVAL_OTHER_FIXES, fixesFor, withFixes } from './evalFixes'

const SHORT_TIMEOUT_MS = 500
// Each case starts verifier processes; slow under coverage.
const VERIFIER_TESTS_TIMEOUT_MS = 60_000
// What libuv adds back to an empty environment on Windows so a process can
// start (its `required_vars`); elsewhere an empty environment stays empty.
const WINDOWS_REQUIRED_VARIABLES = [
  'HOMEDRIVE',
  'HOMEPATH',
  'LOGONSERVER',
  'PATH',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'USERDOMAIN',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
]
// Made when the suite starts, so a run that skips every test leaves no folder.
const temporary = { parent: '' }

beforeAll(() => {
  temporary.parent = mkdtempSync(path.join(tmpdir(), 'muse-eval-tasks-'))
})

afterAll(async () => {
  await removeFolder(temporary.parent)
})

/** The task's verifier over its files as given, in a folder of its own. */
async function verdictOf(task: EvalTask, timeoutMs?: number): Promise<EvalVerdict> {
  const folders = await createEvalWorkspace(task, temporary.parent)
  try {
    return await runEvalVerifier(task, folders, timeoutMs)
  } finally {
    await removeEvalWorkspace(folders.root)
  }
}

function probeTask(verify: string, files = [{ path: 'a.js', content: 'export const a = 1\n' }]) {
  return { id: 'probe', title: 'probe', split: 'accept', prompt: 'probe', files, verify } as const
}

describe('eval task set', { timeout: VERIFIER_TESTS_TIMEOUT_MS }, () => {
  it('holds six accept and four held-out tasks', () => {
    expect(evalTasksOfSplit('accept')).toHaveLength(6)
    expect(evalTasksOfSplit('heldout')).toHaveLength(4)
    expect(EVAL_TASKS).toHaveLength(10)
  })

  it('has unique ids, complete definitions and safe paths', () => {
    const ids = EVAL_TASKS.map((task) => task.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const task of EVAL_TASKS) {
      expect(evalTaskSchema.safeParse(task).success).toBe(true)
      expect(task.title).not.toBe('')
      expect(task.prompt).not.toBe('')
      expect(task.verify).not.toBe('')
      expect(task.files.every((file) => isEvalPath(file.path))).toBe(true)
    }
  })

  it('runs on the contributor model, with floors of five of six and three of four', () => {
    expect(modelApiPaidTier(EVAL_MODEL_ID)).toBe('contributor')
    expect(EVAL_FLOOR_ACCEPT_PASS_RATE).toBe(0.75)
    expect(EVAL_FLOOR_HELDOUT_PASS_RATE).toBe(0.75)
  })

  // The verifiers judge behaviour: each fails its planted defect and passes
  // a fix however it is spelled.
  it.each(EVAL_TASKS.map((task) => [task.id, task] as const))(
    '%s: fails the defect, passes two spellings of the fix',
    async (_id, task) => {
      const [unfixed, canonical, other] = await Promise.all([
        verdictOf(task),
        verdictOf(withFixes(task, fixesFor(EVAL_CANONICAL_FIXES, task))),
        verdictOf(withFixes(task, fixesFor(EVAL_OTHER_FIXES, task))),
      ])
      expect(unfixed.passed).toBe(false)
      expect(unfixed.detail).not.toBe('')
      expect(canonical).toEqual({ passed: true, detail: '' })
      expect(other).toEqual({ passed: true, detail: '' })
    },
  )
})

describe('eval workspace and verifier', { timeout: VERIFIER_TESTS_TIMEOUT_MS }, () => {
  it('writes the fixture files and nothing else, and lists them', async () => {
    const task = probeTask('', [
      { path: 'package.json', content: '{}\n' },
      { path: 'src/deep/a.js', content: 'export const a = 1\n' },
    ])
    const folders = await createEvalWorkspace(task, temporary.parent)
    try {
      const listed = await listWorkspaceFiles(folders.workspace)
      expect(listed.toSorted((a, b) => a.localeCompare(b))).toEqual([
        'package.json',
        'src/deep/a.js',
      ])
      expect(path.dirname(folders.workspace)).toBe(folders.root)
    } finally {
      await removeEvalWorkspace(folders.root)
    }
    expect(existsSync(folders.root)).toBe(false)
  })

  it('refuses a fixture path that leaves the workspace and leaves no folder', async () => {
    const own = mkdtempSync(path.join(temporary.parent, 'refuse-'))
    const task = probeTask('', [{ path: '../escape.js', content: 'x' }])
    await expect(createEvalWorkspace(task, own)).rejects.toThrow('leaves the workspace')
    expect(readdirSync(own)).toEqual([])
  })

  it('starts the verifier with none of the run’s environment', async () => {
    vi.stubEnv('MUSE_EVAL_PROBE', 'inherited')
    vi.stubEnv('META_API_KEY', 'not-a-real-eval-credential')
    try {
      // CoreFoundation generates this even with env:{} and no parent value.
      const posixAllowed = process.platform === 'darwin' ? ['__CF_USER_TEXT_ENCODING'] : []
      const allowed = process.platform === 'win32' ? WINDOWS_REQUIRED_VARIABLES : posixAllowed
      const verdict = await verdictOf(
        probeTask(
          [
            'assert.equal(process.env.MUSE_EVAL_PROBE, undefined)',
            'assert.equal(process.env.META_API_KEY, undefined)',
            `const allowed = new Set(${JSON.stringify(allowed)})`,
            'const extra = Object.keys(process.env).filter((name) => !allowed.has(name.toUpperCase()))',
            'assert.deepEqual(extra, [])',
          ].join('\n'),
        ),
      )
      expect(verdict).toEqual({ passed: true, detail: '' })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('keeps the assertion, not the stack or the temporary path', async () => {
    const verdict = await verdictOf(
      probeTask("const { a } = await load('a.js')\nassert.equal(a, 2, `a.js at ${workspace}`)"),
    )
    expect(verdict.passed).toBe(false)
    expect(verdict.detail).toContain('a.js at <task>')
    expect(verdict.detail).not.toContain(temporary.parent)
    expect(verdict.detail.split('\n').some((line) => line.trimStart().startsWith('at '))).toBe(
      false,
    )
  })

  it('keeps the assertion however much the model’s code printed', async () => {
    const verdict = await verdictOf(
      probeTask("process.stdout.write('x'.repeat(5000))\nassert.equal(1, 2)"),
    )
    expect(verdict.passed).toBe(false)
    expect(verdict.detail).toContain('Expected values to be strictly equal')
    expect(verdict.detail).not.toContain('xxxx')
  })

  it('runs each verifier in a fresh folder of its own', async () => {
    const task = probeTask(
      "assert.equal(readFileSync(join(workspace, 'a.js'), 'utf8').length > 0, true)",
    )
    const folders = await createEvalWorkspace(task, temporary.parent)
    try {
      // What a shell command could leave beside the workspace.
      mkdirSync(path.join(folders.root, 'verify'))
      const firstRun = await runEvalVerifier(task, folders)
      expect(firstRun.passed).toBe(true)
      const secondRun = await runEvalVerifier(task, folders)
      expect(secondRun.passed).toBe(true)
    } finally {
      await removeEvalWorkspace(folders.root)
    }
  })

  it('names the exit code of a verifier that fails silently', async () => {
    const verdict = await verdictOf(probeTask('process.exit(3)'))
    expect(verdict).toEqual({
      passed: false,
      detail: 'the verifier exited with code 3 and no output',
    })
  })

  it('stops a verifier that never finishes', async () => {
    const verdict = await verdictOf(probeTask('setInterval(() => {}, 1000)'), SHORT_TIMEOUT_MS)
    expect(verdict).toEqual({
      passed: false,
      detail: `the verifier did not finish within ${String(SHORT_TIMEOUT_MS)} ms`,
    })
  })
})

describe('isEvalPath', () => {
  it.each(['total.js', 'src/total.js', 'a-b_c.d/e_f-g.js'])('accepts %s', (candidate) => {
    expect(isEvalPath(candidate)).toBe(true)
  })

  it.each([
    '',
    '/total.js',
    './total.js',
    '../total.js',
    'src/../total.js',
    'src/./total.js',
    String.raw`src\total.js`,
    'src/',
    '..',
  ])('refuses %s', (candidate) => {
    expect(isEvalPath(candidate)).toBe(false)
  })
})
