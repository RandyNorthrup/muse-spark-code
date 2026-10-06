import path from 'node:path'
import { CODE_INTEL_TOOLS, MODEL_API_TOOLS, SPARK_HOOKS_SEGMENTS } from '../../../shared/constants'
import type { HookLoadDeps } from './hooks'
/**
 * Both spark-hooks.json files (M91): the user's beside Muse Code's settings
 * file, which is the settingsPath (`<config>/muse/settings.json`), and the
 * project's under `.muse`.
 */
export function sparkHooksFiles(deps: Pick<HookLoadDeps, 'settingsPath' | 'workspaceRoot'>): {
  readonly user: string
  readonly project: string
} {
  return {
    user: path.join(path.dirname(deps.settingsPath), SPARK_HOOKS_SEGMENTS.user[1]),
    project: path.join(deps.workspaceRoot, ...SPARK_HOOKS_SEGMENTS.project),
  }
}

/** Muse Code matcher aliases for the Model API backend's built-in tools. */
export function toolMatcherNames(name: string): readonly string[] {
  switch (name) {
    case MODEL_API_TOOLS.bash:
    case MODEL_API_TOOLS.powershell: {
      return [name, 'Bash', 'shell']
    }
    case MODEL_API_TOOLS.readFile: {
      return [name, 'Read']
    }
    case MODEL_API_TOOLS.writeFile: {
      return [name, 'Write']
    }
    // A rename (M67) edits files as edit_file does: an `Edit` hook sees it too.
    case MODEL_API_TOOLS.editFile:
    case CODE_INTEL_TOOLS.renameSymbol: {
      return [name, 'Edit']
    }
    case MODEL_API_TOOLS.search: {
      return [name, 'Grep']
    }
    default: {
      return [name]
    }
  }
}
