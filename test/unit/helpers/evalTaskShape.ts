// The eval task sets' shared definition check (M73, M125 lane V).
import { expect } from 'vitest'
import { evalTaskSchema, isEvalPath, type EvalTask } from '../../../src/core/eval/tasks'

/** The task parses, says what to do and how it is verified, and writes only safe paths. */
export function expectCompleteEvalTask(task: EvalTask): void {
  expect(evalTaskSchema.safeParse(task).success).toBe(true)
  expect(task.title).not.toBe('')
  expect(task.prompt).not.toBe('')
  expect(task.verify).not.toBe('')
  expect(task.files.every((file) => isEvalPath(file.path))).toBe(true)
}
