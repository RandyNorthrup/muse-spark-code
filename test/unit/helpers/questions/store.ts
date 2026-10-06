import { vi } from 'vitest'
import { openQuestionStoreSchema, type QuestionStore } from '../../../../src/shared/questions'

/** Raw storage permits corruption drills; reads and writes validate and copy, as a file adapter must. */
export class FakeQuestionStore implements QuestionStore {
  public readonly files = new Map<string, unknown>()
  public failNextSave = false
  public readonly load = vi.fn<QuestionStore['load']>((sessionId) => {
    const raw = this.files.get(sessionId)
    if (raw === undefined) {
      return Promise.resolve([])
    }
    const parsed = openQuestionStoreSchema.safeParse(structuredClone(raw))
    return parsed.success && parsed.data.snapshot.sessionId === sessionId
      ? Promise.resolve(parsed.data.snapshot.questions)
      : Promise.reject(new Error('invalid fake question store'))
  })
  public readonly save = vi.fn<QuestionStore['save']>((sessionId, questions) => {
    if (this.failNextSave) {
      this.failNextSave = false
      return Promise.reject(new Error('fake question store write failed'))
    }
    const parsed = openQuestionStoreSchema.safeParse({
      version: 1,
      snapshot: { sessionId, questions },
    })
    if (!parsed.success) {
      return Promise.reject(new Error('invalid fake question store write'))
    }
    this.files.set(sessionId, structuredClone(parsed.data))
    return Promise.resolve()
  })
  public readonly remove = vi.fn<QuestionStore['remove']>((sessionId) => {
    this.files.delete(sessionId)
    return Promise.resolve()
  })
}
