// The playbook's worker thread (M116, lane C-M116-6): the governor, driven by
// validated requests from its window. The policy's synchronous work (durable
// journal writes, git plumbing, the repository's hooks) happens here, so the
// extension host never waits on it.
//
// Every failure answers its request: the policy's refusal with its why-note,
// anything else with `unavailable`. Nothing is allowed by default.

import { EN, type UiText } from '../../shared/l10n/en'
import { tableProblems } from '../../shared/l10n/check'
import { setUiText, UI_TEXT } from '../../shared/l10n/text'
import { playbookWhyNoteSchema, type PlaybookWhyNote } from '../../shared/playbook'
import type { PlaybookHookAdmission } from '../../core/orchestration/playbook/outcomes'
import { PanelGovernor } from '../../runtime/playbook/governor'
import { ContainedJob } from './containedJob'
import {
  toPlaybookWorkerSchema,
  type FromPlaybookWorker,
  type PlaybookWorkerData,
  type ToPlaybookWorker,
} from './workerProtocol'

/** The worker's side of its port (`parentPort`, or a test's). */
export interface PlaybookWorkerPort {
  postMessage(message: FromPlaybookWorker): void
  on(event: 'message', listener: (raw: unknown) => void): unknown
}

type DispatchStep = 'effect' | 'completion'

function isUiText(table: unknown, locale: string): table is UiText {
  return tableProblems(EN, table, { locale, isStrict: false }).length === 0
}

/** Whether the policy refused: its note is what the window is told. */
function isRefusal(error: unknown): boolean {
  return refusalNote(error) !== undefined
}

/** Whether a failed look at a folder says the folder is not there, and nothing else. */
function isAbsent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/**
Whether the request is answered in place: the policy refused (with its
why-note), or a folder it needed is not there (as unavailable). Anything
else ends the worker, whose crash refuses every request it owed.
*/
function isAnswerable(error: unknown): boolean {
  return isRefusal(error) || isAbsent(error)
}

/** A refusal is identified structurally: its note is what the window is told. */
function refusalNote(error: unknown): PlaybookWhyNote | undefined {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('name' in error) ||
    error.name !== 'PlaybookRefusedError' ||
    !('note' in error)
  )
    return undefined
  const note = playbookWhyNoteSchema.safeParse(error.note)
  return note.success ? note.data : undefined
}

/** The id of a request this build could not read, when it carried one. */
function requestId(raw: unknown): number | undefined {
  return typeof raw === 'object' &&
    raw !== null &&
    'id' in raw &&
    typeof raw.id === 'number' &&
    Number.isSafeInteger(raw.id) &&
    raw.id > 0
    ? raw.id
    : undefined
}

