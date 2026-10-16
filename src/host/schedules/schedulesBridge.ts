import { Usd } from '../../shared/usd'
// The VS Code side of scheduled prompts v2 (M115, PLAN.md D95): loads the
// lazy schedules bundle in the extension host and answers the panel's
// versioned channel over the same workspace control the CLI uses. The host
// supplies paid authority only after its complete delivery binding is certified;
// the engine enforces that authority, never the panel.
import path from 'node:path'
import { workspaceKey } from '../../runtime/dataFolder'
import { runtimeSchedulesBinding } from '../../runtime/schedules/binding'
import type { Logger } from '../logger'
import {
  COMMAND_IDS,
  SCHEDULE_PAID_CAP_DEFAULT_USD,
  MILLISECONDS_PER_HOUR,
  type SCHEDULE_DELIVERIES,
  UI_TEXT,
} from '../../shared/constants'
import type { ScheduleMigrationSource } from '../../core/schedules/migrate'
import type { ScheduleDraft, ScheduleTarget } from '../../shared/scheduleV2'
import type { ScheduleTargetChoice } from '../../webview/schedules/ports'
import type { ScheduleEditorDeliveryPorts } from './deliveryBinding'
import type { RuntimeSchedulesBinding } from '../../runtime/schedules/binding'

export interface SchedulesPanelSession {
  readonly sessionId: string
  readonly backend: 'museCode' | 'modelApi'
  readonly label: string
}

export interface SchedulesBridgeDeps {
  /** Installed only after every delivery/safety path is certified. */
  readonly delivery?: ScheduleEditorDeliveryPorts
  /** M52's v1 jobs migrate once per workspace; installed with delivery. */
  readonly migration?: { source: ScheduleMigrationSource; zone: string }
  readonly distDir: string
  readonly log: Logger
  readonly isEnabled: () => boolean
  readonly defaultDelivery: () => (typeof SCHEDULE_DELIVERIES)[number]
  readonly isDeliveryReady?: () => boolean
}

export type SchedulesBridge = ReturnType<typeof createSchedulesBridge>

/** The window holds its workspace even when no conversation surface exists. */
export function scheduleWindowWorkspace(
  bridge: Pick<SchedulesBridge, 'holdWorkspace' | 'isDeliveryEnabled'>,
  cwd: string | undefined,
  isActive: () => boolean,
  log: Logger,
) {
  let isClosed = false
  let holding: Promise<() => Promise<void>> | undefined
  const retire = () => {
    const prior = holding
    holding = undefined
    if (prior !== undefined)
      void prior
        .then((release) => release())
        .catch(() => {
          log.warn('Scheduled window workspace could not be released')
        })
  }
  return {
    refresh() {
      if (isClosed || cwd === undefined || !isActive() || !bridge.isDeliveryEnabled()) {
        retire()
        return
      }
      if (holding !== undefined) return
      const pending = bridge.holdWorkspace(cwd)
      holding = pending
      void pending.catch(() => {
        if (holding === pending) holding = undefined
        log.warn('Scheduled window workspace could not be held')
      })
    },
    dispose() {
      isClosed = true
      retire()
    },
  }
}

