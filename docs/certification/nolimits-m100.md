# Lane RLM100 — D121 triage of the M100 device limits (D121)

Branch `rec/rlm100`, base main at 0.19.0 (`0cab9f323`), M100 first slice
merged from `src/RLM100/01-ms-msm100`. The owner's D121 order: no cap,
ceiling, floor, timeout, retry count or default of ours on a person's
value or on the product's own work; only a provider's documented limit
or a value the person set may stop anything. Twenty-six `DEVICE_LIMITS`
members from the source branch are removed, not carried. What stays is
either a protocol shape (never a limit), a D80-mandated wire bound
(outcome 4, listed below), or a person-set offer field whose ceiling of
ours is gone (outcome 3).

## Removed (D121 outcome 1: not about a model)

Each constant, its checks and its refusal text go; nothing moves to
general Settings. No removal leaves a silent hang: every removed check
either admitted more work or its refusal named a number of ours.

| Constant (old value)                              | What refused                                                                                           | Now                                                                      | Proof                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `pairedDevices` (16)                              | 17th pair, 17th pending setup, 17th listener, 17th discovery hint (dropped silently), 17th channel job | pairs, listeners, hints and jobs unbounded                               | `devicePairing`/`deviceTransport`/`deviceDiscovery`/`deviceChannel` checks deleted; panel accepts 20 rows |
| `repositories` (32)                               | 33rd repo grant, 33rd offer batch                                                                      | unbounded                                                                | store + frame schemas; panel/frame tests accept 40                                                        |
| `entries` (32)                                    | 33rd offer entry; hostnames with 33+ DNS answers                                                       | unbounded                                                                | offer schema + `deviceAddress`; test accepts 40 entries                                                   |
| `checks` (32)                                     | 33rd check id                                                                                          | unbounded                                                                | offer schema; test accepts 40                                                                             |
| `ownersPerDevice` (4), `grantsPerOwner` (16)      | 5th owner, 17th grant; 17th concurrent presence attestation refused as unverified                      | unbounded; `canAddOwner`/`canAddGrant` deleted (no production callers)   | panel schemas accept any count                                                                            |
| `writePaths` (256)                                | 257th planned write                                                                                    | unbounded                                                                | dispatch schema; test accepts 300                                                                         |
| `pathChars` (512)                                 | paths past 512 chars (dispatch, manifest, worker station/desktop)                                      | shape only, any length                                                   | schemas keep the refinements; tests accept 600-char paths                                                 |
| `labelChars` (80)                                 | pair labels, OS versions, tool names, task titles past 80 chars                                        | non-empty only                                                           | schemas; panel accepts 100-char labels                                                                    |
| `modelIdChars` (128)                              | provider/model ids past 128 chars                                                                      | shape only, any length                                                   | regexes kept; test accepts 201-char names                                                                 |
| `taskBriefChars`, `guidanceChars` (8192)          | briefs/guidance past 8192 chars                                                                        | non-empty only                                                           | dispatch schema; tests accept 9000 chars                                                                  |
| `reportChars` (16384)                             | result reports and log frames past 16384 chars                                                         | unbounded (frames bound reassembly)                                      | channel + report schemas; frame test accepts 20000 chars                                                  |
| `capabilityTools` (64), `capabilityEngines` (16)  | peers advertising more tools/engines                                                                   | unbounded inside the kept 8192-byte advertisement cap                    | capability schema; tests accept 70 tools                                                                  |
| `artifactObjects` (16384), `artifactFiles` (4096) | manifests past the counts (a monorepo breaks 4096 files)                                               | unbounded inside the kept byte caps                                      | manifest schemas; tests build 5000-item manifests                                                         |
| `terminalRecords` (4096)                          | journals with more terminal records refused to load or admit                                           | load and admit any                                                       | journal schema, validate, admit                                                                           |
| `tombstones` (65536)                              | 65537th revocation/cancellation/receipt refused; receiver failed or paused                             | revocation memory unbounded (all locally generated; no remote inflation) | store, journal, result channel, receiver                                                                  |
| `unresolvedAttempts` (128)                        | 129th live attempt, reconnect lease, worker slot, work directory                                       | uncertainty tracked without bound                                        | journal, reconnect, all three worker drivers, panel display                                               |
| `journalBytes` (16 MiB)                           | own store/journal files and result records past 16 MiB refused to read or write                        | read and write at any size                                               | store, journal, result channel                                                                            |

