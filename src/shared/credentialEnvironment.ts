// One credential-name rule shared by browser validation and every host child boundary.
import {
  CLAUDE_PLAN_ENV_NAMES,
  CREDENTIAL_ENV_ALLOWED_NAMES,
  CREDENTIAL_ENV_EXACT_NAMES,
  HOOK_FORBIDDEN_ENV_NAMES,
} from './constants'

export function isCredentialVariable(name: string): boolean {
  const upper = name.toUpperCase()
  return (
    !CREDENTIAL_ENV_ALLOWED_NAMES.has(upper) &&
    // A credential by its meaning, spelled with or without the underscore
    // (`APIKEY`), as a bare key (`SSH_KEY`), a DSN, a cookie or a webhook
    // URL whose path carries its token (RSCH-SECURITY, 2026-11-02). The
    // long words need no separator at all (`APPSECRET`, `AUTHTOKEN`);
    // `KEY` keeps its boundary, so `MONKEY` is still an ordinary name.
    (/(?:^|_)(?:API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY|PRIVATEKEY|SECRET_KEY|SECRETKEY|SECRET|PASSWORD|PASSPHRASE|TOKEN|CREDENTIALS|AUTH|PAT|KEY|DSN|COOKIE|WEBHOOK_URL|WEBHOOK)$/.test(
      upper,
    ) ||
      /(?:SECRET|PASSWORD|PASSPHRASE|TOKEN)$/.test(upper) ||
      /^AZURE_.*(?:KEY|CREDENTIALS|CONNECTION_STRING|CERTIFICATE_PATH)$/.test(upper) ||
      upper.startsWith('TF_TOKEN_') ||
      CREDENTIAL_ENV_EXACT_NAMES.has(upper) ||
      HOOK_FORBIDDEN_ENV_NAMES.has(upper) ||
      CLAUDE_PLAN_ENV_NAMES.has(upper))
  )
}

/** A Claude plan route (D262): never passed to a child, even where a setting or a profile names it. */
export function isClaudePlanVariable(name: string): boolean {
  return CLAUDE_PLAN_ENV_NAMES.has(name.toUpperCase())
}
