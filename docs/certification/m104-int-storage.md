# M104INT — storage cleanup regression

Mac mini, 2026-10-06; fake local records only, zero model/paid calls.

The composed controller needs to drain admitted atomic settings/storage
writes on release. `Promise.all` returned after the first failed publication,
while an unrelated write still held its rename. `settled()` now waits for all
admitted publications before reporting their failures as an AggregateError.

The new `runtimeSettingsStore` regression holds one publication and fails
another. Before the fix it fails exactly the premature-drain assertion
(1 failed, 7 passed; `temp/m104-int/resume-storage-red.log`). The restored
store, real ACP composition and runtime feature-port suites pass all **12 tests**
(`temp/m104-int/resume-storage-final.log`). Removing the drain fix again
fails the same assertion; source is restored byte-exact (SHA-256 recorded in
`temp/m104-int/drill-storage-drain.json`). The first fixture used publication
arrival order and raced; the final fixture identifies the held/failed keys
explicitly. That failed attempt is retained, not counted as a pass.

The rig brief substitutes scoped sequential checks for aggregate quality.
No threshold, hook, rule, credential policy or size cap changes.
