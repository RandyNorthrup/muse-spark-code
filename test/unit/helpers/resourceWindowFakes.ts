// M107 U–C1/W: shared fakes for the window resource adapter's suites: the
// loaded governor host with a scripted status, admission.ts's attach/load pair
// over it, and the slice of VS Code's namespace the adapter takes.
import { vi } from 'vitest'
import type { ResourceWindowHost } from '../../../src/core/resources/admission'
import { resourceStatusSchema, type ResourceStatus } from '../../../src/shared/resources'

export function fakeStatus(level: ResourceStatus['level'], isEnabled = true): ResourceStatus {
  return resourceStatusSchema.parse({
    level,
    settings: { enabled: isEnabled },
    sample: null,
    queued: [],
    overrideUntilMs: level === 'normal' && isEnabled ? 1000 : null,
    relocation: 'noRoute',
  })
}

/** The loaded governor host. Its port reads `status`; `change` replaces and announces it. */
export function fakeWindowHost(initial: ResourceStatus) {
  let status = initial
  const listeners = new Set<() => void>()
  const statusItem = { update: vi.fn(), show: vi.fn(), hide: vi.fn(), dispose: vi.fn() }
  const createStatus = vi.fn<ResourceWindowHost['createStatus']>(() => ({
    dispose: statusItem.dispose,
  }))
  const port = {
    status: vi.fn(() => status),
    subscribe: vi.fn((changed: () => void) => {
      listeners.add(changed)
      return () => {
        listeners.delete(changed)
      }
    }),
    resume: vi.fn(() => {
      status = fakeStatus('normal', status.settings.enabled)
      return status
    }),
    refreshStatus: vi.fn(() => Promise.resolve(status)),
    settingsChanged: vi.fn(),
  }
  const window: ResourceWindowHost = {
    port,
    createStatus,
    createVsCodeItem: vi.fn(() => statusItem),
  }
  return {
    window,
    port,
    statusItem,
    createStatus,
    listeners,
    change: (next: ResourceStatus) => {
      status = next
      for (const listener of listeners) listener()
    },
  }
}

/** admission.ts's pair: `onLoad` keeps the attacher, `load` attaches `window` and returns it. */
export function fakeAdmission(window: ResourceWindowHost) {
  let attach: ((loaded: ResourceWindowHost) => void) | undefined
  return {
    onLoad: (attacher: (loaded: ResourceWindowHost) => void) => {
      attach = attacher
      return () => {
        attach = undefined
      }
    },
    load: () => {
      attach?.(window)
      return Promise.resolve(window)
    },
    /** The host loads for a governed spawn, not a command. */
    attach: () => attach?.(window),
  }
}

/** The VS Code slice the adapter takes; `configure` reports a configuration change. */
export function fakeResourceVscode() {
  let configuration:
    ((event: { affectsConfiguration(section: string): boolean }) => void) | undefined
  const vscode = {
    window: {
      createStatusBarItem: vi.fn(),
      showInformationMessage: vi.fn((_message: string, ..._items: string[]) =>
        Promise.resolve<string | undefined>(undefined),
      ),
      showWarningMessage: vi.fn((_message: string, ..._items: string[]) =>
        Promise.resolve<string | undefined>(undefined),
      ),
    },
    commands: { executeCommand: vi.fn(() => Promise.resolve()) },
    workspace: {
      onDidChangeConfiguration: vi.fn(
        (listener: (event: { affectsConfiguration(section: string): boolean }) => void) => {
          configuration = listener
          return { dispose: vi.fn() }
        },
      ),
    },
    StatusBarAlignment: { Left: 1 },
    ThemeColor: class {
      public constructor(public readonly id: string) {}
    },
  }
  return {
    vscode,
    configure: (section: string) => {
      configuration?.({ affectsConfiguration: (name) => section.startsWith(name) })
    },
  }
}
