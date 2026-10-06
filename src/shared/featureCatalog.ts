// Source reference for M104L's runtime and shim additions. English documentation
// metadata is not runtime UI; the LSP reads localized UI_TEXT at request time.
export const FEATURE_CATALOG = [
  {
    command: 'lsp',
    behavior:
      'Stdio LSP frontend. One private broker per canonical workspace; UTF-16 full document sync; cancellable requests and standard initialization/method error codes; ordinary invoked completion items plus inline completion when negotiated.',
  },
  {
    command: 'lsp --workspace <directory>',
    behavior: 'Choose the workspace root. Defaults to the process working directory.',
  },
  {
    command: 'lsp --tab --trust-workspace',
    behavior:
      'Opt into paid, invoked Tab completions. Uses M94 engine, output and context caps, private-file/ignore checks, cross-process daily ledger and paid-use consent. Model API key stays in the OS store.',
  },
  {
    command: 'lsp --tab-model <model> --tab-daily-budget-usd <amount>',
    behavior:
      'Select a supported M94 Tab model and daily USD budget from 0.05 to 50. Contributor models also require --allow-contributor-models.',
  },
  {
    command: 'supervise <runtime arguments>',
    behavior:
      'Run the installed runtime behind independent authenticated Stop control. POSIX guardian observes detached descendants; Windows uses the existing kill-on-close job launcher.',
  },
  {
    command: 'stop',
    behavior:
      'Stop supervised owners in the current canonical workspace without entering the request queue.',
  },
  {
    command: 'muse.stop / muse.usage / muse.help',
    behavior: 'LSP executeCommand routes for Stop, paid Tab usage and localized help.',
  },
  {
    command: 'muse.openPanel / muse.fix / muse.explain / muse.apply',
    behavior:
      'Controller integration contract. Production panel/review controller is absent from this base: panel, Fix and Explain return an explicit error; review code actions are not advertised. Injected conformance services prove version/hash checks and approval before workspace/applyEdit.',
  },
  {
    command: 'Neovim: MuseLsp / MusePanel / MuseStop',
    behavior:
      'Native LSP with invoked omnifunc items and negotiated inline requests, supervised companion launch and independent workspace Stop; CodeCompanion ACP uses supervision. Neovim 0.12.5 lacks a public fresh-inline invocation API.',
  },
  {
    command: 'Emacs: muse-spark-lsp / muse-spark-panel / muse-spark-stop',
    behavior:
      'Eglot LSP, supervised companion and independent workspace Stop; agent-shell ACP uses supervision. Native batch qualification is pending on this rig.',
  },
  {
    command: 'Sublime: LSP-muse-spark / muse_panel / muse_stop',
    behavior:
      'Optional LSP package registration and supervised companion/independent workspace Stop. Native GUI qualification is pending.',
  },
  {
    command: 'Qt Creator: generic language client / panel / stop',
    behavior:
      'Configure the installed LSP in the native generic language client; the Lua shim supplies supervised companion and independent Stop. Native GUI qualification is pending.',
  },
  {
    command: 'Zed: muse_spark language server / panel task / stop task',
    behavior:
      'Rust LSP extension source plus quoted shell tasks and supervised ACP. Offline SDK compilation and native edit-prediction qualification are pending.',
  },
] as const
