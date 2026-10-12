// A VS Code window's playbook (M116, lane C-M116-6): the client of the
// worker thread the governor runs on. Everything the window asks is a
// validated request with a validated answer; the worker starts on the first
// request and ends with the window.
//
// Nothing here allows by default. A worker that crashes, or says nothing for
// too long while it owes an answer, is ended and every request it owed is
// refused as unavailable; the log names which of the two it was. A dispatch
// whose work already started is then reported to its conversation as not
// certified, never as passed.
//
// A machine that has no playbook journal at all is not asked about a
// dispatch: no worker starts, and the dispatch runs as it always did. Only
// a journal folder that is confirmed absent takes that path; one that cannot
// be looked at refuses. A review is the playbook's only when the one shared
// classification says a child of the conversation changed a reviewed file.

import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import path from 'node:path'
import type * as z from 'zod/mini'
import type { AgentEvent } from '../../shared/agentEvents'
import {
  PLAYBOOK_RECORD_FOLDER,
  PLAYBOOK_WORKER_KIND,
  PLAYBOOK_WORKER_SILENCE_MS,
  REVIEW_FINDINGS_LANGUAGE,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
} from '../../shared/constants'
import { UI_TEXT, uiLocale } from '../../shared/l10n/text'
import type { PlaybookRecord, PlaybookWhyNote } from '../../shared/playbook'
import type { TurnPart } from '../../core/agent/agentBackend'
import {
  reviewedChanges,
  type PanelChild,
  type RealPath,
} from '../../core/orchestration/panelLanes'
import type {
  PanelAnswer,
  PanelDesignFields,
  PanelModuleSummary,
  PanelReviewTarget,
} from '../../runtime/playbook/governor'
import type { PlaybookChange, PlaybookSurfacePort } from '../../runtime/playbook/command'
import type { PlaybookAgentRef } from '../../runtime/playbook/panelWire'
import type { Logger } from '../logger'
import { runProgram, windowsPowerShell } from '../processTree'
import { endJobScript } from './containedJob'
import {
  fromPlaybookWorkerSchema,
  playbookResultSchemas,
  type FromPlaybookWorker,
  type PlaybookDispatchKind,
  type PlaybookReviewEvent,
  type PlaybookWorkerData,
  type ToPlaybookWorker,
} from './workerProtocol'

const AGENT_MESSAGE_KIND = 'agentMessage'
const COMPLETED = 'completed'
const REVIEW_FENCE = `\`\`\`${REVIEW_FINDINGS_LANGUAGE}`
const ORDINARY = { kind: 'ordinary' } as const

/** The worker as the window drives it (`Worker`, or a test's). */
export interface PlaybookWorkerHandle {
  postMessage(message: ToPlaybookWorker): void
  on(event: 'message' | 'error' | 'exit', listener: (value: unknown) => void): unknown
  terminate(): Promise<unknown>
}

export type StartPlaybookWorker = (file: string, data: PlaybookWorkerData) => PlaybookWorkerHandle

export interface PlaybookWindowDeps {
  /** dist/playbook.js: this bundle, started again as the worker. */
  readonly bundlePath: string
  readonly startWorker: StartPlaybookWorker
  /** The machine's agent data folder: the journal the CLI and ACP agent read too. */
  readonly agentDataFolder: string
  /** No open folder: no journal, and every request is unavailable. */
  readonly workspaceRoot: string | undefined
  /** Restricted Mode runs no git and no repository hook: a governed round refuses. */
  readonly isWorkspaceTrusted: () => boolean
  readonly platform: NodeJS.Platform
  readonly systemRoot: string | undefined
  /** Windows: the compiled job type (`shellJob.ts`); undefined where it cannot be made. */
  readonly shellJobAssembly: (() => Promise<string | undefined>) | undefined
  /** The reviewer charter for a playbook review, from its own lazily read bundle. */
  readonly reviewCharter: (targets: readonly PanelReviewTarget[]) => string
  readonly log: Logger
  readonly silenceMs?: number
  /** Ends a stopped worker's contained job by name, rejecting unless it was seen over; a test stands in its own. */
  readonly endJob?: (name: string, assembly: string, systemRoot: string) => Promise<void>
  /** Looks at the journal folder (`fs.access`); a test stands in a failing disk. */
  readonly access?: (folder: string) => Promise<void>
  /** Resolves a reviewed or changed path (`realpath.native`); a test stands in a failing disk. */
  readonly realPath?: RealPath
}

