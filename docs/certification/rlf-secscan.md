# RLF-SECSCAN — the five SAST findings on int/recovery, and the secret-scan history (2026-10-23, linuxlt)

Recovery lane. Base: int/recovery at `d057bf203` (main 0.19.0 plus the
merged lanes). Branch `rec/rlf-secscan`. No source branches to land
(`src/RLF-SECSCAN/*` absent); no merge needed: RLF-M110OS's `66afc84b1`
is cited for its pattern only, and RLF-M100K (`rec/rlf-m100k`) does not
touch `src/host/backend/deviceWorkerDarwin.ts` (verified by diff before
editing), so the devices-area dependency is clear.

## 1. The Darwin worker escaper is single-pass

`src/host/backend/deviceWorkerDarwin.ts` built its launchd-plist XML
escaping from five chained `replaceAll` calls. Semgrep's
`javascript.audit.detect-replaceall-sanitization` fired once per chain
link: 5 findings, all on that chain (scoped scan: 210 rules, 1 file, 5
findings; full-tree baseline showed the same rule on lines 501–506).

The fix follows RLF-M110OS's `66afc84b1` exactly: one regex with a
lookup table, in one pass (`commit 81351138d`):

```ts
const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

/** Escape text for XML content, one pass, so values stay inside their plist string. */
export function escapeXml(value: string): string {
  return value.replaceAll(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char)
}
```

The private `xml()` is renamed to the exported `escapeXml` (matching
the `escapeHtml` convention in `src/core/htmlText.ts`) so a real-code
test can reach it; output bytes are unchanged (`&apos;` kept), and all
three plist call sites are renamed. No CHANGELOG entry: a person
notices nothing, the plist bytes are identical.

Drills (`test/unit/deviceWorkerDarwin.test.ts`, new `darwin worker
plist escaping` case over the real function, no fakes):

- Red: the test before the fix fails with `TypeError: escapeXml is
not a function` (1 failed, 3 passed, 3 darwin-gated skips on Linux).
- Green: after the fix, 4 passed, 3 skipped.
- Fire: dropping the `&` entry fails the test with an AssertionError
  (`&` left raw); restored byte-exact, green again.

## 2. SAST is 0

`SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast` on the finished
tree: exit 0, `Ran 533 rules on 4470 files: 0 findings.` Scoped
re-scan of the fixed file: 210 rules, 0 findings.

## 3. The secret-scan history: 8 hits, all fixtures

`npm run security:secrets` (`gitleaks git --redact --no-banner .`):
exit 1, 8122 commits scanned, ~390.51 MB in 4m40s, `leaks found: 8`,
all `generic-api-key`. Note this clone carries every lane's refs and
`gitleaks git` scans them all: only hit 6–7's commit is an ancestor of
this lane's HEAD; the rest sit on sibling refs (named below). None of
the eight matched values exists anywhere in the current tree
(verified by grep for each value).

