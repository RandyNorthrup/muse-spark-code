// Captured account facts shared by auth readers; process launch stays in accountHost.
import * as z from 'zod/mini'
import { MUSE_ACCOUNT_STATES } from '../../shared/constants'

// `AccountState` as captured (1.3.0 and 1.4.0): `label` and `avatarUrl` are
// not in the schema, so parsing drops them.
export const accountStateSchema = z.object({
  state: z.string(),
  credentialRequired: z.boolean(),
})

export type AccountState = z.infer<typeof accountStateSchema>

/** Whether a stored credential (a sign-in or a key the CLI saved) is the one in use. */
export function isStoredSignIn(account: AccountState): boolean {
  return (
    account.state === MUSE_ACCOUNT_STATES.accountLogin ||
    account.state === MUSE_ACCOUNT_STATES.apiKey
  )
}

/**
The answer every captured `account/read` after a sign-out gave
(docs/certification/sign-in-detection.md). Nothing else counts as signed
out: `envKey` masks the stored lane, and other answers were never
captured (AGENTS.md rule 13, the review of PR #49).
*/
export function isCapturedSignedOut(account: AccountState): boolean {
  return account.state === MUSE_ACCOUNT_STATES.loggedOut && account.credentialRequired
}
