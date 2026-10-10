// An in-memory Muse Code CLI auth file plus its subscription source.
// Fakes only: the file starts missing; write() replaces its content, so
// rotation and refusal tests share one shape.
import { SubscriptionKeySource } from '../../../src/core/backends/modelapi/subscriptionKey'

export function memorySubscriptionFile() {
  const files = new Map<string, string>()
  const source = new SubscriptionKeySource({
    platform: 'linux',
    homeDir: '/home/u',
    xdgConfigHome: undefined,
    readFile: (file: string) => {
      const found = files.get(file)
      return found === undefined
        ? Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
        : Promise.resolve(found)
    },
    stat: (file: string) =>
      files.has(file)
        ? Promise.resolve({ size: 8, mtimeMs: 3 })
        : Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' })),
  })
  const authFile = source.path()
  return {
    source,
    writeText: (text: string): void => {
      files.set(authFile, text)
    },
    writeAccessToken: (accessToken: string): void => {
      files.set(
        authFile,
        JSON.stringify({ schema_version: 1, providers: { meta: { access_token: accessToken } } }),
      )
    },
  }
}
