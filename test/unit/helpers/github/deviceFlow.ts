// GitHub's OAuth device flow as its documentation describes it
// (docs.github.com, "Authorizing OAuth apps", section "Device flow"). Lane 0
// wrote these from that page's known examples without re-reading it (the
// lane's sandbox refused the fetch); lane A checks them against the page,
// dated, before its parser relies on them. NOT a capture: none is possible
// until the owner registers the project's OAuth App (PLAN.md Q-M123). Lane
// A replaces these with a capture of one sign-in after Q-M123 (AGENTS.md
// rule 14), and the parser keeps any field GitHub adds as it came.
//
// Values are the documentation's examples, with the token values replaced
// by canaries that cannot pass for a real token.

/** `POST https://github.com/login/device/code` with `Accept: application/json`. */
export const DOCUMENTED_DEVICE_CODE = {
  device_code: '3584d83530557fdd1f46af8289938c8ef79f9dc5',
  user_code: 'WDJB-MJHT',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5,
}

/** `POST https://github.com/login/oauth/access_token`, once the user has approved. */
export const DOCUMENTED_ACCESS_TOKEN = {
  access_token: 'canary-device-flow-access-token',
  token_type: 'bearer',
  scope: 'repo',
}

/** The same reply when the app has expiring user tokens on (eight hours; six months to refresh). */
export const DOCUMENTED_EXPIRING_ACCESS_TOKEN = {
  ...DOCUMENTED_ACCESS_TOKEN,
  expires_in: 28_800,
  refresh_token: 'canary-device-flow-refresh-token',
  refresh_token_expires_in: 15_897_600,
}

/**
 * Every error the token endpoint documents for the device flow. `slow_down`
 * also carries the new `interval`, five seconds longer.
 */
export const DEVICE_FLOW_ERRORS = [
  'authorization_pending',
  'slow_down',
  'expired_token',
  'unsupported_grant_type',
  'incorrect_client_credentials',
  'incorrect_device_code',
  'access_denied',
  'device_flow_disabled',
] as const

export type DeviceFlowError = (typeof DEVICE_FLOW_ERRORS)[number]

/** An error reply: `error`, its description and its documentation link. */
export function documentedDeviceFlowError(error: DeviceFlowError, interval?: number) {
  return {
    error,
    error_description: `${error} (fake device-flow server)`,
    error_uri:
      'https://docs.github.com/developers/apps/authorizing-oauth-apps#error-codes-for-the-device-flow',
    ...(interval !== undefined && { interval }),
  }
}
