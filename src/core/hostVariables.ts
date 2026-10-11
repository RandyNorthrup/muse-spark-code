// The editor host's own environment variables, which no command a tool or the
// playbook starts may inherit. One list for every child's environment: the
// shell tools (`shellEnvironment`, PLAN.md D4) and the playbook's git and
// hook commands (M116, PLAN.md §9) both read it here.

// The variables VS Code's terminal strips from the extension host's
// environment before a shell sees it (`sanitizeProcessEnvironment`,
// microsoft/vscode src/vs/base/common/processes.ts): Electron's switches
// (`ELECTRON_RUN_AS_NODE` turns a `code` command into plain Node), the
// window's IPC handles, and the Snap and GDK loader paths.
const HOST_ONLY_VARIABLES: readonly RegExp[] = [
  /^ELECTRON_.+$/,
  /^VSCODE_(?!(?:PORTABLE|SHELL_LOGIN|ENV_REPLACE|ENV_APPEND|ENV_PREPEND)$).+$/,
  /^SNAP(?:|_.*)$/,
  /^GDK_PIXBUF_.+$/,
]

/** Whether a variable is the editor host's own, and so no child's to inherit. */
export function isHostOnlyVariable(name: string): boolean {
  return HOST_ONLY_VARIABLES.some((pattern) => pattern.test(name))
}

/** `env` without the editor host's own variables. */
export function withoutHostVariables(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !isHostOnlyVariable(name)))
}
