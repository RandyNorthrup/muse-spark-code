// One credential-name rule shared by browser validation and every host child boundary.
import {
  CREDENTIAL_ENV_ALLOWED_NAMES,
  CREDENTIAL_ENV_EXACT_NAMES,
  HOOK_FORBIDDEN_ENV_NAMES,
} from './constants'

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
