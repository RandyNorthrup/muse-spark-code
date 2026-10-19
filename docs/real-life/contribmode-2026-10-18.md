# Contributor mode real use (2026-10-18, lane `fix/muse-contributor-mode`)

Product change: the Muse Code backend honours the person's own
`contributor_mode_enabled` — `serve` starts with `--contributor-mode on`,
and the catalogue carries each served model's `-contributor` counterpart by
name. Nothing defaults it on.

## What Muse Code exposes (CLI 1.4.10, SDK 1.4.10, read from the install)

- `muse --help`, `muse serve --help`, `muse exec --help` all document
  `--contributor-mode <on|off>` as a per-run/per-process override that is
  never persisted. The persistent switch is top-level
  `contributor_mode_enabled` in `$XDG_CONFIG_HOME/muse/settings.json`
  (this machine: `true` beside `schema_version: 1`).
- `model/list` over MSP serves the same four ids with and without the flag
  (`muse-wonder-1.0`, `muse-wonder-full-1.0`, `muse-spark-1.3`,
  `muse-spark-1.2`); no contributor row is ever served.
- `session/start` accepts `<base>-contributor` by name for every listed
  base (all four probed, no model call); a contributor session flags no
  `model/list` row active, scoped or unscoped.
- The CLI's own bundled `code-review` agent names
  `muse-wonder-full-1.0-contributor`.

## Proof through the packed product (`dist/`, this machine, 2026-10-18)

Empty workspaces under the lane temp dir; untrusted throughout.

- `exec --model muse-spark-1.3-contributor` without the product flag is
  refused before any turn with the product's own words (`This model is not
available for this run.`, 0 calls). With `--allow-contributor-models` it
  answered `EXEC-CONTRIB-OK` (record
  `01a1507a-eba4-7c32-9ed1-a9d85eb4d216`: session starts on the CLI
  default, `model_reconfigure` switches to the contributor id, the one
  provider `model` event names it).
- ACP (`node dist/acp.js --allow-contributor-models` over stdio): the
  `model` option lists `muse-spark-1.3-contributor`,
  `session/set_config_option` accepts it, turn 1 answered `ACP-CONTRIB-ONE`,
  turn 2 created `hello-contrib.txt` byte-exact (`BYTE-EXACT-42`, 11
  bytes). Record `01a1507c-e111-…`: all 6 provider `model` lines name it.
- Panel (VS Code 1.139 under Xvfb, isolated dirs, CDP text reads): the
  models overlay listed `muse-spark-1.3-contributor`; selecting it raised
  the existing native contributor confirm, confirmed by OS keypress; the
  pill read `muse-spark-1.3-contributor High`; a sent turn answered
  `PANEL-CONTRIB-OK`. Record `01a15089-…`: both provider `model` lines
  name it (startup/config lines show the `muse-spark-1.3` → contributor
  reconfigure path).

Model calls: 7 total, every one on `muse-spark-1.3-contributor` by name
(2 CLI-direct diagnosis turns, 1 exec, 3 ACP — one first-attempt turn plus
the rerun pair, 1 panel). Subscription backend; the exec ledger settled
$0.00. Cap: 20 calls / $1.00.

## Gates on the final tree

format, eslint (changed files, zero), typecheck (all five projects),
check:l10n (0 problems), check:reference, check:host-api (0 problems),
knip (0), cycles (none), duplication (0 clones), touched suites 33/33 with
the repo's own timeout. New-test break-on-purpose fired (1 + 2 failures)
and was reverted. Pre-existing reds, measured, not caused here:
check:plan (PLAN.md already over 85% of the reader bound at HEAD),
`npm run build` (What's New bound already over at 148,580 > 76,800 bytes;
after a local-only trim, two reporting bundles the production pool never
builds — `reportInputs.js`, `playbookSchedulesInputs.js` — miss their
budgets). The proof ran on `dist/` built with that local-only trim, which
was restored byte-exact afterwards (only the `[0.19.0]` entry differs).
`/var/tmp/l-CONTRIBMODE` is not writable from this sandbox, so the VS Code
dirs lived in the worktree's gitignored `temp/` (removed after); one stray
Return reached another lane's focused X window while aiming at the native
dialog (switched to `--window`-targeted keys after that).
