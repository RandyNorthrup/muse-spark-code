// The tool outputs opened as read-only documents (M15), kept so a tab that is
// reopened still reads. Every document stays: the provider's own output
// limits decide how large a tool result may be, and the panel's collapsed
// rows (with Show More one click away) carry the display cost instead.

export class OutputDocumentStore {
  private readonly documents = new Map<string, string>()
  private count = 0

  /** Keeps `content` and returns its id; nothing is dropped. */
  public add(content: string): string {
    this.count += 1
    const id = String(this.count)
    this.documents.set(id, content)
    return id
  }

  public get(id: string): string | undefined {
    return this.documents.get(id)
  }
}
