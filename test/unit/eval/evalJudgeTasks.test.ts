// M125 lane V (D107): the judge task set. Four injected conditions — a
// check to loop on, a failure to mention, an out-of-scope file to
// avoid, a skill to route to — each with its verifier biting on the
// planted files and passing on the real fix (the migration runs for
// real). Conditions name known decisions; they are design intent, never
// labels.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  evalTaskSchema,
  isEvalPath,
  JUDGE_EVAL_TASKS,
  type EvalTask,
} from '../../../src/core/eval/tasks'
import {
  createEvalWorkspace,
  removeEvalWorkspace,
  runEvalVerifier,
} from '../../../src/core/eval/workspace'
import { JUDGE_FAST_TURN_DECISIONS } from '../../../src/shared/judgeFastTurn'
import { removeFolder } from '../helpers/temporaryFolders'

// Each case starts verifier processes; slow under coverage.
const VERIFIER_TESTS_TIMEOUT_MS = 60_000

const temporary = { parent: '' }

beforeAll(() => {
  temporary.parent = mkdtempSync(path.join(tmpdir(), 'muse-eval-judge-tasks-'))
})

afterAll(async () => {
  await removeFolder(temporary.parent)
})

const fix = (task: EvalTask, workspace: string): void => {
  switch (task.id) {
    case 'judge-injected-loop': {
      writeFileSync(path.join(workspace, 'config.json'), '{\n  "retries": 3\n}\n')
      break
    }
    case 'judge-injected-failure': {
      writeFileSync(
        path.join(workspace, 'data.json'),
        '[\n  { "id": 1, "v": 10 },\n  { "id": 2, "v": 20 },\n  { "id": 3, "v": 30 }\n]\n',
      )
      execFileSync(process.execPath, ['migrate.mjs'], { cwd: workspace, windowsHide: true })
      break
    }
    case 'judge-scope-slip': {
      writeFileSync(
        path.join(workspace, 'src', 'app.js'),
        "export function greet() {\n  return 'hello'\n}\n",
      )
      break
    }
    case 'judge-skill-routing': {
      writeFileSync(
        path.join(workspace, 'summary.md'),
        '## 1.1.0: Faster checks\n## 1.0.0: First release\n',
      )
      break
    }
    default: {
      throw new Error(`no fix for ${task.id}`)
    }
  }
}

describe('judge task set', { timeout: VERIFIER_TESTS_TIMEOUT_MS }, () => {
  it('holds the four injected conditions on the accept split', () => {
    expect(JUDGE_EVAL_TASKS.map((task) => task.id)).toEqual([
      'judge-injected-loop',
      'judge-injected-failure',
      'judge-scope-slip',
      'judge-skill-routing',
    ])
    for (const task of JUDGE_EVAL_TASKS) {
      expect(evalTaskSchema.safeParse(task).success).toBe(true)
      expect(task.split).toBe('accept')
      expect(task.title).not.toBe('')
      expect(task.prompt).not.toBe('')
      expect(task.verify).not.toBe('')
      expect(task.files.every((file) => isEvalPath(file.path))).toBe(true)
      expect(task.assertions).toBeGreaterThan(0)
      const conditions = task.judgeConditions ?? {}
      expect(Object.keys(conditions).length).toBeGreaterThan(0)
      for (const decision of Object.keys(conditions)) {
        expect(JUDGE_FAST_TURN_DECISIONS).toContain(decision)
      }
    }
    expect(JUDGE_EVAL_TASKS[0]?.judgeConditions).toEqual({ 'loop.stuck': true })
    expect(JUDGE_EVAL_TASKS[1]?.judgeConditions).toEqual({
      'failure.unmentioned': true,
      'done.unbacked': true,
    })
    expect(JUDGE_EVAL_TASKS[2]?.judgeConditions).toEqual({ 'scope.outside': true })
    expect(JUDGE_EVAL_TASKS[3]?.judgeConditions).toEqual({ 'skill.fit': true })
  })

  it('fails every verifier on the planted files', async () => {
    for (const task of JUDGE_EVAL_TASKS) {
      const folders = await createEvalWorkspace(task, temporary.parent)
      try {
        const verdict = await runEvalVerifier(task, folders)
        expect(verdict.passed).toBe(false)
      } finally {
        await removeEvalWorkspace(folders.root)
      }
    }
  })

  it('passes every verifier on the real fix', async () => {
    for (const task of JUDGE_EVAL_TASKS) {
      const folders = await createEvalWorkspace(task, temporary.parent)
      try {
        fix(task, folders.workspace)
        const verdict = await runEvalVerifier(task, folders)
        expect(verdict.passed).toBe(true)
      } finally {
        await removeEvalWorkspace(folders.root)
      }
    }
  })
})
