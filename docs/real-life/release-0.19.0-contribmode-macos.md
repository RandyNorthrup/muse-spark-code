# Contributor mode real use on macOS (2026-10-18, lane `RUCONTRIBM`)

Product change under test: the Muse Code backend honours the person's own
`contributor_mode_enabled` — `serve` starts with `--contributor-mode on`,
and the catalogue carries each served model's `-contributor` counterpart by
name. Nothing defaults it on. Linux proof: `contribmode-2026-10-18.md`.
This record is the macOS proof, through the packed `dist/` on this machine.

- Product: production bundles built in this worktree, driven as
  `node dist/acp.js` (the same bytes the ACP tarball ships).
- Version: **0.19.0**, git sha **3ff85ad9401cc8f8aa6b7fd71aed4e947b6dd39d**.
- Rig: the owner's MacBook (no browsers; none used). All runs in empty
  scratch workspaces under the worktree's gitignored `temp/`.
- Muse Code: **1.4.10**. Settings as they are, read only, never edited:
  `contributor_mode_enabled: true`.
- Model calls: **5 total, $0.00 settled**, every one answered by
  **muse-spark-1.3-contributor** (subscription backend).

## Build

- `npm ci`: exit 0.
- `npm run build`: exits 1 on pre-existing bounds, none caused here (the
  tree changes no `src/`; the only edit was the local-only trim below,
  restored byte-exact). First the What's New bound
  (`CHANGELOG.md 0.19.0` decodes to 148,580 bytes over the 76,800 bound).
  Built with a local-only trim of the `[0.19.0]` notes (backed up,
  sha256 `432a29f2…afba9a1f` before and after, restored byte-exact,
  never committed), then the size gate still refuses three bundles:
  `dist/conversation.js` 254.9 KiB (budget 250),
  `dist/modelApi.js` 572.3 KiB (budget 525),
  `dist/productionAudio.js` 141.2 KiB (budget 75).
  `build.mjs` itself completes, so the proof ran on freshly built `dist/`.
- `session/new` first failed with
  `spawn …/native/darwin/muse-dictate ENOENT`: the helper is git-ignored
  and this checkout had never built it. Built it the documented way
  (`bash native/darwin/build.sh`; precedent: `pr176-2026-10-17.md`),
  with `DEVELOPER_DIR=/Library/Developer/CommandLineTools` scoped to that
  one command because the machine's `xcode-select` points at a missing
  `/Applications/Xcode.app` (also breaks `/usr/bin/git`; this lane used
  the Command Line Tools git instead). No system setting was changed.

## Proof through the packed product

The product started the CLI as
`muse serve --contributor-mode on --disable-shell`: contributor mode came
from the person's own settings, not from a product default.

- `exec --model muse-spark-1.3-contributor` without the product flag is
  refused before any turn (exit 2, 0 calls):
  `This model is not available for this run.` With
  `--allow-contributor-models` it answered `EXEC-MACOS-OK` (exit 0,
  session `01a15177-f68f-…`).
- ACP (`node dist/acp.js --allow-contributor-models` over stdio): the
  `model` option lists all eight ids
  (`muse-wonder-1.0`, `muse-wonder-full-1.0`, `muse-spark-1.3`,
  `muse-spark-1.2` and each one's `-contributor` counterpart);
  `session/set_config_option` to `muse-spark-1.3-contributor` is accepted;
  turn 1 answered `ACP-MACOS-ONE`; turn 2 created `hello-macos.txt`
  byte-exact (`cmp` against `printf 'BYTE-EXACT-42'`: identical, 13 bytes,
  no trailing newline — the prompt said "12 bytes" by mistake and the
  model wrote the correct 13). No permission question was raised for the
  write; the CLI ran approval mode `promptUnmatched` and allowed it.
  Sessions `01a15171-…` (first run) and `01a15175-…` (logged rerun).

Every provider line in Muse Code's session records names the contributor
model — 18 of 18: run 1 `01a15171-…` 6/6, run 2 `01a15175-…` 6/6, flagged
exec `01a15177-f68f-…` 6/6, and the refused no-flag session
`01a15177-4f52-…` carries none (0 calls). No other model id appears.

**PASS.** No product defect found; no code changed.

## Notes for the lead (environment, not product)

- `xcode-select -p` says `/Applications/Xcode.app/Contents/Developer`,
  which does not exist; `/usr/bin/git` and `cc` fail until the path is
  fixed machine-wide (out of scope for this lane).
- The product noted `muse serve reports the sandbox is unavailable on
this host while the shell sandbox is on: commands run without sandbox
enforcement`, and the Model API backend reports the credential store
  unusable here (`store-unavailable`); neither affected this proof.
