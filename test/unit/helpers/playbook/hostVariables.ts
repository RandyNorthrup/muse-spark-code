// What a VS Code extension host's environment was seen to carry (M116,
// docs/certification/m116.md "Commit 4": VS Code 1.140.0 on Linux): Electron's
// run-as-Node switch and eight of the window's own variables. The values here
// are stand-ins; only the names were read.
export const EXTENSION_HOST_VARIABLES = {
  ELECTRON_RUN_AS_NODE: '1',
  VSCODE_CRASH_REPORTER_PROCESS_TYPE: 'extensionHost',
  VSCODE_CWD: '/somewhere',
  VSCODE_ESM_ENTRYPOINT: 'vs/workbench/api/node/extensionHostProcess',
  VSCODE_HANDLES_UNCAUGHT_ERRORS: 'true',
  VSCODE_IPC_HOOK: '/run/user/1000/vscode-ipc.sock',
  VSCODE_NLS_CONFIG: '{}',
  VSCODE_NODE_COMPILE_CACHE_ROOT: '/cache',
  VSCODE_PID: '4242',
} as const

/** The `ELECTRON_*` and `VSCODE_*` names an environment holds, sorted. */
export function hostNames(env: NodeJS.ProcessEnv | undefined): string[] {
  return Object.keys(env ?? {})
    .filter((name) => /^(?:ELECTRON|VSCODE)_/u.test(name))
    .toSorted((a, b) => Number(a > b) - Number(a < b))
}
