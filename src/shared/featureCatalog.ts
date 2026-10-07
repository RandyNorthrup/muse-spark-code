/** Help-reference facts, including whether an integration has shipped. */
export const FEATURE_CATALOG = [
  {
    id: 'orchestrator-playbook-skill',
    title: 'Orchestrator playbook: bundled skill and reviewer charter',
    status:
      'Skill available through the existing bundled-skills paths; orchestrated reviewer bindings belong to M116 I/W.',
    description:
      'The orchestrator-playbook skill teaches all nine rules, the third-strike design-decision template and two redesigns from this repository. The Model API discovers it as orchestrator_playbook while museSpark.bundledSkills is on; a project or personal skill with that id takes precedence. Muse Code receives it through Muse Spark: Install Bundled Skills for Muse Code, with the existing explicit install/update/remove actions. No installation or model call happens just because the skill ships.',
    lifecycle:
      'The Muse Code installer copies first-party skills and their references into its marked package beside the vendored workflows. A content digest makes a first-party-only release offer Update. Existing personal ids are skipped; removal deletes only links into the marked copy. The reviewer charter is exposed as bundledSkillsLoader(...)().playbookReviewerCharter() from dist/bundledSkills.js, under its unchanged 50 KiB cap. PLAYBOOK_MODEL_TEXT has that bundle as its sole declared reader. No ordinary conversation or M70 review prefix is changed.',
    reviews:
      'Only an orchestrated playbook review uses this charter: all eight finding classes and coverage, dispositions for every prior finding, and exact prior-id redesign resolutions. Only impossible closes a strike; caught and remains require the user. M116 I must inject the charter loader into its trusted review port and supply structured prior findings; W and runtime/editor owners must bind and certify equivalent charter and packaged-skill discovery for ACP and other editors. This entry does not claim those integrations shipped.',
  },
  {
    id: 'orchestrator-playbook-outcomes',
    title: 'Orchestrator playbook: commit verification',
    status: 'Shared policy implemented; editor/planner bindings belong to M116 I/U/W.',
    description:
      'Hook bypass is detected by outcome; the command guard is an advisory early warning. Before a harness-managed push or completion, every newly reachable commit needs a passing receipt identifying the commit and configured hook digest. Repository pre-commit and commit-msg hooks run against the commit tree and message in an isolated temporary worktree. Pre-push runs once for the exact push range with a clean index. Failed or unavailable hooks add a strike and block push and completion; scrubbed output is shown to the person.',
    lifecycle:
      'The trusted harness starts beginWork(module, refs) before dispatch, retains its work id, runs verifyWork(workId) before finishWork(workId), and verifyWork(workId, range) immediately before beforePush(workId, range). Managed pushes send the verified object ids from that range and recheck admission immediately before the effect. Every effect must pass ordinary tool admission. Before/after snapshots include shared refs, every worktree HEAD and each worktree’s private refs/worktree, refs/bisect and refs/rewritten, including newly created and moved refs. Hooks run only through native git hook run in the verification worktree with the source repository’s resolved absolute hooksPath. HUSKY, HUSKY_SKIP_HOOKS and every GIT_* override are deleted from the environment. The native exit code is the verdict, including repository-defined Husky startup and layout behavior; Git’s missing-hook error refuses configured hook sets. Annotated tags verify their target commit; ref deletions require no hook receipt. Pushes also check commits introduced since the first recorded workspace work, so later work cannot hide an unverified ancestor. Hook configuration or byte changes invalidate verification. Receipts and violations survive restart in the workspace journal. Hook-digest epoch v3 rejects receipts from earlier runners. POSIX timeout cleanup enumerates descendants by parent chain and checks start-time identity before killing, including separate sessions. A prepared Linux cgroup/scope runner takes precedence; M107 governed-tree binding remains I/W integration work. Every Windows Git child requires a prepared job/tree runner and refuses without it.',
    reviews:
      'Dispatch leases name the lane, module member and generation. Review completion presents the admitted lease token; expired, released or replaced tokens are refused. Renewal and cancellation require the requesting work’s explicit token. Hook-failure strikes stop patches and admit independent redesign even when no review findings exist. Edited moves require published lineage and inherit strikes through content similarity or Git rename/history evidence. Merges reconcile maximum strikes and lifetime counts throughout the family.',
  },
] as const