/** The policy refused, and said why. */
export class PlaybookRefusal extends Error {
  constructor(readonly note: PlaybookWhyNote) {
    super(UI_TEXT.playbookUnavailable)
    this.name = 'PlaybookRefusal'
  }
}

/** What a conversation is told as its playbook decides. */
export interface PlaybookConversationEvents {
  /** A why-note; `itemId` when the decision was about that tool row. */
  note(note: PlaybookWhyNote, itemId: string | undefined): void
  /** The playbook calls for a redesign of this module. */
  offer(moduleId: string, moduleKey: string): void
  /** Rounds a review of this conversation's counted. */
  rounds(rounds: readonly PanelModuleSummary[]): void
  hookOutput(output: string): void
  /** Something of this conversation's could not be certified. */
  failure(): void
}

/** A playbook review of one turn: what the controller's review path drives. */
export interface PlaybookWindowReview {
  readonly isClosed: boolean
  parts(parts: readonly TurnPart[]): readonly TurnPart[]
  observe(event: AgentEvent): void
  bind(turnId: string): void
  cancel(): void
}

export interface PlaybookDispatch {
  readonly kind: PlaybookDispatchKind
  readonly sessionId: string
  readonly targetId: string | undefined
  /** The tool row this dispatch is, when it is one: its notes go there. */
  readonly itemId?: string | undefined
}

export interface PlaybookWindow {
  /** The journal's settings and record, for the panel's page and `/playbook`. */
  readonly surface: PlaybookSurfacePort
  agents(children: readonly PlaybookAgentRef[]): Promise<Record<string, PlaybookRecord[]>>
  standing(sessionId: string): Promise<PanelModuleSummary[]>
  /** Undefined: an ordinary review, to be sent exactly as it is. */
  openReview(
    sessionId: string,
    files: readonly string[],
    children: readonly PanelChild[],
  ): Promise<PlaybookWindowReview | undefined>
  /**
   * Runs `effect` once every admission passed (or at once, when the dispatch
   * is not the playbook's) and resolves with what it returned. `completion`
   * then waits for the child's own end before the outcome is verified.
   */
  dispatch<T>(
    request: PlaybookDispatch,
    effect: () => Promise<T>,
    completion: (submission: T, signal: AbortSignal) => Promise<void>,
  ): Promise<T>
  answer(sessionId: string, moduleId: string, answers: readonly PanelAnswer[]): Promise<boolean>
  recordDesign(sessionId: string, moduleId: string, fields: PanelDesignFields): Promise<boolean>
  subscribe(sessionId: string, events: PlaybookConversationEvents): () => void
  dispose(): void
}

interface Pending {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
}

/** A governed dispatch's two callbacks, as the worker asks for them, and its stop. */
interface DispatchHandlers {
  readonly effect: () => Promise<boolean>
  readonly completion: () => Promise<boolean>
  readonly abort: () => void
}

/** Ends a job by name; rejects unless it was seen empty or gone. */
async function endJobByName(name: string, assembly: string, systemRoot: string): Promise<void> {
  const powershell = windowsPowerShell(systemRoot)
  await runProgram(
    powershell.file,
    [...WINDOWS_POWERSHELL_COMMAND_ARGS, endJobScript(assembly, name)],
    powershell.env,
  )
}

/** Whether a failed look at a folder says the folder is not there, and nothing else. */
function isAbsent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function unavailable(): Error {
  return new Error(UI_TEXT.playbookUnavailable)
}

function failure(error: unknown): Error {
  return error instanceof Error ? error : unavailable()
}

/** The review's reply and the turn's end are all a review is settled by. */
function reviewEvent(event: AgentEvent): PlaybookReviewEvent | undefined {
  if (event.type === 'turnCompleted')
    return { type: 'turnCompleted', turnId: event.turnId, terminal: event.terminal }
  if (
    event.type !== 'itemCompleted' ||
    event.item.kind !== AGENT_MESSAGE_KIND ||
    event.item.status !== COMPLETED ||
    event.item.text?.includes(REVIEW_FENCE) !== true
  )
    return undefined
  const { itemId, kind, status, turnId, text } = event.item
  return {
    type: 'itemCompleted',
    item: { itemId, kind, status, text, ...(turnId !== undefined && { turnId }) },
  }
}

