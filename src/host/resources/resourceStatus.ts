import type * as VSCode from 'vscode'
import { UI_TEXT } from '../../shared/constants'
import { fill, formatBytes, formatNumber, formatPercent } from '../../shared/l10n/text'
import {
  resourceMemoryFloorBytes,
  resourceStatusSchema,
  type ResourceStatus,
} from '../../shared/resources'
import type { ResourceSurfacePort } from '../../webview/resources/resourcePort'

export interface ResourceStatusItem {
  update(text: string, isWarning: boolean): void
  show(): void
  hide(): void
  dispose(): void
}

export interface ResourceStatusAction {
  readonly label: string
  run(): void
}

export interface ResourceStatusDeps {
  readonly port: ResourceSurfacePort
  readonly conversationId: () => string | undefined
  readonly notice: (text: string, actions: readonly ResourceStatusAction[]) => void
  readonly invalidStatus: () => void
  readonly createItem: () => ResourceStatusItem
  readonly registerShow: (run: () => void) => { dispose(): void }
}

/** Inject VS Code only in its window; native MHP hosts use their own item factory. */
export function createVsCodeResourceStatusItem(
  vscode: Pick<typeof VSCode, 'window' | 'StatusBarAlignment' | 'ThemeColor'>,
): ResourceStatusItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left)
  item.name = UI_TEXT.resourceTitle
  // W registers this command with the manifest/NLS entries at first governor load.
  item.command = 'museSpark.showResources'
  return {
    update: (text, warning) => {
      item.text = `$(dashboard) ${text}`
      item.tooltip = UI_TEXT.resourceShow
      item.backgroundColor = warning
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined
    },
    show: () => {
      item.show()
    },
    hide: () => {
      item.hide()
    },
    dispose: () => {
      item.dispose()
    },
  }
}

function levelLabel(status: ResourceStatus): string {
  const labels = {
    normal: UI_TEXT.resourceNormal,
    throttle: UI_TEXT.resourceThrottle,
    relocate: UI_TEXT.resourceRelocate,
    pause: UI_TEXT.resourcePause,
  }
  return labels[status.level]
}

function pauseText(status: ResourceStatus): string {
  const sample = status.sample
  const settings = status.settings
  let metric = UI_TEXT.resourceCpu
  let reading =
    sample?.cpuPercent == null ? UI_TEXT.resourceUnknown : formatPercent(sample.cpuPercent)
  let threshold = formatPercent(settings.cpuMaxPercent)
  if (
    sample?.memoryTotalBytes != null &&
    sample.memoryAvailableBytes !== null &&
    sample.memoryAvailableBytes < resourceMemoryFloorBytes(settings, sample.memoryTotalBytes)
  ) {
    metric = UI_TEXT.resourceAvailableMemory
    reading = formatBytes(sample.memoryAvailableBytes)
    threshold = formatBytes(resourceMemoryFloorBytes(settings, sample.memoryTotalBytes))
  } else if (
    sample?.memoryUsedPercent != null &&
    sample.memoryUsedPercent >= settings.memoryMaxPercent
  ) {
    metric = UI_TEXT.resourceMemory
    reading = formatPercent(sample.memoryUsedPercent)
    threshold = formatPercent(settings.memoryMaxPercent)
  } else if (
    settings.gpuMaxPercent !== null &&
    sample?.gpuPercent != null &&
    sample.gpuPercent >= settings.gpuMaxPercent
  ) {
    metric = UI_TEXT.resourceGpu
    reading = formatPercent(sample.gpuPercent)
    threshold = formatPercent(settings.gpuMaxPercent)
  } else if (
    settings.diskBusyMaxPercent !== null &&
    sample?.diskBusyPercent != null &&
    sample.diskBusyPercent >= settings.diskBusyMaxPercent
  ) {
    metric = UI_TEXT.resourceDisk
    reading = formatPercent(sample.diskBusyPercent)
    threshold = formatPercent(settings.diskBusyMaxPercent)
  }
  const count = status.queued.reduce((total, row) => total + row.count, 0)
  const waiting = status.queued
    .map((row) => `${row.kind} / ${row.class}: ${formatNumber(row.count)}`)
    .join(', ')
  const text = `${fill(UI_TEXT.resourcePauseNotice, { metric, reading, threshold })} ${UI_TEXT.resourceWaiting}: ${formatNumber(count)} ${waiting}`
  return status.relocation === 'noRoute' ? `${text} ${UI_TEXT.resourceRelocationNoRoute}` : text
}

/** Called only after the first governed spawn. MHP supplies createItem for its native widget. */
export function createResourceStatus(deps: ResourceStatusDeps): { dispose(): void } {
  const item = deps.createItem()
  const command = deps.registerShow(() => {
    deps.port.show()
  })
  const noticed = new Set<string>()
  let isDisposed = false
  const refresh = () => {
    if (isDisposed) return
    const parsed = resourceStatusSchema.safeParse(deps.port.getSnapshot())
    if (!parsed.success) {
      item.hide()
      deps.invalidStatus()
      return
    }
    const status = parsed.data
    if (!status.settings.enabled || status.level === 'normal') item.hide()
    else {
      item.update(`${UI_TEXT.resourceTitle}: ${levelLabel(status)}`, status.level === 'pause')
      item.show()
    }
    const conversation = deps.conversationId()
    if (
      conversation === undefined ||
      status.level !== 'pause' ||
      !status.settings.enabled ||
      noticed.has(conversation)
    ) {
      return
    }

    noticed.add(conversation)
    deps.notice(pauseText(status), [
      {
        label: UI_TEXT.resourceResumeNow,
        run: () => {
          deps.port.resume()
        },
      },
      {
        label: UI_TEXT.openSettings,
        run: () => {
          deps.port.settings()
        },
      },
      {
        label: UI_TEXT.resourceShow,
        run: () => {
          deps.port.show()
        },
      },
    ])
  }
  const unsubscribe = deps.port.subscribe(refresh)
  refresh()
  return {
    dispose: () => {
      if (isDisposed) return
      isDisposed = true
      unsubscribe()
      command.dispose()
      item.dispose()
      noticed.clear()
    },
  }
}