## Person-set, ceilings removed (D121 outcome 3)

D80.4: the offering device's user chooses worker and process caps,
heavy-check slots and token and spend caps. The offer fields stay; our
ceilings go, so the person's numbers stop over-quota use with no maximum
of ours. The form still refuses below 1 (input validation, the A7
precedent); the schema still refuses negative, fractional and
non-finite values; `slotCap` (measured headroom) is unbounded; the
offer-vs-advertisement and grant-intersection checks compare person-set
values only and stay.

| Constant (old ceiling)                                                                     | Change                                                                                                                                               |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workers` (32), `processes` (128), `heavyChecks` (8), `tokens` (1000000), `spendUsd` (500) | offer, usage-tally and slot schemas unbounded; worker host drops the `> processes` ceiling (keeps safe-integer and below-1); offer inputs drop `max` |
| `artifactBytes` as an offer field (67108864)                                               | offer field unbounded; the wire parse bound below stays                                                                                              |

## Kept bounds, listed for the lead (D121 outcome 4)

D80.3 requires time, byte, connection and queue caps before parsing, and
D80.1 requires bounded invitation validity. These bound untrusted peer
bytes and hung peers, never the person's values; every refusal is typed,
said and reconciled, and the journal keeps uncertain work so no deadline
loses anything.

- Frame and message bytes: `frameBytes`, `frameFragments`,
  `channelFrameBytes`, `artifactChunkBytes`, `artifactChunkBase64Chars`,
  `expandedArtifactBytes`, `capabilityBytes`, `grantBytes`,
  `resultEnvelopeBytes`, `invitationTextChars`, `certificateBase64Chars`,
  `signatureBase64Chars`, and `artifactBytes` as the wire parse bound
  (manifest, bundle, result and offset integers).
- Connections, queues and pacing: `connectionsPerPair`,
  `connectionsTotal`, `queuedFrames`, `controlFrames`, `channelStreams`,
  `pendingHandshakes`, `pendingResultAcks`, `reconciliationPage`
  (a paging contract with `nextCursor`, not a limit).
- Time: `frameDeadlineMs`, `handshakeDeadlineMs`, `idleConnectionMs`,
  `uiRequestTimeoutMs`, `handshakeBackoffBaseMs`/`handshakeBackoffMaxMs`
  (G50-mandated pacing, never a refusal).
- Security stops and lifetimes: `authFailuresBeforeAsk` (G52: one
  failed authentication stops and asks), `invitationValidityMs`,
  `certificateLifetimeMs`, `grantValidityMs`, `stepUpValidityMs`.
- `terminalRetentionMs`: terminal compaction keeps the reviewed 30-day
  retention until it is wired to the person's cleanup setting;
  `compact` has no production caller yet.

Not limits (protocol shapes, kept without review): `protocolVersion`,
`devicesDefault`/`discoveryDefault` (D80: off by default), `idChars`,
`digestChars`, `addressChars`, `ipv4Octets`, `ipv4OctetMax`,
`ipv6Groups`, `portMax`, `fingerprintGroupChars`, `base64GroupChars`,
`base64GroupBytes`, `qrQuietZoneModules`, `observationMaxMs`,
`clockSkewMs`, `handshakeBackoffJitter`.

## Lead follow-ups from this triage

- The offer's `artifactBytes` is person-set and unbounded, but no
  production code enforces `min(offer, wire bound)` when receiving;
  the 67108864-byte wire bound governs alone. Wire the receiver-side
  enforcement or confirm the wire bound suffices.
- `terminalRetentionMs` should follow the person's `cleanupPeriodDays`
  when `compact` gains its first production caller.

## Suites (repository's own timeout, `--maxWorkers=3`)

- `devices` + `devicesPanel` + `deviceCapability`: 122 passed.
- `deviceInputManifest` + `devicePhase2Contracts` +
  `deviceWorkerHostNative`: 146 passed, 21 platform-skipped.
- `deviceBundle` + `deviceEpochs` + `deviceGrants`: 47 passed.
- `deviceMessageHandler` + `devicePanel` + `deviceQrEncoder`:
  23 passed.
- `deviceQrInvite` + `deviceTlsDesign` + `devicesPhase2Scenes`:
  16 passed.
- `tsc` host, webview and unit projects: clean.
