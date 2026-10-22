# xAI Grok subscription sign-in (OAuth): research

Research date 2026-10-22, lane RLGROKAUTH (rig `linuxlt`). Question: how
Muse Spark Code signs a person in with their xAI account (SuperGrok or X
Premium) so Grok models run on that subscription, no API key — like the
product's Continue With ChatGPT. Sources below; every value read on
2026-10-22.

## 1. Sources

| Key     | URL / capture                                                                                                                                                                                           | Read       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| DISCO   | `https://auth.x.ai/.well-known/openid-configuration` (fixture `test/fixtures/grok/discovery.json`, captured with `curl -sm 20 https://auth.x.ai/.well-known/openid-configuration`; pretty-printed only) | 2026-10-22 |
| JWKS    | `https://auth.x.ai/.well-known/jwks.json` (read for shape and `alg` only; keys rotate, values not recorded)                                                                                             | 2026-10-22 |
| XNEWS   | `https://x.ai/news/grok-opencode` (OpenCode `/connect` offers browser OAuth and headless code+URL)                                                                                                      | 2026-10-22 |
| HERMES  | `https://hermes-agent.nousresearch.com/docs/guides/xai-grok-oauth` (third-party agent's device-code flow, Responses transport)                                                                          | 2026-10-22 |
| WARP    | `https://docs.warp.dev/agents/inference/grok-subscription/` (third-party agent's browser OAuth, on-device tokens, background refresh)                                                                   | 2026-10-22 |
| GROKCLI | `~/.grok/auth.json` on this rig: the directory exists and is empty; no file to read, so nothing was read (key names or values)                                                                          | 2026-10-22 |

## 2. What xAI publishes (DISCO)

- Issuer `https://auth.x.ai`. Endpoints: authorize
  `https://auth.x.ai/oauth2/authorize`, device authorization
  `https://auth.x.ai/oauth2/device/code`, token
  `https://auth.x.ai/oauth2/token`, userinfo
  `https://auth.x.ai/oauth2/userinfo`, revoke
  `https://auth.x.ai/oauth2/revoke`, JWKS
  `https://auth.x.ai/.well-known/jwks.json`.
- Grants: `authorization_code`, `refresh_token`,
  `urn:ietf:params:oauth:grant-type:device_code`. Response types: `code`.
  PKCE: `S256`. Token endpoint auth: `client_secret_basic`,
  `client_secret_post`, `none` — a public client (no secret) is a
  published option.
- ID tokens: `ES256` only (JWKS confirms EC P-256 `sig` keys). Claims
  include `sub`, `iss`, `aud`, `exp`, `iat`.
- `scopes_supported` includes `openid`, `profile`, `email`,
  `offline_access` plus xAI-specific scopes. The xAI-specific names
  belong to other applications (for example `grok-cli:access`); this app
  requests only the OpenID base set until xAI issues its own scope, and
  never sends another application's scope or client id.
- No `registration_endpoint`: xAI publishes no self-serve client
  registration. There is no documented page for registering a
  third-party OAuth client, so this app's client id, redirect URIs,
  scopes and device-grant enablement must come from xAI out of band.

## 3. What the flows look like (XNEWS, HERMES, WARP)

- Two sign-in methods, both on the person's subscription: a browser
  OAuth flow, and a headless variant that prints a code and URL for SSH
  or remote hosts (XNEWS).
- The device flow is standard RFC 8628: request a device code, show the
  verification URL and user code, poll until approval, save the tokens
  locally, refresh in the background (HERMES). The device-code reply
  carries `expires_in` (tens of minutes).
- Browser consent opens xAI's consent screen; tokens stay only on the
  device (OS keychain or equivalent), refreshed automatically
  (WARP). Usage draws from the subscription's own pool (WARP: "the same
  weekly pool as Grok Build").
- Inference rides the xAI Responses API at `https://api.x.ai/v1` with
  the OAuth bearer token (HERMES; the product's `xai` API-key preset
  already sends the Responses wire shape to that origin).
- Caution (HERMES, third-party anecdote, not xAI documentation): xAI's
  backend has been seen to answer inference with HTTP 403 for some
  subscribers. The product surfaces such refusals as the HTTP status
  plus xAI's own code; it invents no 403 semantics of its own.

## 4. Product consequences

- Build the route against DISCO with this app's own client id read from
  configuration (a setting in VS Code, a flag on the CLI). With none
  set, every Grok action refuses with one plain sentence: Muse Spark
  Code's xAI sign-in awaits xAI's registration — no request goes out.
- Browser flow: PKCE S256, loopback redirect on 127.0.0.1 with a random
  port (RFC 8252); xAI must allow loopback redirects for the issued
  client. Device flow: RFC 8628 against the discovery endpoints; xAI
  must enable the device grant for the issued client.
- The verification URI and user code come from xAI's device reply and
  are validated (https, safe to show), never guessed; the exact
  verification host is pinned from the first live sign-in (owner
  present), the way wire shapes are captured.
- Exactly what xAI must issue before the first live sign-in: (1) the
  OAuth client id for Muse Spark Code (Unofficial); (2) the redirect
  URIs it allows (loopback `http://127.0.0.1:<port>/auth/callback` must
  be among them); (3) the scope to request for subscription model
  access; (4) the device grant enabled for the client.
