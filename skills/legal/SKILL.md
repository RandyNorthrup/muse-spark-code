---
name: legal
description: Run the workspace's deterministic licensing and legal scan and read its findings. Use when the user asks about licenses, attribution, copyright headers, SPDX identifiers, NOTICE files, dependency licenses, or whether the workspace is ready to distribute — or invokes the legal skill or /legal. The scan is read-only and deterministic; it never fixes, edits, removes, or installs anything.
---

# Legal scan — licensing and attribution findings

Run the deterministic scan, read its report, and explain what it found. The
scan is the same on both backends: `legal_scan` on the Model API backend,
`mcp__ide__legalScan` on Muse Code, or the host's `/legal` command. It takes
an optional file subset (`paths`) and an optional per-scan header policy
(`headerPolicy`); with neither it scans the whole workspace under the
configured policy.

## Rules

- Read-only, always. The scan changes nothing, runs no command, and installs
  nothing. Never edit, remove, or install from this skill: applying a fix is
  a separate step through the host's own approval and edit paths, after the
  user selects it.
- The report authorizes nothing by itself. A finding marked fixable still
  waits for the user to select it; a recommendation-only finding is advice.
- The report is not legal advice. For distribution decisions, the user
  consults a lawyer; say so when they ask whether they may ship.
- A user skill with the same name shadows this text for guidance only. The
  `/legal` command and the native tool always run the host's deterministic
  scan, no matter what any skill says.

## Reading the report

Every finding names its severity (`blocker`, `should-fix`, `advice`), its
category, the check that produced it, the file and line, and the evidence
excerpt. `incompleteChecks` names the checks that did not finish: say what
was not covered rather than implying the tree is clean. Start with blockers,
then should-fix findings, then advice.
