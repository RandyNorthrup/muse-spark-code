# Wokwi is a cloud choice

Use Wokwi only when the user explicitly chooses it and supplies their own
account token outside chat. Its cloud receives the firmware binary and
streams serial output back. Disclose that transfer before running; local
QEMU/Renode keep the run local. A project's Wokwi configuration does not
itself authorize upload or spending. Licensing/minute limits are the user's
Wokwi plan, separate from the extension's paid feature budget.

WOKWI_CLI_TOKEN is private. Do not print it, request it in chat, commit it,
place it in a command argument or pass it to unrelated children. If the
runtime strips credential variables and cannot provide a trusted token
route, the user runs Wokwi in their own terminal; never weaken that boundary.
The following template has no credential and is not an automatic check:
<!-- recipe:wokwi-run -->

```sh
wokwi-cli --timeout 10000 --expect-text "ALL TESTS PASSED" .
```

The timeout is simulated milliseconds; also use the host's wall-clock
process-tree deadline and byte cap. Assert expected serial text and report
timeout/failure honestly. No token, no run; do not add a paid fallback.

[Wokwi cloud transfer](https://docs.wokwi.com/wokwi-ci/getting-started),
[CLI options](https://docs.wokwi.com/wokwi-ci/cli-usage).
