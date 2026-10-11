// The VS Code window's playbook bundle (M116, lane C-M116-6; PLAN.md D6):
// esbuild builds this file into dist/playbook.js. Required by the window the
// first time anything of the playbook is used, it is the window's client;
// started again by that client as a worker thread, it is the governor. One
// file, so the policy ships once and the activation bundle carries none of it.

import { parentPort, Worker, workerData } from 'node:worker_threads'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { withoutCredentials } from '../../core/credentialEnvironment'
import {
  parsePlaybookCommand,
  runPlaybookCli,
  runPlaybookCommand,
  type PlaybookSurfacePort,
} from '../../runtime/playbook/command'
import {
  createPlaybookWindow as createWindow,
  type PlaybookWindow,
  type PlaybookWindowDeps,
} from './playbookWindow'
import type { SubagentAdmission } from '../../core/backends/modelapi/subagentTools'
import {
  createPlaybookConversation,
  playbookAdmission,
  type PlaybookConversation,
  type PlaybookConversationHost,
  type PlaybookUi,
} from './playbookConversation'
import { createPlaybookPanel, type PlaybookPanel } from './playbookPanel'
import { servePlaybook } from './playbookWorker'
import { playbookWorkerDataSchema } from './workerProtocol'

export type {
  PlaybookConversation,
  PlaybookConversationHost,
  PlaybookReviewRequest,
} from './playbookConversation'
export type {
  PlaybookConversationEvents,
  PlaybookDispatch,
  PlaybookWindow,
  PlaybookWindowReview,
} from './playbookWindow'

/** The slice of the journal bundle a local `/playbook` answer drives (`playbookAnswer.ts`). */
export interface PlaybookAnswerBundle {
  readonly parsePlaybookCommand: typeof parsePlaybookCommand
  readonly createPlaybookSurface: () => PlaybookSurfacePort
  readonly runPlaybookCommand: typeof runPlaybookCommand
  readonly runPlaybookCli: typeof runPlaybookCli
}

export interface PlaybookWindowBundle extends PlaybookWindow {
  /**
   * `/playbook` in the composer: the grammar and wording the CLI and the ACP
   * agent use, over this window's own journal surface.
   */
  answerBundle(): PlaybookAnswerBundle
  /** The panel's own channel: the Agent map's page and the rows' records. */
  readonly panel: PlaybookPanel
  /** One conversation's reviews, dispatches and answers, over what it lends. */
  conversation(host: PlaybookConversationHost): PlaybookConversation
  /** A Model API conversation's new child work (`ModelApiHostDeps.playbook`). */
  readonly admit: SubagentAdmission
}

/** The window's playbook; the caller's table is installed before any of it words a result. */
export function createPlaybookWindow(
  deps: Omit<PlaybookWindowDeps, 'startWorker'> &
    Partial<Pick<PlaybookWindowDeps, 'startWorker'>> & {
      /** VS Code's pickers (`vscode.window`), for the answers a person gives. */
      readonly ui: PlaybookUi
    },
  table: UiText,
  locale: string,
): PlaybookWindowBundle {
  setUiText(table, locale)
  const window = createWindow({
    ...deps,
    startWorker:
      deps.startWorker ??
      ((file, data) =>
        new Worker(file, { workerData: data, env: withoutCredentials(process.env) })),
  })
  return {
    ...window,
    panel: createPlaybookPanel(window, deps.workspaceRoot !== undefined),
    conversation: (host) => createPlaybookConversation(window, deps.ui, host),
    admit: playbookAdmission(window),
    answerBundle: () => ({
      parsePlaybookCommand,
      createPlaybookSurface: () => window.surface,
      runPlaybookCommand,
      runPlaybookCli,
    }),
  }
}

// Started as the worker: the data names this bundle's own role.
const started = playbookWorkerDataSchema.safeParse(workerData)
if (parentPort != null && started.success) servePlaybook(parentPort, started.data)
