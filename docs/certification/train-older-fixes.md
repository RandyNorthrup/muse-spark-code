# Train older-fixes: six fix PRs onto main-now (81dacaf5a)

Lane branch `train/older-fixes` starts at `main-now` (81dacaf5a, PR #184).
The six PR heads were fetched read-only from upstream (no remote added) into
`refs/lane-prs/`. All six share merge-base 821566c0f with HEAD.

## Conflict counts against HEAD (git merge-tree, hunks)

| Order | PR   | Branch               | Head      | Conflicts | Conflicted files                                                                                                                                                                          |
| ----- | ---- | -------------------- | --------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | #187 | fix/panel-text       | 37db3d801 | 0         | — (clean)                                                                                                                                                                                 |
| 2     | #167 | fix/usage-truth      | 832c6bf74 | 1         | CHANGELOG.md                                                                                                                                                                              |
| 3     | #186 | fix/provider-truth   | 5e8e9b9f5 | 1         | CHANGELOG.md                                                                                                                                                                              |
| 4     | #177 | fix/tool-output-cap  | 04fcd8705 | 3         | CHANGELOG.md, src/runtime/reference.node.generated.ts, src/shared/reference/reference.generated.ts                                                                                        |
| 5     | #178 | fix/tool-rounds      | b0c79a758 | 4         | src/core/backends/modelapi/ModelApiHost.ts (x2), src/runtime/reference.node.generated.ts, src/shared/reference/reference.generated.ts                                                     |
| 6     | #179 | fix/reasoning-shapes | 034e99c05 | 6         | CHANGELOG.md, src/core/backends/modelapi/codecs/anthropic.ts, src/core/providers/configured.ts (x2), src/runtime/reference.node.generated.ts, src/shared/reference/reference.generated.ts |

Merge order: fewest conflicts first (panel-text, usage-truth, provider-truth,
tool-output-cap, tool-rounds, reasoning-shapes). Generated reference files
are regenerated with the repo generator after merging, not hand-merged.
CHANGELOG conflicts keep both sides' entries under `[Unreleased]`.

## Merge log

- (pending) #187 fix/panel-text — clean merge expected.
- (pending) #167 fix/usage-truth.
- (pending) #186 fix/provider-truth.
- (pending) #177 fix/tool-output-cap.
- (pending) #178 fix/tool-rounds.
- (pending) #179 fix/reasoning-shapes.

## Real-use steps per PR (collected during merge)

- (pending — from each PR's certification record and CHANGELOG entry.)
