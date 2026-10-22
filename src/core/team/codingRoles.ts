// Coding roles and task-to-role routing (M120 lane R, PLAN.md D103).
//
// `frontend`, `backend` and `engineering` carry area hints (path globs and
// plain-word kinds) on their preference lists. Routing scores every list's
// hints, so a user-defined specialization routes with zero extra code: it
// only needs its own hints. A task touching two areas is split per area, or
// cross-reviewed by the other specialist when it cannot be split. Pure: no
// git, no `vscode`, no model calls.

import { UI_TEXT } from '../../shared/l10n/text'
import { fill } from '../../shared/l10n/text'
import type { TeamAreaHints, TeamPreferenceList } from '../../shared/teamPreference'

/** The coding roles M120 routes between; any other list id routes as a specialization. */
export const CODING_ROLE_IDS = ['frontend', 'backend', 'engineering'] as const
export type CodingRoleId = (typeof CODING_ROLE_IDS)[number]

/** D212's out-of-the-box secondary roles: frontend and backend help each other
and engineering; code review helps engineering. */
export function defaultSecondaryRoles(roleId: string): readonly string[] {
  switch (roleId) {
    case 'frontend': {
      return ['backend', 'engineering']
    }
    case 'backend': {
      return ['frontend', 'engineering']
    }
    case 'code-review': {
      return ['engineering']
    }
    default: {
      return []
    }
  }
}

/** The default area hints for a coding role; a list's own hints replace these. */
export function defaultAreaHints(roleId: string): TeamAreaHints {
  switch (roleId) {
    case 'frontend': {
      return {
        globs: ['**/*.tsx', '**/*.jsx', '**/*.vue', '**/*.css', '**/*.html', 'src/webview/**'],
        kinds: ['ui', 'style', 'component', 'webview', 'panel'],
      }
    }
    case 'backend': {
      return {
        globs: ['src/server/**', 'src/api/**', '**/api/**', '**/server/**'],
        kinds: ['api', 'server', 'database', 'worker', 'endpoint'],
      }
    }
    default: {
      return {
        globs: ['src/core/**', 'src/shared/**', 'scripts/**'],
        kinds: ['core', 'infra', 'tooling', 'build', 'shared'],
      }
    }
  }
}

/** A routing input: the files the task touches and its plain-word kinds. */
export interface RoutedTask {
  readonly files: readonly string[]
  readonly kinds: readonly string[]
}

/**
Whether one area glob matches one file path. The supported subset is
deliberate and total: an extension suffix, a directory prefix, or an exact
path. Anything else never matches, so an exotic glob fails closed to no
match rather than to a wrong role. Separators normalize first, so Windows
spellings route the same way.
*/
const EXTENSION_GLOB = '**/*.'
const DIRECTORY_GLOB = '/**'

export function isAreaMatch(glob: string, file: string): boolean {
  const pattern = glob.replaceAll('\\', '/')
  const path = file.replaceAll('\\', '/')
  if (pattern === path) return true
  if (pattern.startsWith(EXTENSION_GLOB)) {
    const extension = pattern.slice(EXTENSION_GLOB.length)
    return (
      !extension.includes('/') && (path.endsWith(`.${extension}`) || path.endsWith(`/${extension}`))
    )
  }
  if (pattern.endsWith(DIRECTORY_GLOB)) {
    const dir = pattern.slice(0, -DIRECTORY_GLOB.length)
    return path === dir || path.startsWith(`${dir}/`)
  }
  return false
}

/** How much of the task one list's hints cover: glob hits and kind hits. */
export function areaScore(hints: TeamAreaHints, task: RoutedTask): number {
  let score = 0
  for (const file of task.files) {
    if (hints.globs.some((glob) => isAreaMatch(glob, file))) score += 1
  }
  const kinds = new Set(task.kinds.map((kind) => kind.toLowerCase()))
  for (const hint of hints.kinds) {
    if (kinds.has(hint.toLowerCase())) score += 1
  }
  return score
}

/** Where a task goes, with the reason the panel shows. */
export type TaskRoute =
  | { readonly kind: 'routed'; readonly roleId: string; readonly reason: string }
  | { readonly kind: 'noMatch'; readonly reason: string }

/**
The role whose hints cover the task best; ties keep every tied role so the
caller can split. A user specialization wins exactly like a built-in role:
routing reads every list's hints, custom ids included.
*/
export function routeTaskToRole(task: RoutedTask, lists: readonly TeamPreferenceList[]): TaskRoute {
  const scored = lists.map((list) => ({
    roleId: list.role,
    score: areaScore(list.areaHints ?? defaultAreaHints(list.role), task),
  }))
  const top = Math.max(0, ...scored.map((item) => item.score))
  const first = scored.find((item) => top > 0 && item.score === top)
  if (first === undefined) return { kind: 'noMatch', reason: UI_TEXT.teamRouteNoMatch }
  const areas = [...task.files, ...task.kinds].join(', ')
  return {
    kind: 'routed',
    roleId: first.roleId,
    reason: fill(UI_TEXT.teamRouteReason, { role: first.roleId, areas }),
  }
}

/** A mixed task's plan: split per area, or cross-reviewed when indivisible. */
export type MixedTaskPlan =
  | {
      readonly kind: 'split'
      readonly parts: readonly { readonly roleId: string; readonly files: readonly string[] }[]
      readonly reason: string
    }
  | { readonly kind: 'crossReview'; readonly roleId: string; readonly reason: string }
  | { readonly kind: 'single'; readonly roleId: string }

/**
Splits a multi-area task per winning role, or names the other specialist to
cross-review when one file spans areas. Single-area tasks stay single.
*/
export function splitOrCrossReview(
  task: RoutedTask,
  lists: readonly TeamPreferenceList[],
): MixedTaskPlan {
  const byRole = new Map<string, string[]>()
  for (const file of task.files) {
    const scored = lists
      .map((list) => ({
        roleId: list.role,
        score: (list.areaHints ?? defaultAreaHints(list.role)).globs.some((glob) =>
          isAreaMatch(glob, file),
        )
          ? 1
          : 0,
      }))
      .filter((item) => item.score > 0)
    if (scored.length === 0) continue
    const winner = scored[0]?.roleId ?? 'engineering'
    const group = byRole.get(winner) ?? []
    group.push(file)
    byRole.set(winner, group)
  }
  const parts = [...byRole].map(([roleId, files]) => ({ roleId, files }))
  if (parts.length >= 2) {
    return {
      kind: 'split',
      parts,
      reason: fill(UI_TEXT.teamRouteSplit, {
        roles: parts.map((part) => part.roleId).join(', '),
      }),
    }
  }
  const kinds = new Set(task.kinds.map((kind) => kind.toLowerCase()))
  const kindRoles = lists
    .filter((list) =>
      (list.areaHints ?? defaultAreaHints(list.role)).kinds.some((hint) =>
        kinds.has(hint.toLowerCase()),
      ),
    )
    .map((list) => list.role)
  const routed = parts[0]?.roleId ?? kindRoles[0] ?? 'engineering'
  if (task.files.length <= 1 && kindRoles.length >= 2) {
    const reviewer = kindRoles.find((roleId) => roleId !== routed) ?? kindRoles[0]
    if (reviewer !== undefined && reviewer !== routed) {
      return {
        kind: 'crossReview',
        roleId: reviewer,
        reason: fill(UI_TEXT.teamRouteCrossReview, { author: routed, reviewer }),
      }
    }
  }
  return { kind: 'single', roleId: routed }
}
