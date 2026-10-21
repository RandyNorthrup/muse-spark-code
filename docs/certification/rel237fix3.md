# Certification — REL237FIX3: the Muse Voice proxy refusal says its real cause

Lane `REL237FIX3`, rig `macbook`, branch `release/0.19.0-6` from
`c91e83bca9` (release/0.19.0, PR #237). Release blocker, tonight's
release: real use of the release candidate in a real VS Code 1.142.0
found that with `http.proxy` set and `http.proxySupport` off (or
`http.webSocketAdditionalSupport` off), Muse Voice is refused with the
old-version text — untrue on 1.142.0, and it never names the setting
that is the cause.

## Sites (all three named in the brief, confirmed by reading)

1. `src/core/voice/voiceNetwork.ts:48` — the settings case
   (`proxySupport === 'off'` or `!isWebSocketSupportOn` on a
   marker-`routed` socket) returns the same `'proxy'` refusal as the
   genuinely unrouted (pre-1.112) case.
2. `src/host/voice/dictationHost.ts:106` — one message
   (`UI_TEXT.museVoiceNoProxy`) for both refusals.
3. `src/shared/l10n/en.ts:4817-4820` — the version-only text and its
   stale comment ("a proxy is set, but this editor does not route the
   voice connection through it (before VS Code 1.112)").

## New texts (English source; every display language follows in key order)

Kept, now only for VS Code before 1.112 (`museVoiceNoProxy`,
unchanged):

> Muse Voice cannot use the configured proxy on this version of VS
> Code; behind a proxy it needs VS Code 1.112 or later.

New, for the settings case (`proxySupport` off):

> `museVoiceProxySupportOff`: Muse Voice cannot use the configured
> proxy while the http.proxySupport setting is "off". Set
> http.proxySupport to "on" so the voice connection goes through the
> proxy.

New, for the settings case (`webSocketAdditionalSupport` off):

> `museVoiceProxyWebSocketOff`: Muse Voice cannot use the configured
> proxy while the http.webSocketAdditionalSupport setting is off. Turn
> http.webSocketAdditionalSupport on so the voice connection goes
> through the proxy.

## Fix shape

- `VoiceNetworkRefusal` gains `'proxySupportOff'` and
  `'proxyWebSocketOff'`: the settings case returns its own refusal
  (`proxySupport` off wins when both are off); `'proxy'` stays only
  for the unrouted socket (pre-1.112 editors).
- `createMuseVoiceSetup` maps each refusal to its own `UI_TEXT`
  string; the en.ts comment is updated to say the old text is the
  before-1.112 case.
- `test/unit/voiceNetwork.test.ts` drives the real
  `voiceNetworkRefusal` with real settings values for both refusals
  (no stand-ins); `readVoiceNetworkPosture` cover stays as is.
- New keys land in `src/shared/l10n/en.ts` and all 14 `l10n/ui.*.json`
  in English key order (`npm run check:l10n` clean), plus a
  CHANGELOG `[0.19.0]` line.

## Proof (this rig, `macbook`)

- Fix: `073a84ca3` (record: `6f45ee696`). 19 files, +127/−17.
- `test/unit/voiceNetwork.test.ts`: 9 passed — both new refusals
  driven from the real `voiceNetworkRefusal` with real settings
  values, end to end through the real `readVoiceNetworkPosture`
  (no stand-ins), repo's own timeout, no `--testTimeout`.
- `test/unit/modelsActivationBudget.test.ts`: passed, activation
  growth 2185 bytes (≤ 3 KiB).
- Full static chain exit 0: `typecheck` (all 5 projects),
  `check:badges`, `check:tokens`, `check:l10n` (0 problems),
  `check:reference`, `check:host-api`, `check:plan`,
  `check:roadmap`, `deadcode`, `cycles`, `duplication`, `build`
  (with budgets), `security:audit` (2 advisories, 1 exception —
  the checked-in exception list).
- `prettier --check` on all changed files: clean. `eslint
--max-warnings=0` on all changed src and test files: clean —
  including the hook-caught `unicorn/no-nested-ternary` and
  `unicorn/switch-case-braces`, fixed as a `switch` with braces
  (the sentence lookup stays inside the setup call, never at
  module load, so the installed language is the one shown).
- Packaging: `museVoiceProxySupportOff` and
  `museVoiceProxyWebSocketOff` are present in the built
  `dist/extension.js`.
- NOT RUN here: VS Code GUI real-use (this rig is the owner's
  MacBook — no screen/microphone runs) and hosted CI. The lead
  runs the release candidate behind a proxy on 1.142.0: with
  `http.proxy` set and `http.proxySupport` off the microphone
  shows the proxySupport sentence; with `webSocketAdditionalSupport`
  off it shows the webSocket sentence; on a pre-1.112 build it
  still shows the version sentence.
