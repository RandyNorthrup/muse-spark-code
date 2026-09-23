// `Muse Spark: Open in Terminal` (PLAN.md D15): the Muse Code CLI's own
// interactive TUI in a VS Code terminal at the workspace root, for the user
// who wants the terminal experience beside the panel (Claude Code's "Open in
// Terminal"). The CLI is the user's signed-in one, so the work is billed to
// the subscription exactly as the panel's is; the pasted Model API key never
// reaches it.

import { MUSE_TERMINAL_NAME, UI_TEXT } from '../../shared/constants'

/** What a user-facing terminal needs beside the command line. */
export interface TerminalLaunchOptions {
  readonly name: string
  /** The terminal's working directory; VS Code's default when undefined. */
  readonly cwd: string | undefined
}

export interface OpenInTerminalDeps {
  readonly resolveCli: () =>
    | { readonly ok: true; readonly cliPath: string }
    | { readonly ok: false; readonly reason: string }
  readonly runInTerminal: (
    cliPath: string,
    args: readonly string[],
    options: TerminalLaunchOptions,
  ) => void
  readonly workspaceRoot: string | undefined
  readonly showWarning: (message: string) => void
}

export function openMuseTerminal(deps: OpenInTerminalDeps): void {
  const cli = deps.resolveCli()
  if (!cli.ok) {
    deps.showWarning(`${UI_TEXT.terminalCliMissing} ${cli.reason}`)
    return
  }
  deps.runInTerminal(cli.cliPath, [], { name: MUSE_TERMINAL_NAME, cwd: deps.workspaceRoot })
}
