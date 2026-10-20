// D89.5: one credential-name rule for editor, ACP/headless and plugin children.
import { isCredentialVariable } from '../shared/credentialEnvironment'
export { isCredentialVariable } from '../shared/credentialEnvironment'

/** Explicit names are honored only by callers that admit an interactive shell. */
export function withoutCredentials<T extends NodeJS.ProcessEnv>(
  env: T,
  passNames: readonly string[] = [],
  platform: NodeJS.Platform = process.platform,
): T {
  const names = new Set(passNames.map((name) => (platform === 'win32' ? name.toUpperCase() : name)))
  // Dropping credential variables cannot introduce a workspace entry: a
  // guarded environment stays guarded.
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name]) =>
        !isCredentialVariable(name) || names.has(platform === 'win32' ? name.toUpperCase() : name),
    ),
  ) as T
}
