/** Test-only VS Code state, shared by paid-host and first-charge suites. */
export function memento(data: Map<string, unknown>) {
  return {
    get: (key: string) => data.get(key),
    update: (key: string, value: unknown) => {
      data.set(key, value)
      return Promise.resolve()
    },
  }
}
