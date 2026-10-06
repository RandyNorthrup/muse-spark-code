# HELPREF — Help & Reference

Rig: macmini. Base: `2d4d72bd` (0.14.0); branch `feat/help-reference`.
Implementation commit: `47dcf1a4`; final certification follows on the same branch.
No model calls, paid use, credentials, dependencies or external network calls.
All existing size caps and gate thresholds remain unchanged. The rig brief
prohibits full quality, merge and push; integrated quality and release remain
the lead's gates (PLAN §7). Local commits ran the hooks and staged secret scan.

The generated reference covers **41 features, 44 commands, 58 settings,
26 built-in slash commands and 12 CLI entries**. Eight reviewed global commands
have Run links; workspace/editor commands and destructive actions stay listed
without Run. Installed skills remain dynamic. `/help` is reserved in the panel
and ACP even when a skill has that selector; compact ACP help lists it once.

The shared React factory accepts the caller's React (including Fragment),
installed language and bridge. Its independent lazy entry carries neither
another React nor another English fallback. The Node implementation and model
load on the first reference action. VS Code opens `@id:<key>`; the host-neutral
handler passes the same validated key to a native settings anchor. Environment
variable settings are never read or sent. Hosts without current values get an
explicit unavailable message and still see the defaults.

ACP's companion link is the generated GitHub reference. The phone companion and
native shared-webview implementations are planned in the base repository's IDE
compatibility plan, not present to integrate or certify here. ACP compact help,
CLI full help and the shared page bridge are exercised locally. This record does
not claim a planned native host has run the page.

## Tests and checks

All runs were scoped to at most three files with `--maxWorkers=3` and
`--testTimeout=120000`. **771 distinct tests** passed across 14 owning files:

- Reference generator, host/CLI and page: 21 tests.
- ACP agent, ACP runtime and palette: 146 tests.
- App, lazy App and protocol: 294 tests.
- Manifest: 35; slash registry: 36; UI reducer: 173.
- Inline/regional English fallback: 7; flight recorder: 59.

Final checks passed: five-project typecheck, changed-file ESLint, Prettier,
localization (14 tables, 165 manifest strings, 0 problems), reference freshness,
host API record (0 problems), dead code, duplication (0 clones), production build,
bundle size/split/global checks and third-party notices (83 packages).
The React quality checklist covered stable effects, factory placement, lazy
loading, accessibility and the caller's shared runtime.

Production `help --all`, `--help` and `exec --help` succeeded. The ACP package was
built offline and its full help output matches the production launcher. No
package was published. The owning frame-vocabulary test caught the new scripts;
both exact package paths are registered without broadening stack-path retention.

## Startup and bundles

[Measured bytes](help-reference/measurements.json) compare a production build of
an archived `2d4d72bd` tree with the final source using the same installed pins.
The initial help overhead was 2,675 bytes. Reserved two-byte UTF-8 tokens in the
existing lossless English dictionary recovered that space; its complete keys,
values and plural forms round-trip exactly. The canonical table has no token
collision. No fallback, functionality, dependency or size cap was removed.

| Artifact                                       |   Bytes |
| ---------------------------------------------- | ------: |
| 0.14.0 chat startup (including static imports) | 914,658 |
| Final chat startup (including static imports)  | 899,489 |
| Startup reduction                              |  15,169 |
| Unchanged startup cap                          | 921,600 |
| Extension                                      | 448,206 |
| Model API                                      | 457,348 |
| ACP                                            | 838,806 |
| Lazy Node reference/model                      |  82,279 |
| Independent lazy reference page                |  29,357 |
| Reference stylesheet                           |   1,462 |

The unchanged aggregate deferred-chat cap also passes. The generator reads the
TypeScript RuntimeCommand inventory as an AST, including multiline variants,
and validates README anchors as well as command/setting relationships.

## Accessibility and screenshots

English and French, wide/narrow, all four captured themes: **16 pages,
0 violations, 0 undecided rules, 0 pages without results**. Axe excludes only
contrast it cannot see under the modal or beyond the viewport, under the
existing harness policy (12 English and 16 French elements). No exemption was
added. Browser verification caught a missing Fragment in the shared runtime and
undersized narrow navigation links; the runtime and target height were fixed.

Screenshots were inspected at 1000×760 and 320×760. README does not link these
shots, so `media/readme` is untouched:

- [Wide light](help-reference/light/help.png)
- [Narrow light](help-reference/light/help-narrow.png)
- [Wide dark](help-reference/dark/help.png)
- [Narrow dark](help-reference/dark/help-narrow.png)

## Deliberate red drills

[Receipts](help-reference/drills.json) record failing exits/diagnostics and
SHA-256 before and after restoration. **20 mutations fired and every file was
restored byte-exactly**, followed by green scoped tests and checks:

1. Add a command without a catalogue entry.
2. Append stale generated output.
3. Disable the known-setting guard.
4. Disable the safe-command allowlist.
5. Read environment variable settings.
6. Disable translated dictionary parsing.
7. Disable nested reference-model parsing.
8. Expose unsafe Run buttons.
9. Break a README documentation anchor.
10. Overfill the Node reference bundle.
11. Overfill the independent page bundle.
12. Import the generated model into chat startup.
13. Duplicate the English fallback in the independent page.
14. Let an installed skill replace `/help`.
15. Disable the dictionary collision guard.
16. Disable dictionary decoding.
17. Add an undocumented multiline CLI route.
18. Duplicate reserved `/help` in compact ACP help.
19. Omit a shipped reference script from the frame vocabulary.
20. Hide the unavailable-current-values message.
