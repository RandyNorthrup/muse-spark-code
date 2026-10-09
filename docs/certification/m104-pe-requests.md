# M104PE — requests to file owners

1. **A/F — test discovery.** Run the authored Node suite with
   `node --test test/m104/linux/nativeModules.test.mjs` in native CI; it uses
   Node's test runner, not Vitest. Kotlin/Java tests under the same namespace
   are included by the owned Gradle/Tycho builds. Future `.test.ts`/`.test.tsx`
   additions need A's central Vitest and TypeScript discovery. Validation:
   ordinary CI runs these tests without a private test configuration.
   **Observed integration gate:** `npm run deadcode` reports the new Node test
   as an unused file because `knip.jsonc` has no `test/m104/**` entry. Add
   `test/m104/linux/**/*.test.mjs` as a real entry (no ignore/rule weakening).
   Validation: plain `knip` exits zero and the native CI command runs 13 tests.
   F should record this ownership-dependent deferral in PLAN §7 until A lands it.
2. **F/A — moving docs.** Record the native MHP 1.2 adoption in PLAN D84/M104,
   CHANGELOG [Unreleased] and the feature reference as appropriate. The lane
   owns only its named certification and host guides. Keep qualification partial
   until installed-editor F1–F56 receipts exist.
   Include Eclipse's native prompts/clipboard/status/progress and scoped dynamic
   commands after their native checkpoint passes. Suggested native keybindings
   currently refuse explicitly; never describe them as implemented.
   Record the native notice identity correction as well: string and numeric
   identifiers stay distinct, and equivalent integers refer to one lifetime.
3. **Lead — LSP redesign input.** Supply the pending LSP supervision redesign
   and its reviewed lifetime/consent/pin contracts. This checkout contains no
   `src/runtime/lsp` implementation and no local branch named for LSP. The
   parity plan requires a separate review before integration, so no guessed
   broker, server download, credential transfer or silent consent is added.
4. **A/B — LSP/Tab composition.** Once the reviewed service exists, provide
   the owned lazy bundle/export binding and selected-model capability record
   to the portable engine. Validation must cover server pin/consent refusal,
   process-tree teardown, restart isolation, stale buffer versions and Tab's
   per-use consent/shared hard daily ledger. E owns the service and
   `tabServe.ts`, not shared composition/build/price/capability tables.

5. **A/C — native auxiliary assets.** Publish the portable auxiliary surface
   asset descriptors/entries and their validated payload branch mapping for
   `models`, `traffic`, `settings`, `walkthrough`, `diff`, `usage`, and `maker`.
   JetBrains currently has native chat/Tasks/What's New containers; Eclipse's
   rejected `surfaceHtml` proposal remains an unconnected seam. E will consume
   the frozen factory/binding contract without inventing an HTML wire method.
   Validation: actual indices/actions, state replay/reload, all installed tables,
   and stale/disposed replies; no chat page substituted for an auxiliary view.
6. **F/A — native startup implementation record.** Update D84 to record that
   JetBrains retains the portable module graph instead of flattening all dynamic
   chunks into an IIFE. Native startup counts its static closure plus the native
   loader against the existing 950 KiB cap; the loader has a separate 50 KiB cap.
   Existing shared 900/50 KiB and complete-graph gates are unchanged. Native
   asset requests are exact manifest paths; SHA-256/import-offset validation and
   page-lifetime cleanup precede execution. `strict-dynamic` permits the
   nonce-initiated graph while network/navigation/frame restrictions remain.

7. **A/F — owning shim parser/package seam.** Expose the existing
   `parseMhpCall`, correlated `parseMhpResult`, `failureFrameSchema`,
   `MHP_METHODS`, panel validators and `MHP`/`MHP_PANEL` limits in a documented
   installed Node entry for native owning shim parents. These source exports
   already exist, but no installed public entry/package contract exists here.
   Include its exact inventory/hash and frozen 1.2 schema in shim distributions.
   Validation: malformed/uncorrelated/direction-invalid frames fail before an
   editor action; editor initiation reaches the exact runtime cwd; cancellation,
   stalled output and parent-first death remain bounded. A separate unpinned
   Python schema dependency or five guessed validators is not proposed.
   A portable parent plus native service adapters exceeds the common rule's
   approximately 300-line finding limit without this shared seam; resume that
   path after the contract is supplied rather than silently growing an
   unreviewed bridge.
8. **F/A — reference gate prerequisite.** This base has neither
   `npm run check:reference` nor `scripts/gen-reference.mjs`. Supply the
   prescribed catalog/generator/check when moving the shared documentation.
   Validation: the normal reference check reports native bootstrap, prompts
   and the exact remaining editor/version limitations without support promotion.
9. **Lead/owner — containment qualification.** Resolve or explicitly accept
   the remaining process-tree limitations before platform promotion. JetBrains
   retains observed PID/start identities and group/job containment, but sampling
   can miss a child detached and reparented entirely between observations.
   A bootstrap snapshot now precedes publishing initialized state, with a
   deterministic retained-worker test; later unobserved detachment still needs
   the accepted boundary or a reviewed containment design.
   Eclipse and the raw companion shims retain documented parent-first,
   reparenting and Stop-tree gaps. Validation needs exact installed-host tree
   receipts and the accepted boundary, rather than an implied leak exemption.
10. **Lead/rig — exact native test toolchains.** Cache
    `com.jetbrains.intellij.platform:test-framework:261.27258.48` and
    `:262.10968.63`, including their transitive test dependencies. The cache
    contains only `:253.31033.145`; the 2026.1.5 native attempt compiled
    production code but stopped at test dependency resolution in offline mode.
    Supply Neovim 0.12 and Qt Creator 20 receipts as well: installed versions
    0.11.6 and 18.0.2 are below the guides' declared targets. Android Studio,
    Espressif, STM32CubeIDE and MCUXpresso need their named product/version runs.
    Validation: actual native suites/scenarios, rather than API-verifier or
    framework-stub results promoted to installed-product support.
