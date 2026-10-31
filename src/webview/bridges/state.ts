import { jsonValueSchema } from '../../shared/hostApi/data'

/** Match webview state's JSON serialization, including omitted optional fields. */
export function browserState(value: unknown) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol')
    throw new TypeError('MHP_INVALID_STATE')
  const encoded = JSON.stringify(value)
  const decoded: unknown = JSON.parse(encoded)
  return jsonValueSchema.parse(decoded)
}

/** UI snapshots survive a reload in this tab; authentication stays in memory. */
export function companionStateStore(
  surface: string,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
) {
  const key = `muse-panel-ui:${surface}`
  return {
    getState() {
      const encoded = storage.getItem(key)
      if (encoded === null) return
      const value: unknown = JSON.parse(encoded)
      return jsonValueSchema.parse(value)
    },
    setState(value: unknown) {
      storage.setItem(key, JSON.stringify(browserState(value)))
    },
  }
}
