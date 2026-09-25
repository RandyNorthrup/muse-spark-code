// The tool outputs opened as read-only documents (M15), kept so a tab that is
// reopened still reads. At most OUTPUT_DOCUMENTS_KEPT of them, and at most
// OUTPUT_DOCUMENTS_MAX_CHARS together (M39): each can be up to 16 MiB, and
// they live in the extension host's memory. The newest one always stays.

import { OUTPUT_DOCUMENTS_KEPT, OUTPUT_DOCUMENTS_MAX_CHARS } from '../shared/constants'

export class OutputDocumentStore {
  private readonly documents = new Map<string, string>()
  private count = 0

  public constructor(
    private readonly maxCount: number = OUTPUT_DOCUMENTS_KEPT,
    private readonly maxChars: number = OUTPUT_DOCUMENTS_MAX_CHARS,
  ) {}

  /** Keeps `content`, drops the oldest over the limits, and returns its id. */
  public add(content: string): string {
    this.count += 1
    const id = String(this.count)
    this.documents.set(id, content)
    let total = 0
    for (const text of this.documents.values()) {
      total += text.length
    }
    for (const [key, text] of this.documents) {
      const isWithinLimits = this.documents.size <= this.maxCount && total <= this.maxChars
      if (isWithinLimits || key === id) {
        break
      }
      this.documents.delete(key)
      total -= text.length
    }
    return id
  }

  public get(id: string): string | undefined {
    return this.documents.get(id)
  }
}
