# Muse Code headless `serve` no longer blocks on the Keychain

Status: **fixed upstream**. Nothing to file.

The recorded failure was Muse Code 1.4.11: `muse serve` in a session with no
screen (SSH, or launchd `Background`) blocked in `SecItemAdd` waiting for a
Keychain dialog. The ask was to fail with `interaction_not_allowed`, or to
grow a non-interactive flag.

On 1.4.14 that hang does not reproduce. `initialize` returns in well under a
second, stderr stays empty, and the throwaway home gains no Keychain item.
The published 1.4.12 note is narrower than this run: it says Muse Code stops
waiting after 5 seconds and says the login is still saved
(<https://dev.meta.ai/docs/muse-code/changelog>). This run finished before
that timeout and printed no such sentence.

`muse serve --help` still has no non-interactive flag. The stripped 1.4.14
binary still contains the text `interaction_not_allowed`. Neither fact is a
hang. A request for an explicit flag would be a new feature, and this
measurement does not show a bug to attach it to.

## Version and OS

- Muse Code 1.4.14 (1.4.14-R7309.1), `muse --version` on 2026-11-02.
- User-agent on `initialize`: `muse-build/1.4.14 (serve; macos-x86_64; build dec7d7497fecdad135ec5835a8161dbc92e55b58)`.
- macOS 15.7.4 (24G517). `uname -mprs` prints `Darwin 24.6.0 x86_64 i386`.
- SSH session. `launchctl managername` prints `Background`.

## Steps

Use a throwaway `HOME` so the login Keychain is never the target. Point
`XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, and `XDG_STATE_HOME`
inside that home. Export `MUSE_NO_AUTO_UPDATE=1`.

Write `~/.config/muse/auth.json` (this path is under `HOME`, not under
`XDG_CONFIG_HOME`) with a short non-secret placeholder:

```json
{
  "schema_version": 1,
  "providers": {
    "meta": { "api_key": "placeholder-key" }
  }
}
```

Repeat with a browser-shaped file (same `schema_version`, `providers.meta`
holding `access_token`, `api_key`, `api_base_url`, `mechanism` `oauth`,
`obtained_via` `device_code`, `subs_active` true, and placeholder profile
strings). Use placeholders only.

Start `muse serve --no-session-log --disable-shell` once with `--provider echo`
and once with no `--provider`. On stdin send one line:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "clientInfo": { "name": "repro", "version": "0" },
    "capabilities": { "requestedCapabilities": [] }
  }
}
```

Then check the throwaway home:

```sh
security find-generic-password -s ai.meta.dev.credentials -a meta
```

Exit 44 means the item is absent. Also confirm `~/Library/Keychains` was not
created under the throwaway home.

## Expected

A headless `serve` either answers the handshake or fails immediately with a
stated Keychain error such as `interaction_not_allowed`. It does not wait
forever on a dialog that cannot appear.

## Actual

Every handshake returned an `initialize` result. `serverInfo.version` was
`1.4.14`. stderr was empty. The process was still alive when the result
arrived. The throwaway `find-generic-password` stayed exit 44, and
`Library/Keychains` stayed absent.

| Auth file                    | Provider flag             | Time to `initialize` |
| ---------------------------- | ------------------------- | -------------------- |
| inline `api_key` placeholder | `--provider echo`         | 1317 ms              |
| none                         | `--provider echo`         | 809 ms               |
| inline `api_key` placeholder | default (no `--provider`) | 707 ms               |
| browser-shaped placeholder   | default (no `--provider`) | 509 ms               |
| browser-shaped placeholder   | `--provider echo`         | 400 ms               |

The login Keychain's `ai.meta.dev.credentials` / `meta` item was absent before
and after (find exit 44), and that keychain file's modification time did not
change. No model request was made.

## Duplicate search

Checked 2026-11-02.

- [muse-code-sdk#105](https://github.com/meta-models/muse-code-sdk/issues/105)
  is open and is a different trigger. It reports Muse Code 1.4.7 on a
  signed-in Mac, with startup stacks in `SecItemCopyMatching` and
  `SecItemAdd` and `OSStatus -67701` on an existing item. This run used an
  empty throwaway home, saw no hang, and did not retest #105. Leave #105
  without a comment from this evidence.
- [muse-code-sdk#53](https://github.com/meta-models/muse-code-sdk/issues/53)
  is still open. It is a Windows credential write that fails before any OS
  call (`keychain write failed (internal error -2147483648)` on 1.4.0). A
  maintainer reply says that write path was fixed in 1.4.1. It is not a
  headless wait, so this measurement does not belong on #53. #38 tracks the
  same write bug.

The README Support section says this tracker takes bugs in the SDK, the
protocol declarations, and the documentation
(<https://github.com/meta-models/muse-code-sdk>). The host binary is not in
that repository. CLI reports have still been accepted there (`blank_issues_enabled`,
area "Something else / not sure"). There is nothing left to file for this hang.

## Template fields

Filled only so the measurement is complete. Do not submit them.

- Where is the problem? Something else / not sure
- What happened, and what did you expect instead? On 1.4.11, headless
  `muse serve` could wait forever on a Keychain dialog. On 1.4.14
  (1.4.14-R7309.1), with a throwaway `HOME` and a placeholder
  `~/.config/muse/auth.json`, `initialize` returns in 0.4–1.3 s with empty
  stderr and no Keychain item. Expected: no infinite wait. Actual: no wait.
- Version and environment: Muse Code 1.4.14 (1.4.14-R7309.1). macOS 15.7.4
  (24G517), Darwin 24.6.0 x86_64. SSH, launchd manager `Background`. Node was
  not involved; this is the native binary. Changelog:
  <https://dev.meta.ai/docs/muse-code/changelog> (1.4.12 Keychain timeout).