/** Serves one window until its thread ends. */
export function servePlaybook(port: PlaybookWorkerPort, data: PlaybookWorkerData): void {
  if (isUiText(data.table, data.locale)) setUiText(data.table, data.locale)
  const send = (message: FromPlaybookWorker): void => {
    port.postMessage(message)
  }
  /** The request whose synchronous part is running: its notes are its own. */
  let current: number | undefined
  const contained =
    process.platform === 'win32' && data.assemblyPath !== undefined && data.systemRoot !== undefined
      ? new ContainedJob({
          assemblyPath: data.assemblyPath,
          systemRoot: data.systemRoot,
          onJob: (names) => {
            send({ type: 'job', names: [...names] })
          },
        })
      : undefined
  const hookAdmission: PlaybookHookAdmission = {
    // The window admits only a trusted workspace's rounds; each contained
    // call is reported first, so a long hook is never taken for a stuck worker.
    admit: () => {
      send({ type: 'alive' })
      return true
    },
    ...(contained !== undefined && {
      runContained: (effect, options) => contained.run(effect, options),
    }),
  }
  let governor: PanelGovernor | undefined
  const governed = (): PanelGovernor => {
    governor ??= new PanelGovernor({
      agentDataFolder: data.agentDataFolder,
      workspaceFolder: data.workspaceFolder,
      hookAdmission,
      events: {
        note: (sessionId, note) => {
          send({
            type: 'note',
            sessionId,
            ...(current !== undefined && { request: current }),
            note,
          })
        },
        offerRedesign: (sessionId, module) => {
          send({ type: 'offer', sessionId, moduleId: module.id, moduleKey: module.key })
        },
        hookOutput: (sessionId, output) => {
          send({ type: 'hookOutput', sessionId, output })
        },
        failure: (sessionId) => {
          send({ type: 'failure', sessionId })
        },
      },
    })
    return governor
  }
  const failed = (id: number, error: unknown): void => {
    const note = refusalNote(error)
    send(note === undefined ? { type: 'unavailable', id } : { type: 'refused', id, note })
  }
  /** Runs a request's synchronous part as that request, then answers when its work settles. */
  const answer = (id: number, run: () => unknown): void => {
    let running: unknown
    current = id
    try {
      running = run()
    } catch (error: unknown) {
      if (!isAnswerable(error)) throw error
      failed(id, error)
      return
    } finally {
      current = undefined
    }
    void (async () => {
      try {
        send({ type: 'result', id, value: await running })
      } catch (error: unknown) {
        if (!isAnswerable(error)) throw error
        failed(id, error)
      }
    })()
  }
  /** What the window's answer to a dispatch's callback settles, by dispatch and step. */
  const steps = new Map<string, (isOk: boolean) => void>()
  const step = async (id: number, name: DispatchStep): Promise<void> => {
    const key = `${String(id)}:${name}`
    try {
      // Not `Promise.withResolvers`, which Node 20 (VS Code 1.99's host) lacks.
      await new Promise<void>((resolve, reject) => {
        steps.set(key, (isOk) => {
          if (isOk) resolve()
          else reject(new Error(UI_TEXT.playbookUnavailable))
        })
        send({ type: name, dispatch: id })
      })
    } finally {
      steps.delete(key)
    }
  }
  const handle = (message: ToPlaybookWorker): void => {
    switch (message.type) {
      case 'read': {
        answer(message.id, () => governed().read())
        break
      }
      case 'change': {
        answer(message.id, () => governed().change(message.change))
        break
      }
      case 'agents': {
        answer(message.id, () => governed().agentRecords(message.children))
        break
      }
      case 'standing': {
        answer(message.id, () => governed().standing(message.sessionId))
        break
      }
      case 'reviewOpen': {
        answer(message.id, () =>
          governed().openReview(
            message.reviewId,
            message.sessionId,
            message.files,
            message.children,
          ),
        )
        break
      }
      case 'reviewObserve': {
        answer(message.id, () => governed().observeReview(message.reviewId, message.event))
        break
      }
      case 'reviewBind': {
        answer(message.id, () => governed().bindReview(message.reviewId, message.turnId))
        break
      }
      case 'reviewCancel': {
        answer(message.id, () => {
          governed().cancelReview(message.reviewId)
          return { ok: true }
        })
        break
      }
      case 'dispatch': {
        const { id } = message
        answer(id, () =>
          governed().dispatch(
            {
              kind: message.kind,
              sessionId: message.sessionId,
              targetId: message.targetId,
              isTrusted: message.isTrusted,
            },
            {
              effect: () => step(id, 'effect'),
              completion: async (signal) => {
                signal.addEventListener(
                  'abort',
                  () => {
                    send({ type: 'abort', dispatch: id })
                  },
                  { once: true },
                )
                await step(id, 'completion')
              },
            },
          ),
        )
        break
      }
      case 'effectDone': {
        steps.get(`${String(message.dispatch)}:effect`)?.(message.ok)
        break
      }
      case 'completionDone': {
        steps.get(`${String(message.dispatch)}:completion`)?.(message.ok)
        break
      }
      case 'answer': {
        answer(message.id, () => ({
          ok: governed().answer(message.sessionId, message.moduleId, message.answers),
        }))
        break
      }
      case 'design': {
        answer(message.id, () => ({
          ok: governed().recordDesign(message.sessionId, message.moduleId, message.fields),
        }))
        break
      }
    }
  }
  port.on('message', (raw) => {
    const parsed = toPlaybookWorkerSchema.safeParse(raw)
    if (parsed.success) {
      handle(parsed.data)
      return
    }
    // A request this build cannot read is never guessed at; one with an id is answered.
    const id = requestId(raw)
    if (id !== undefined) send({ type: 'unavailable', id })
  })
}