const targets = (session: SchedulesPanelSession | undefined): readonly ScheduleTargetChoice[] => {
  if (session === undefined) return []
  const target: ScheduleTarget = {
    kind: 'conversation',
    sessionId: session.sessionId,
    backend: session.backend,
  }
  return [
    { id: 'this-conversation', label: session.label, target, capability: { available: true } },
  ]
}
/** One bridge per window; the bundle loads on first schedule use. */
export function createSchedulesBridge(deps: SchedulesBridgeDeps) {
  const loadRuntime = runtimeSchedulesBinding(
    path.join(deps.distDir, 'schedules.js'),
    deps.log,
    undefined,
    deps.isDeliveryReady?.() === false ? undefined : deps.delivery,
    undefined,
    deps.isDeliveryReady?.() === false ? undefined : deps.migration,
  )
  let loaded: RuntimeSchedulesBinding | undefined
  let isClosed = false
  const hasClosed = () => isClosed
  const load = async () => {
    if (hasClosed()) throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
    loaded = await loadRuntime()
    if (hasClosed()) {
      await loaded.close()
      throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
    }
    return loaded
  }
  const isDeliveryEnabled = () =>
    deps.isEnabled() && deps.delivery !== undefined && deps.isDeliveryReady?.() !== false
  const keyFor = (cwd: string): string => workspaceKey(path.resolve(cwd))
  const defaultDraft = (
    nowMs: number,
    session: SchedulesPanelSession | undefined,
    backend: 'museCode' | 'modelApi',
  ): ScheduleDraft => {
    const choices = targets(session)
    const cap = Usd.from(
      (session?.backend ?? backend) === 'modelApi' && isDeliveryEnabled()
        ? SCHEDULE_PAID_CAP_DEFAULT_USD
        : 0,
    ).toAmount()
    // A valid template, not a blank: the wire schema and the prompt mapper
    // both refuse empty names and prompts, and the editor validates before
    // saving, so the user replaces this text.
    return {
      name: UI_TEXT.scheduleV2.editor.defaultName,
      action: { kind: 'prompt', prompt: UI_TEXT.scheduleV2.editor.defaultPrompt },
      trigger: { kind: 'once', atMs: nowMs + MILLISECONDS_PER_HOUR },
      target: choices[0]?.target ?? { kind: 'newConversation', backend },
      delivery: choices.length === 0 ? 'newConversation' : deps.defaultDelivery(),
      whenClosed: 'open',
      catchUp: 'runOnce',
      mode: 'manual',
      grant: { rules: [], destinationIds: [], paidCapUsd: cap },
      paidCapUsd: cap,
      parallel: false,
      zone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
      pinned: false,
    }
  }
  return {
    isDeliveryEnabled,
    close: () => {
      isClosed = true
      return loaded?.close() ?? Promise.resolve()
    },
    keyFor,
    targets,
    defaultDraft,
    async holdWorkspace(cwd: string): Promise<() => Promise<void>> {
      if (!isDeliveryEnabled()) throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
      const binding = await load()
      return await binding.holdWorkspace(path.resolve(cwd))
    },
    async message(input: unknown, cwd: string): Promise<unknown> {
      if (!deps.isEnabled()) throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
      const binding = await load()
      return await binding.message(input, cwd)
    },
  }
}

/** Activation registers commands now; the panel and engine still load on use. */
export function registerScheduleCommands<Surface extends object>(ports: {
  readonly register: (id: string, action: () => Promise<void>) => { dispose(): void }
  readonly active: () => Surface | undefined
  readonly isReady: (surface: Surface) => boolean
  readonly isEnabled: () => boolean
  readonly openConversation: () => Promise<void>
  readonly open: (surface: Surface, view: 'list' | 'timeline' | 'editor') => Promise<void>
}) {
  type View = 'list' | 'timeline' | 'editor'
  let coldView: View | undefined
  const pending = new WeakMap<Surface, View>()
  const commands = (
    [
      [COMMAND_IDS.schedulePrompt, 'editor'],
      [COMMAND_IDS.showSchedules, 'list'],
      [COMMAND_IDS.showScheduleTimeline, 'timeline'],
    ] as const
  ).map(([id, view]) =>
    ports.register(id, async () => {
      if (!ports.isEnabled()) throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
      const surface = ports.active()
      if (surface === undefined) {
        coldView = view
        try {
          await ports.openConversation()
        } catch (error: unknown) {
          coldView = undefined
          throw error
        }
      } else if (ports.isReady(surface)) await ports.open(surface, view)
      else pending.set(surface, view)
    }),
  )
  return {
    commands,
    async ready(surface: Surface): Promise<void> {
      const view = pending.get(surface) ?? coldView
      pending.delete(surface)
      coldView = undefined
      if (view !== undefined && ports.isEnabled()) await ports.open(surface, view)
    },
  }
}
