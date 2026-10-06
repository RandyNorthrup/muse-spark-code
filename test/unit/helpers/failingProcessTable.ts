// Guardian-only fake: no OS process table is available, so ownership is unprovable.
export function execFile(
  _file: string,
  _args: readonly string[],
  _options: unknown,
  callback: (error: Error, stdout: string) => void,
): void {
  queueMicrotask(() => {
    callback(new Error('fixture process table unavailable'), '')
  })
}
