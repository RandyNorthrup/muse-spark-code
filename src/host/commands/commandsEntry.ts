// The CLI-backed and workspace command flows as a bundle of their own (D6):
// esbuild builds this file into dist/commands.js, which the activation bundle
// requires the first time one of those commands runs, so the MCP-servers and
// hooks pickers, the skills flows, the worktree flows, the memory flow and
// the plan picker stay out of dist/extension.js. Like rulesFileEntry, each
// factory installs the caller's table before delegating: the bundle keeps its
// own installed-language state.
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import {
  type MuseConfigDeps,
  showHooks as hooksFlow,
  showMcpServers as serversFlow,
} from './museConfigCommands'
import {
  type ImportSkillsDeps,
  importSkills as importFlow,
  type ManageSkillsDeps,
  manageSkills as manageFlow,
} from './skillsCommands'
import { choosePlan as chooseFlow } from './planCommands'
import type { PickOne } from './pickItem'
import type { PlanSummary } from '../../core/plans/planStore'
import type { PlanChoice } from '../conversation/conversationController'
import { type MemoryViewDeps, showMemory as memoryFlow } from './memoryCommands'
import {
  newWorktree as newFlow,
  removeWorktree as removeFlow,
  type WorktreeDeps,
} from './worktreeCommands'

/** The MCP servers picker over the Muse Code CLI, in the caller's language. */
export function showMcpServers(deps: MuseConfigDeps, table: UiText, locale: string): Promise<void> {
  setUiText(table, locale)
  return serversFlow(deps)
}

/** The hooks picker over the Muse Code CLI, in the caller's language. */
export function showHooks(deps: MuseConfigDeps, table: UiText, locale: string): Promise<void> {
  setUiText(table, locale)
  return hooksFlow(deps)
}

/** The Manage Skills flow, in the caller's language. */
export function manageSkills(deps: ManageSkillsDeps, table: UiText, locale: string): Promise<void> {
  setUiText(table, locale)
  return manageFlow(deps)
}

/** The Import Skills flow, in the caller's language. */
export function importSkills(deps: ImportSkillsDeps, table: UiText, locale: string): Promise<void> {
  setUiText(table, locale)
  return importFlow(deps)
}

/** A new worktree from the user's branch answer, in the caller's language. */
export function newWorktree(deps: WorktreeDeps, table: UiText, locale: string): Promise<void> {
  setUiText(table, locale)
  return newFlow(deps)
}

/** Removing a worktree after its confirmation, in the caller's language. */
export function removeWorktree(deps: WorktreeDeps, table: UiText, locale: string): Promise<void> {
  setUiText(table, locale)
  return removeFlow(deps)
}

/** The Memory picker and editor, in the caller's language. */
export function showMemory(deps: MemoryViewDeps, table: UiText, locale: string): Promise<void> {
  setUiText(table, locale)
  return memoryFlow(deps)
}

/** The palette's Plans… picker, in the caller's language. */
export function choosePlan(
  plans: readonly PlanSummary[],
  pick: PickOne,
  table: UiText,
  locale: string,
): Promise<PlanChoice | undefined> {
  setUiText(table, locale)
  return chooseFlow(plans, pick)
}