- Hits 1–4: `test/fixtures/nodeos-boot/serial-proving.txt:298` and
  `serial-panic.txt:298`, at `a089dcd88` (`rec/rlf-m110os2`) and
  `f675b829c` (`rec/rlf-m110os`), both "M110os OS6". The line is the
  Alpine Linux kernel's public X.509 cert key ID inside a recorded
  QEMU serial boot transcript (`Loaded X.509 cert 'alpinelinux.org:
Alpine Linux kernel key: d76a…'`). A public cert identifier in a
  recorded boot log, no credential. Disposition: entries already
  exist on both M110OS branches (path form with the "Public X.509
  kernel-module-signing key ID" justification) and land at their
  merge — no new entry drafted.
- Hit 5: `docs/certification/m125-f1-linux.json:131` at `878ef7ffa`
  (`rec/rlm125`). The line is a SHA-256 source digest inside the
  record's `sourceSha256` map; the `ModelApiHost.ts` filename is what
  tripped the detector. A digest, no credential. The file is absent
  from the current tree (superseded by `m125-f1a-linux.json`, which
  carries no `ModelApi` digest line).
- Hits 6–7: `test/unit/vault/credentialMigration.test.ts:20` and
  `credentialMigrationStore.test.ts:28` at `1cbebd98c` (on this
  lane's history). Both assign the same short `LLM_`-prefixed
  sequential-hex placeholder beside an explicit not-a-real-key
  test record. Synthetic test data, absent from the current tree
  (the suites were rewritten since).
- Hit 8: `test/unit/voiceProxy.test.ts:252` at `5b0f3290b`
  (`move-snap/MSM56`, a WIP snapshot, "not a product commit"). The
  line asserts a `Sec-WebSocket-Key` header carrying RFC 6455
  section 1.3's documented example key ("the sample nonce") with
  its documented accept, under a comment naming the RFC section.
  A public spec vector, no credential, absent from the current
  tree.

Draft ignore entries for the owner's approval (L17) — drafted here
only, NOT committed:

```text
# SHA-256 source digest in the M125 certification record's sourceSha256 map; the ModelApiHost.ts filename tripped the detector, no credential.
878ef7ffaff3c753a384a650863b0bf11b7e6c58:docs/certification/m125-f1-linux.json:generic-api-key:131
# Synthetic migration-test key placeholder; sequential-hex value beside an explicit not-a-real-key record, absent from the current tree.
1cbebd98c3b089a9451164303f7eb64d31084466:test/unit/vault/credentialMigration.test.ts:generic-api-key:20
# Synthetic migration-test key placeholder; sequential-hex value beside an explicit not-a-real-key record, absent from the current tree.
1cbebd98c3b089a9451164303f7eb64d31084466:test/unit/vault/credentialMigrationStore.test.ts:generic-api-key:28
# RFC 6455 section 1.3's documented example handshake key ("the sample nonce"); a public spec vector in a WIP snapshot, absent from the current tree.
5b0f3290b8c4581b734cbbab6b8f036b344fabfc:test/unit/voiceProxy.test.ts:generic-api-key:252
```

Fingerprint form is deliberate: each pins one historical commit line,
so a future real leak at the same path still fires. With these four
plus M110OS's two landed entries, the gate is green.

## 4. Gate exits on the finished tree (2026-10-23, linuxlt)

- `security:sast`: 0 (533 rules, 4470 files, 0 findings).
- `security:secrets`: 1 — the 8 history-only hits above, all
  triaged; 4 need the owner's ignore approval, 4 ride M110OS's merge.
- `deviceWorkerDarwin.test.ts` + `vitest related`: 0 (4 passed,
  3 darwin-gated skips). Repository's own timeouts throughout.
- `typecheck` (all projects): 0. `eslint --max-warnings 0` and
  `prettier --check` on touched files: 0. `check:l10n`,
  `check:reference`, `check:host-api`, `cycles`: 0.
- `check:catches`: 1, measured pre-existing — output byte-identical
  (73 lines) on pristine base `d057bf203` in a clean worktree; this
  lane adds no catch site.
- `duplication`: 1, measured pre-existing — 6 clones on base, the
  same 6 here, none in this lane's files.
- `deadcode`: 1, measured pre-existing — identical finding sections
  on base; this lane's export is not flagged.
- `build`: 1, pre-existing budgets — the same 8 OVER lines M110OS
  measured byte-identical on base, all in bundles that cannot contain
  the changed module (`escapeXml` appears in zero `dist/*.js` files;
  the module currently ships nowhere). `dist/extension.js` is ok at
  487.1 KiB of a 600 KiB budget.
- `check:plan`: 1, measured pre-existing — base `d057bf203` fails
  identically (3,725,714 bytes vs the 3,565,158 budget); archiving
  is the lead's procedure. `check:roadmap`: 0 after regenerating.
- `security:audit`: 1, measured pre-existing — identical advisories
  and stale `braces` exception on base; this lane touches no
  dependency.

## 5. Records

- This record; the `### RLFSECSCAN` status section in PLAN.md §6;
  the `RLFSECSCAN` roadmap entry (regenerated `ROADMAP.md`).
- PLAN.md size: base `d057bf203` measures 3,725,714 bytes vs the
  3,565,158 budget (over by 160,556 before this lane); this lane's
  section adds 502 bytes (3,726,216 now) and claims no behaviour
  beyond the evidence above.
- `temp/` holds the proof logs (`sast-proof.log`,
  `secrets-proof.log`, `gitleaks-report.json`); gitignored, not
  committed. The base-comparison worktree is removed.
