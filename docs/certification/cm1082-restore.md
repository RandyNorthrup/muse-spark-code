# Walk-back restore note for C-M108-2: Per-request account selection and billing

Lane state when written (2026-10-11): no ledger entry seen (treat as not started)

Append this block to the lane's brief.

**When this lane's code is accepted, restore these walked-back items.** The 0.17.1 truth pass (`c/x-1 99e9b4106`) hid or re-worded them because the code refused; your branch forks from before it, so after the rebase the feature is still hidden unless you undo each mechanism below. Ids refer to `walkback/register.json`; mechanism letters to `walkback/mechanisms.md`.

Rules that apply to every item:

1. Restore only what your accepted code really does on an installed build; leave the rest held and say which.
2. A setting: remove its `deprecationMessage` (package.json) in the same change that restores its reader (src/host/settings.ts) and its description in 15 `package.nls*.json` tables. The reference gate fails otherwise.
3. Text: the truth matrix (`test/unit/cx1r5Truth.test.ts:92-109`) forbids the original phrases on every published surface. Delete only your feature's alternative from the `claims` and `usage` regexes and invert the absence assertions named below into presence assertions; do not delete the files, they still guard the other features.
4. Release notes: never remove a `<!-- whats-new: historical -->` marker from a claim; write a NEW bullet with its `<!-- try: ... -->` directive under the release that ships the feature (lead decision 2026-10-11).
5. Regenerate: `npm run reference:generate`, `npm run roadmap:generate`, the 14 `l10n/ui.*.json` tables; a reviewed visual re-baseline follows any What's New or Help change.

## Several accounts per provider

Tests to invert: test/unit/cx1r4Truth.test.ts:79-125; test/unit/cx1r5Truth.test.ts:45-57 (three account keys), :92-109 (the `accounts` claims key; `providers accounts`, `exec --account`, `--account-pool` in `usage`), :447-451; test/unit/cx1r2Truth.test.ts:104-130 (`accounts`); test/unit/featureCatalogDetails.test.ts:24-29; test/unit/settings.test.ts:55-79. Keep test/unit/cx1r5Session.test.ts (it guards the session-creation fix).

- **WB-153** (setting-inert): Setting `museSpark.accountSwap`: package.json:1639 (`deprecationMessage`), package.nls.json `config.accountSwap.description` (+14 locales), src/host/settings.ts:461, Help row
  - Restore: One change (order rule): remove `deprecationMessage`, restore the description in 15 tables, restore `readSetting(config, 'accountSwap', log)`. M126 lane C's registry lists the same key (`settingsUnavailableAccounts`). (tests: see the list above)
  - Shared with: C-M126-INT
- **WB-154** (setting-inert): Setting `museSpark.accountParallel`: package.json:1646 (`deprecationMessage`), package.nls.json `config.accountParallel.description` (+14 locales), src/host/settings.ts:462, Help row
  - Restore: One change (order rule): remove `deprecationMessage`, restore the description in 15 tables, restore `readSetting(config, 'accountParallel', log)`. M126 lane C's registry lists the same key (`settingsUnavailableAccounts`). (tests: see the list above)
  - Shared with: C-M126-INT
- **WB-159** (help-row-removed): Help CLI flag row `exec: --account-pool`: regex at scripts/lib/reference.mjs:1397 (`account(?:-pool)?`)
  - Restore: The regex hides `--account` and `--account-pool` together: to restore `--account` alone (CM108ACC) while pooling stays refused, change `account(?:-pool)?` to `account-pool`; remove it entirely when C-M108-2 lands. (tests: see the list above)
- **WB-165** (claim-removed): README section "## Several accounts per provider" (82d50d5e4:README.md:887-924): intro, command list and three paragraphs
  - Restore: Restore under `## Several accounts per provider`, one paragraph per working part: CLI metadata and `exec --account` with CM108ACC; swap and pool with C-M108-2; placement with C-M108-6/7. rigs/macbook/c/m108-acc 4524c8398 edits this section (README +20/-…): take its text. cx1r4Truth.test.ts:101-107 and cx1r5Truth.test.ts:439-445 forbid the heading and the commands.
  - Shared with: CM108ACC, C-M108-7, C-M108-9
- **WB-167** (claim-removed): README policy paragraph (82d50d5e4:README.md:939-945)
  - Restore: Restore with the section.
  - Shared with: C-M108-9
- **WB-171** (claim-removed): docs/ci.md, exec options table row `--account-pool`
  - Restore: Restore the row. `exec --account` and `--account-pool` are in the truth matrix's `usage` regex.
- **WB-175** (claim-removed): CHANGELOG.md [0.17.0] ### Added, bullet "Add several-account storage ..." (line 723 on c/x-1): three sentences deleted from the release record itself, and the rest of the bullet archived
  - Restore: Unlike the other history edits this one deleted text instead of only archiving it. Do not rewrite 0.17.0 again: say it in the shipping release's Added notes (`providers accounts`, exec `--account`, the two settings on by default, `accounts.severalOnThisDevice` off). cx1r5Truth.test.ts:447-449 forbids `providers accounts|--account|accountSwap` in the 0.17.0 sections.
  - Shared with: CM108ACC, C-M108-7

## Settings marked unavailable by the Settings page lane

- **WB-251** (setting-inert): Settings `museSpark.accountSwap`, `museSpark.accountParallel`, `museSpark.accounts.severalOnThisDevice` (second marking): rigs/linuxlt/m126/nothing-dead 6e2fc855e, src/shared/settingsAvailability.ts:25-62 (`UNAVAILABLE_SETTINGS`); rendered as "Not available yet: {reason}" in native setting descriptions, Help and the Settings page
  - Restore: Delete the three keys from the registry with the lanes that bind swap, spread and profiles.
  - Shared with: C-M108-7, C-M126-INT
