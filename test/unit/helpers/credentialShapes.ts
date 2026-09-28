// The Muse Code CLI's credential file (`auth.json`) in the shapes it was
// captured writing (AGENTS.md rule 13; docs/certification/sign-in-detection.md).
// Every value that was a secret or personal is a placeholder: the extension
// reads the structure only, so the tests need nothing more.

/** What `muse logout` and `account/logout` leave (1.3.0, 1.4.0-R4302.1; 44 bytes). */
export const LOGOUT_SHELL = '{\n  "schema_version": 1,\n  "providers": {}\n}'

/**
 * A key saved with `muse auth set` (1.4.0-R4161.1 and R4302.1, Windows and
 * Linux, `scratchpad/m140cred/probe-authset-*.json`): schema 1, `meta`
 * holding `api_key` alone.
 */
export const AUTH_SET_FILE = JSON.stringify({
  schema_version: 1,
  providers: { meta: { api_key: '<placeholder>' } },
})

/**
 * Synthetic: the bundled Slack connector's own entry (1.4.0-R4302.1's
 * `slack_connector.py` reads `providers.slack_connector.bot_token`), with
 * no Muse sign-in beside it.
 */
export const SLACK_CONNECTOR_ONLY = JSON.stringify({
  schema_version: 1,
  providers: { slack_connector: { bot_token: '<placeholder>' } },
})

/**
 * What the structural read makes of the captured inline shapes
 * (`AUTH_SET_FILE`, `DEVICE_LOGIN_FILE`) on `platform`: held in the file on
 * Windows and Linux, where they were captured; on macOS, where no such file
 * was captured, left to the CLI (the review of PR #49). Tests that read a
 * real file on the host OS expect this, and `credentialFile.test.ts` pins it
 * for every OS, so a macOS-only expectation is caught on any runner.
 */
export function capturedInlineVerdict(platform: NodeJS.Platform): 'inline' | 'unrecognized' {
  return platform === 'darwin' ? 'unrecognized' : 'inline'
}

/** The OSes the extension ships for, each with its own reading of the file. */
export const SHIPPED_PLATFORMS = ['win32', 'linux', 'darwin'] as const

/**
 * A browser (device-code) sign-in as the granted capture left it (1.4.0-R4302.1,
 * Windows, 2026-09-27; 1062 bytes): schema 1, `meta` with these keys in this
 * order; `obtained_via` and `mechanism` are the captured values.
 */
export const DEVICE_LOGIN_FILE = JSON.stringify({
  schema_version: 1,
  providers: {
    meta: {
      access_token: '<placeholder>',
      obtained_via: 'device_code',
      mechanism: 'oauth',
      api_key: '<placeholder>',
      api_base_url: '<placeholder>',
      user_full_name: '<placeholder>',
      user_email: '<placeholder>',
      user_avatar_url: '<placeholder>',
    },
  },
})
