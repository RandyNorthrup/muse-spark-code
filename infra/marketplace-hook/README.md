# marketplace-hook (Cloudflare Worker)

The Worker behind the README's **downloads** and **GitHub app installs**
badges, and the webhook of the GitHub app's GitHub Marketplace listing. It
runs at <https://muse-marketplace-hook.objectipy.workers.dev> in the owner's
Cloudflare account. It is not part of the extension or the ACP package: no
build, package or tsconfig includes this folder.

## Routes

| Route                       | What it answers                                                                   |
| --------------------------- | --------------------------------------------------------------------------------- |
| `GET /badgen/downloads`     | badgen.net JSON `{subject, status, color}`: total downloads                       |
| `GET /shields/downloads`    | shields.io endpoint JSON `{schemaVersion, label, message, color}`: the same total |
| `GET /badgen/app-installs`  | badgen.net JSON: current GitHub app installs                                      |
| `GET /shields/app-installs` | shields.io endpoint JSON: the same count                                          |
| `POST /`                    | GitHub Marketplace webhook                                                        |

- **Total downloads** adds the VS Code Marketplace `downloadCount`, Open VSX
  downloads, npm downloads of `muse-spark-code-acp`, GitHub Release asset
  downloads and current GitHub app installs. The total is cached in KV for an
  hour, so the public APIs are called at most hourly. If any source fails, the
  last good total is served (never a smaller number); with none yet, `n/a`.
- **GitHub app installs** is every verified `marketplace_purchase`
  `purchased` event minus every verified `cancelled` event, never below 0.
- **Webhook**: only requests signed with the shared secret are accepted
  (`X-Hub-Signature-256`, HMAC-SHA256 over the raw body, constant-time
  compare); bodies over 64 KiB are refused.

## Privacy

Counters only. The Worker stores three KV values (`app_installs`,
`app_cancellations`, `total_downloads`). Nothing else from a webhook event,
such as account names or plans, is stored or logged, and observability
(Workers logs) is off in `wrangler.toml`.

## Deploy

From this folder, signed in to the owner's Cloudflare account:

```sh
# Once: create the KV namespace and put its id into wrangler.toml ([[kv_namespaces]] STATS).
npx --yes wrangler@4.146.0 kv namespace create STATS
# Once, and whenever the Marketplace hook's secret changes: the same value as the
# GitHub Marketplace listing's webhook secret (at least 32 characters).
npx --yes wrangler@4.146.0 secret put GITHUB_WEBHOOK_SECRET
npx --yes wrangler@4.146.0 deploy
```

The KV namespace id in `wrangler.toml` is not a secret. The webhook secret
lives only in Cloudflare and the GitHub listing, never in this repository.

The counter routes are unit-tested against a fake KV
(`test/unit/marketplaceHook.test.mjs`); the webhook needs the Workers runtime
and is not.
