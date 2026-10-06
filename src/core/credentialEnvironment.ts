// D89.5: one credential-name rule for editor, ACP/headless and plugin children.
import {
  CREDENTIAL_ENV_ALLOWED_NAMES,
  CREDENTIAL_ENV_EXACT_NAMES,
  HOOK_FORBIDDEN_ENV_NAMES,
} from '../shared/constants'

export function isCredentialVariable(name: string): boolean {
  const upper = name.toUpperCase()
  return (
    !CREDENTIAL_ENV_ALLOWED_NAMES.has(upper) &&
    (/(?:^|_)(?:API_KEY|ACCESS_KEY|PRIVATE_KEY|SECRET_KEY|SECRET|PASSWORD|PASSPHRASE|TOKEN|CREDENTIALS|AUTH|PAT)$/.test(
      upper,
    ) ||
      /^AZURE_.*(?:KEY|CREDENTIALS|CONNECTION_STRING|CERTIFICATE_PATH)$/.test(upper) ||
      upper.startsWith('TF_TOKEN_') ||
      CREDENTIAL_ENV_EXACT_NAMES.has(upper) ||
      HOOK_FORBIDDEN_ENV_NAMES.has(upper))
  )
}

/** Explicit names are honored only by callers that admit an interactive shell. */
export function withoutCredentials(
  env: NodeJS.ProcessEnv,
  passNames: readonly string[] = [],
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const names = new Set(passNames.map((name) => (platform === 'win32' ? name.toUpperCase() : name)))
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name]) =>
        !isCredentialVariable(name) || names.has(platform === 'win32' ? name.toUpperCase() : name),
    ),
  )
}
