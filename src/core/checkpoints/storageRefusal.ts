// A checkpoint-storage write refused before any IO (M86, SECWINPATH): the
// model's fixed English reason and the row's sentence in the display
// language travel on one throw, the way a refused web fetch carries both
// (webFetchRefusal), so the session tells each reader its own words. The
// sentences name no path: the refusal is the fact, not the target.

export class StorageRefusalError extends Error {
  public constructor(
    public readonly modelReason: string,
    public readonly visibleReason: string,
  ) {
    super(modelReason)
    this.name = 'StorageRefusalError'
  }
}