export function createPlaybookWindow(deps: PlaybookWindowDeps): PlaybookWindow {
  const silenceMs = deps.silenceMs ?? PLAYBOOK_WORKER_SILENCE_MS
  const pending = new Map<number, Pending>()
  const dispatches = new Map<number, DispatchHandlers>()
  const subscribers = new Map<string, Set<PlaybookConversationEvents>>()
  /** Requests whose answer the worker owes right now: silence while any is here is a fault. */
  const owed = new Set<number>()
  /** Which tool row a request's notes belong to. */
  const rows = new Map<number, string>()
  let sequence = 0
  let starting: Promise<PlaybookWorkerHandle> | undefined
  let live: PlaybookWorkerHandle | undefined
  let assembly: string | undefined
  /** Jobs whose end the live worker has not seen. */
  let jobs: readonly string[] = []
  /**
   * Jobs a stopped worker left, each with the job type that can end it. They
   * are this window's own: a name leaves only when its end was seen, and an
   * end that failed is tried again before the next work and as the window
   * closes.
   */
  const unended = new Map<string, string | undefined>()
  let ending: Promise<void> | undefined
  let watchdog: ReturnType<typeof setTimeout> | undefined
  let isDisposed = false

  const told = (sessionId: string, tell: (events: PlaybookConversationEvents) => void): void => {
    const listeners = subscribers.get(sessionId) ?? []
    for (const events of listeners) tell(events)
  }

  /** One try at every job a stopped worker left: a name leaves only when its end was seen. */
  const endPass = async (): Promise<void> => {
    for (const [name, compiled] of unended) {
      try {
        // A job with nothing that can end it stays listed, and is said so as the window closes.
        if (compiled === undefined || deps.systemRoot === undefined) throw unavailable()
        await (deps.endJob ?? endJobByName)(name, compiled, deps.systemRoot)
        unended.delete(name)
      } catch {
        deps.log.warn(
          'A playbook job was not seen to end when it was ended by name; it is tried again',
        )
      }
    }
  }

  /** Ends, by name, the jobs a stopped worker left; one pass at a time, shared by all who wait on it. */
  const endUnended = async (): Promise<void> => {
    ending ??= endPass()
    const pass = ending
    try {
      await pass
    } finally {
      // The next one who asks starts a pass of its own.
      if (ending === pass) ending = undefined
    }
  }

  /** The window's last try at the jobs it still owns; what it could not end is said. */
  const endAtClose = async (): Promise<void> => {
    await endUnended()
    if (unended.size > 0)
      deps.log.error(
        `The window closed with ${String(unended.size)} playbook job(s) whose end was not seen`,
      )
  }

  const terminate = async (handle: PlaybookWorkerHandle): Promise<void> => {
    try {
      await handle.terminate()
    } catch {
      deps.log.warn('The playbook worker could not be terminated')
    }
  }

  /** Ends the worker; every request it owed is refused. `fault` says what went wrong, if anything did. */
  const stop = (handle: PlaybookWorkerHandle, fault: string | undefined): void => {
    if (live !== handle) return
    if (fault !== undefined)
      deps.log.error(`The playbook worker ${fault}; its pending requests are refused`)
    if (watchdog !== undefined) clearTimeout(watchdog)
    watchdog = undefined
    live = undefined
    starting = undefined
    owed.clear()
    rows.clear()
    const waiting = Array.from(pending, ([, request]) => request)
    pending.clear()
    // Work that was admitted and is still running is told to stop: nothing is left to certify it.
    const running = Array.from(dispatches, ([, handlers]) => handlers)
    dispatches.clear()
    for (const handlers of running) handlers.abort()
    for (const request of waiting) request.reject(unavailable())
    // Every job the worker had not seen end is this window's to end, by name,
    // and stays its own until that end was seen.
    for (const name of jobs) unended.set(name, assembly)
    jobs = []
    void endUnended()
    void terminate(handle)
  }

  const watch = (handle: PlaybookWorkerHandle): void => {
    if (watchdog !== undefined) clearTimeout(watchdog)
    watchdog = undefined
    if (live !== handle || owed.size === 0) return
    watchdog = setTimeout(() => {
      stop(handle, 'said nothing while it owed an answer')
    }, silenceMs)
    watchdog.unref()
  }

  const start = async (): Promise<PlaybookWorkerHandle> => {
    const { workspaceRoot } = deps
    if (workspaceRoot === undefined) throw unavailable()
    const compiled = deps.platform === 'win32' ? await deps.shellJobAssembly?.() : undefined
    // The window may have closed while the job type was being prepared.
    if (isDisposed) throw unavailable()
    assembly = compiled
    if (compiled === undefined && deps.platform === 'win32')
      deps.log.warn(
        'Windows job objects are unavailable, so the playbook refuses every git and hook call',
      )
    const handle = deps.startWorker(deps.bundlePath, {
      kind: PLAYBOOK_WORKER_KIND,
      agentDataFolder: deps.agentDataFolder,
      workspaceFolder: workspaceRoot,
      ...(compiled !== undefined &&
        deps.systemRoot !== undefined && { assemblyPath: compiled, systemRoot: deps.systemRoot }),
      table: UI_TEXT,
      locale: uiLocale(),
    })
    live = handle
    handle.on('message', (raw) => {
      if (live !== handle) return
      const parsed = fromPlaybookWorkerSchema.safeParse(raw)
      // A worker that speaks outside the protocol cannot be believed about anything.
      if (!parsed.success) {
        stop(handle, 'sent a message outside its protocol')
        return
      }
      receive(parsed.data)
      watch(handle)
    })
    handle.on('error', () => {
      stop(handle, 'crashed')
    })
    handle.on('exit', () => {
      stop(handle, 'exited')
    })
    return handle
  }

  const post = async (message: ToPlaybookWorker): Promise<void> => {
    starting ??= start()
    const attempt = starting
    let handle: PlaybookWorkerHandle
    try {
      handle = await attempt
    } catch (error) {
      if (starting === attempt) starting = undefined
      throw error
    }
    handle.postMessage(message)
    watch(handle)
  }

  /** Answers a dispatch's callback: from now the worker owes the next word. */
  const stepDone = async (
    dispatch: number,
    type: 'effectDone' | 'completionDone',
    isOk: boolean,
  ): Promise<void> => {
    owed.add(dispatch)
    try {
      await post({ type, dispatch, ok: isOk })
    } catch {
      owed.delete(dispatch)
    }
  }

  const stepped = async (dispatch: number, name: 'effect' | 'completion'): Promise<void> => {
    // The window's turn: the worker owes nothing until it is answered.
    owed.delete(dispatch)
    const handlers = dispatches.get(dispatch)
    if (handlers !== undefined) await stepDone(dispatch, `${name}Done`, await handlers[name]())
  }

  function receive(message: FromPlaybookWorker): void {
    switch (message.type) {
      case 'result':
      case 'refused':
      case 'unavailable': {
        const request = pending.get(message.id)
        pending.delete(message.id)
        owed.delete(message.id)
        rows.delete(message.id)
        if (message.type === 'result') request?.resolve(message.value)
        else
          request?.reject(
            message.type === 'refused' ? new PlaybookRefusal(message.note) : unavailable(),
          )
        break
      }
      case 'effect':
      case 'completion': {
        void stepped(message.dispatch, message.type)
        break
      }
      case 'abort': {
        dispatches.get(message.dispatch)?.abort()
        break
      }
      case 'note': {
        const itemId = message.request === undefined ? undefined : rows.get(message.request)
        told(message.sessionId, (events) => {
          events.note(message.note, itemId)
        })
        break
      }
      case 'offer': {
        told(message.sessionId, (events) => {
          events.offer(message.moduleId, message.moduleKey)
        })
        break
      }
      case 'hookOutput': {
        told(message.sessionId, (events) => {
          events.hookOutput(message.output)
        })
        break
      }
      case 'failure': {
        told(message.sessionId, (events) => {
          events.failure()
        })
        break
      }
      case 'job': {
        jobs = message.names
        break
      }
      case 'alive': {
        break
      }
    }
  }

  /** One request and its validated answer; `build` is given the request's id. */
  const ask = async <S extends z.ZodMiniType>(
    schema: S,
    build: (id: number) => ToPlaybookWorker,
    itemId?: string,
  ): Promise<z.infer<S>> => {
    // A stopped worker's jobs come before any new work: ended, or tried again.
    if (unended.size > 0) await endUnended()
    sequence += 1
    const id = sequence
    const answered = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject })
    })
    owed.add(id)
    if (itemId !== undefined) rows.set(id, itemId)
    try {
      await post(build(id))
    } catch (error) {
      pending.delete(id)
      owed.delete(id)
      rows.delete(id)
      throw failure(error)
    }
    const parsed = schema.safeParse(await answered)
    if (!parsed.success) throw unavailable()
    return parsed.data
  }

  /** After every await that an effect follows: a window that has closed starts nothing. */
  const open = (): void => {
    if (isDisposed) throw unavailable()
  }

  /**
   * Whether this machine has a journal folder. Only a folder that is not
   * there says no; one that cannot be looked at may hold a journal, so the
   * request that asked is refused.
   */
  const hasJournals = async (): Promise<boolean> => {
    try {
      await (deps.access ?? access)(path.join(deps.agentDataFolder, PLAYBOOK_RECORD_FOLDER))
      return true
    } catch (error) {
      if (isAbsent(error)) return false
      deps.log.error('The playbook journal folder could not be read; the request is refused')
      throw unavailable()
    }
  }

  const review = (
    sessionId: string,
    reviewId: string,
    targets: readonly PanelReviewTarget[],
  ): PlaybookWindowReview => {
    let isClosed = false
    const progressed = async (build: (id: number) => ToPlaybookWorker): Promise<void> => {
      try {
        const progress = await ask(playbookResultSchemas.reviewProgress, build)
        if (isClosed || !progress.isClosed) return
        isClosed = true
        if (progress.rounds.length > 0)
          told(sessionId, (events) => {
            events.rounds(progress.rounds)
          })
      } catch {
        // Its why-note, when the policy refused, was already told.
        if (isClosed) return
        isClosed = true
        told(sessionId, (events) => {
          events.failure()
        })
      }
    }
    const released = async (): Promise<void> => {
      try {
        await ask(playbookResultSchemas.done, (id) => ({ type: 'reviewCancel', id, reviewId }))
      } catch {
        deps.log.warn('A cancelled playbook review could not be released; its lease expires')
      }
    }
    return {
      get isClosed() {
        return isClosed
      },
      parts: (parts) => [...parts, { type: 'text', text: deps.reviewCharter(targets) }],
      observe: (event) => {
        const forwarded = isClosed ? undefined : reviewEvent(event)
        if (forwarded !== undefined)
          void progressed((id) => ({ type: 'reviewObserve', id, reviewId, event: forwarded }))
      },
      bind: (turnId) => {
        if (!isClosed) void progressed((id) => ({ type: 'reviewBind', id, reviewId, turnId }))
      },
      cancel: () => {
        if (isClosed) return
        isClosed = true
        void released()
      },
    }
  }

  const governed = async <T>(
    request: PlaybookDispatch,
    effect: () => Promise<T>,
    completion: (submission: T, signal: AbortSignal) => Promise<void>,
  ): Promise<T> => {
    const controller = new AbortController()
    let dispatch = 0
    // Not `Promise.withResolvers`, which Node 20 (VS Code 1.99's host) lacks.
    let submitted: { readonly value: T } | { readonly error: Error } | undefined
    const started = new Promise<void>((resolve) => {
      const handlers: DispatchHandlers = {
        effect: async () => {
          try {
            submitted = { value: await effect() }
          } catch (error) {
            submitted = { error: failure(error) }
          }
          resolve()
          return 'value' in submitted
        },
        completion: async () => {
          if (submitted === undefined || !('value' in submitted)) return false
          try {
            await completion(submitted.value, controller.signal)
            return true
          } catch {
            return false
          }
        },
        abort: () => {
          controller.abort()
        },
      }
      const finished = async (): Promise<void> => {
        try {
          const outcome = await ask(
            playbookResultSchemas.dispatch,
            (id) => {
              dispatch = id
              dispatches.set(id, handlers)
              return {
                type: 'dispatch',
                id,
                kind: request.kind,
                sessionId: request.sessionId,
                ...(request.targetId !== undefined && { targetId: request.targetId }),
                isTrusted: deps.isWorkspaceTrusted(),
              }
            },
            request.itemId,
          )
          // Not the playbook's: it runs exactly as it always did.
          if (outcome === 'ungoverned') {
            open()
            await handlers.effect()
          }
        } catch (error) {
          // Before the work started, the refusal is the dispatch's own answer.
          // After it, the work ran and could not be certified: its conversation is told.
          if (submitted === undefined) submitted = { error: failure(error) }
          else if ('value' in submitted)
            told(request.sessionId, (events) => {
              events.failure()
            })
        } finally {
          dispatches.delete(dispatch)
          resolve()
        }
      }
      void finished()
    })
    await started
    if (submitted === undefined) throw unavailable()
    if ('error' in submitted) throw submitted.error
    return submitted.value
  }

  return {
    surface: {
      read: () => ask(playbookResultSchemas.snapshot, (id) => ({ type: 'read', id })),
      change: (change: PlaybookChange) =>
        ask(playbookResultSchemas.snapshot, (id) => ({ type: 'change', id, change })),
    },
    agents: async (children) =>
      // No rows, or no journal on this machine: nothing to read, and no worker for it.
      children.length > 0 && (await hasJournals())
        ? await ask(playbookResultSchemas.agents, (id) => ({
            type: 'agents',
            id,
            children: [...children],
          }))
        : {},
    standing: async (sessionId) =>
      // No journal on this machine: nothing is under review, and no worker says so.
      (await hasJournals())
        ? await ask(playbookResultSchemas.standing, (id) => ({ type: 'standing', id, sessionId }))
        : [],
    openReview: async (sessionId, files, children) => {
      // The governor's own classification, before any worker or journal read:
      // a blocked contribution is always counted, from the child records
      // (a blocked child exists), never from some readable child file
      // matching; otherwise no reviewed file is a child's, and the review
      // is an ordinary one. A path that cannot be read is neither: that
      // throws here, with its reason, and the review is not sent.
      const hasBlocked = children.some(
        (child) => child.sessionId !== sessionId && child.blocked !== undefined,
      )
      const isOrchestrated =
        deps.workspaceRoot !== undefined &&
        (hasBlocked ||
          reviewedChanges(deps.workspaceRoot, sessionId, files, children, deps.realPath).length > 0)
      if (isOrchestrated && !deps.isWorkspaceTrusted()) throw unavailable()
      const reviewId = randomUUID()
      const opening = isOrchestrated
        ? await ask(playbookResultSchemas.reviewOpening, (id) => ({
            type: 'reviewOpen',
            id,
            reviewId,
            sessionId,
            files: [...files],
            children: children.map((child) => ({ ...child, files: [...child.files] })),
          }))
        : ORDINARY
      return opening.kind === 'ordinary' ? undefined : review(sessionId, reviewId, opening.modules)
    },
    dispatch: async (request, effect, completion) => {
      const isJournalled = await hasJournals()
      open()
      // No journal on this machine: nothing was ever reviewed here, so nothing is governed.
      return isJournalled ? await governed(request, effect, completion) : await effect()
    },
    answer: async (sessionId, moduleId, answers) => {
      const done = await ask(playbookResultSchemas.done, (id) => ({
        type: 'answer',
        id,
        sessionId,
        moduleId,
        answers: [...answers],
      }))
      return done.ok
    },
    recordDesign: async (sessionId, moduleId, fields) => {
      const done = await ask(playbookResultSchemas.done, (id) => ({
        type: 'design',
        id,
        sessionId,
        moduleId,
        fields,
      }))
      return done.ok
    },
    subscribe: (sessionId, events) => {
      const set = subscribers.get(sessionId) ?? new Set()
      subscribers.set(sessionId, set)
      set.add(events)
      return () => {
        set.delete(events)
        if (set.size === 0) subscribers.delete(sessionId)
      }
    },
    dispose: () => {
      isDisposed = true
      if (live !== undefined) stop(live, undefined)
      // The last try for every job still listed, and what could not be ended is said.
      void endAtClose()
    },
  }
}
