# HELPREF — Help & Reference

Rig: macmini. Base: `2d4d72bd` (0.14.0); branch `feat/help-reference`.
No model calls, paid use, credentials, dependency additions or network calls.
No existing gate or size cap was changed. The rig brief prohibits full quality,
merge and push; integrated quality and release remain the lead's gates (PLAN §7).

The generated model covers 41 features, 44 contributed commands, 58 settings,
26 built-in slash commands and 12 CLI routes. Installed skills remain dynamic;
ACP advertises `/help` plus its own installed skills rather than panel-only
commands. VS Code opens `@id:<key>`; the host-neutral handler passes the same
validated key to native hosts' settings anchor. The shared React factory accepts
the caller's React and installed language, so its independent lazy entry carries
neither another React nor another English fallback.

ACP's companion link is the generated GitHub reference. The phone companion and
native shared-webview implementations are planned in the base repository's IDE
compatibility plan, not present to integrate or certify here. ACP compact help,
CLI full help and the shared page bridge are exercised locally. No claim is made
that a planned native host has run this page.

## Tests and checks

- New generator, host/CLI and page tests: 19 passed (three files, bounded workers).
- Owning ACP agent/runtime and palette tests: 146 passed (three files).
- App, lazy App surfaces and protocol regressions: 294 passed (three files).
- Generator/page/manifest batch: 49 passed; repeated tests counted once.
- Page, slash registry and UI reducer batch: 215 passed (three files).
- Accessibility: wide/narrow in all four themes, 8 pages, 0 violations.
- Dead code and duplication: passed (0 clones), without exclusions.
- Host API record regenerated and checked: 0 problems.
- ACP package built offline; its `help --all` matches production output.
- Production `help --all`, `--help` and `exec --help`: successful.
- Typecheck: all five projects passed.
- Localization: 14 tables, 165 manifest strings, 0 problems.
- Production build: passed with unchanged existing caps, including 900 KiB startup.
- React quality checklist: reviewed lazy loading, stable effects, accessibility,
  factory outside renders, and shared caller runtime.

Final lint/format, screenshot paths and exact bundle measurements are recorded
in the next certification update. Browser verification caught a missing React
Fragment in the lazy runtime and insufficient narrow navigation target size.
The shared runtime now supplies Fragment and links meet the existing button
height; the unchanged accessibility gate passes.

## Deliberate red drills

[Machine-readable receipts](help-reference/drills.json) record each nonzero exit,
the failing diagnostic/test and SHA-256 before and after restoration. Fourteen
mutations all fired and restored byte-exactly:

1. Add a contributed command without a catalogue entry → `check:reference` rejects it.
2. Append stale generated data → `check:reference` rejects it.
3. Disable the known-setting guard → host test fails.
4. Disable the safe-command allowlist → host test fails.
5. Read environment-variable settings → sensitive-value test fails.
6. Disable dictionary parsing → boundary test fails.
7. Disable nested reference-model parsing → boundary test fails.
8. Expose unsafe Run buttons → page test fails.

9. Break a README documentation anchor → the generator rejects the feature link.
10. Overfill the new Node reference bundle → its size gate fails.
11. Overfill the independent page → its size gate fails.
12. Import the generated model into chat startup → the split gate fails.
13. Duplicate the English fallback in the independent page → the split gate fails.
14. Allow a skill named `help` to replace the built-in → the registry test fails.

After restoration, the three new test files passed together (19 tests). No test
or rule was disabled to obtain a passing result.
