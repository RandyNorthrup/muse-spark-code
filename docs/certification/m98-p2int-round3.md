# M98 phase-2 integration, round 3 — H/GH (macmini, 2026-10-05)

Starting tree `ef67306f`, branch `m98/p2int`. Read the rig brief,
`codex/common.md`, AGENTS, PLAN D77/M98 and the round-1/round-2/H/GH
certifications. The explicit brief overrides common's old main merge and
aggregate quality instructions. No push, rebase, stash, credential read,
network request, dependency install or live/paid/local model attempt: **0
attempts, $0**.

## Required merges

- `b2a165d1`: `--no-ff` merge of H `4fb42e0e`. No conflicts; all thirteen
  owning files pass **236 tests** on macmini.
- `1e53e27f`: `--no-ff` merge of GH `c98a0d14`, including its required
  M91 hook-contract/runtime ancestry. Its four owning files pass **86
  tests** on macmini. Forty-two conflicts are resolved by meaning: retain
  judge and M91 package/build/cycle inventories; union every translation
  key, including nested palette entries; retain M91's revised translated
  hook terminology; retain both PLAN histories and remove duplicate moved
  D70/D71/D79/M92 sections. Preserve the integration tree's existing caps,
  including English at 125 KiB. Generated host API and notices are rebuilt
  by script. The paid-host formatter conflict is repaired to use the
  localized USD helper consistently.

Both merges run the repository's lint-staged/Prettier and staged Gitleaks
checks through a worktree-local hook with only `--no-stash` added, retaining
all checks and changing no repository/user/machine hook setting. No leaks.

## Integration prerequisites

The inherited English fallback exceeds 125 KiB after M91's required
strings join. Lossless Brotli encoding applies only to the generated
production Node table, with exact decoded equality checked against EN.
Browser, development, source and translated tables keep their full form.
The original cap is unchanged.

The shared Node parser exports synchronous JSON Schema conversion through
a lazy sibling bundle, leaving both browser typing and the parser's 50 KiB
cap intact. MCP converts the canonical request schema when its tool is
constructed, replacing the static copy and retaining the existing parity
test. The converter's separate measured cap is 50 KiB; all inventories,
notices, SBOM, knip, cycles, globals and split checks include it.

Four source controls reject deliberate faults and restore saved bytes with
matching SHA-256: corrupt the decoded English table, load conversion eagerly,
accept a malformed writer, and remove the shared conversion export. Their
whole owning checks rerun green. The first export-control candidate survived
because G2's static schema made the export unused; that candidate is not
counted. Using canonical conversion makes the named missing-export build
guard fire. Recipes and hashes are in the adjacent round-3 drill JSON.

The final factory, package, gate and byte-preservation receipts follow in
this record when the integration's remaining work is complete.
