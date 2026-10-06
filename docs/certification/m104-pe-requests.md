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
