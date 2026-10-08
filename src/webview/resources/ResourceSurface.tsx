import { webviewKey } from '../../shared/keybindings'
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { UI_TEXT } from '../../shared/constants'
import {
  fill,
  formatBytes,
  formatDateTime,
  formatNumber,
  formatPercent,
} from '../../shared/l10n/text'
import {
  resourceMemoryFloorBytes,
  resourceStatusSchema,
  type ResourceStatus,
} from '../../shared/resources'
import type { ResourceSurfaceProps } from './resourcePort'

/** Shared by the panel and companion. An absent or invalid status renders no readings. */
export function ResourceSurface({ port, isInert = false }: ResourceSurfaceProps) {
  const subscribe = useCallback((changed: () => void) => port.subscribe(changed), [port])
  const read = useCallback(() => port.getSnapshot(), [port])
  const snapshot = useSyncExternalStore(subscribe, read)
  const parsed = resourceStatusSchema.safeParse(snapshot)
  const [isOpen, setIsOpen] = useState(false)
  const [target, setTarget] = useState<Element | null>(null)
  const chip = useRef<HTMLButtonElement>(null)
  const anchor = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const id = useId()
  // StatusLine owns the heartbeat. The App's surface follows its current mount
  // without changing another lane's transcript/StatusLine interfaces.
  useEffect(() => {
    const find = () => {
      setTarget(
        anchor.current?.closest('.app')?.querySelector('.status-line:has(.heartbeat-trace)') ??
          null,
      )
    }
    find()
    const observer = new MutationObserver(find)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
    }
  }, [])
  useEffect(() => {
    if (isOpen && !isInert) closeButton.current?.focus()
  }, [isOpen, isInert, target])
  if (!parsed.success || !parsed.data.settings.enabled) return null
  const close = () => {
    setIsOpen(false)
    chip.current?.focus()
  }
  const status = parsed.data
  const label = {
    normal: UI_TEXT.resourceNormal,
    throttle: UI_TEXT.resourceThrottle,
    relocate: UI_TEXT.resourceRelocate,
    pause: UI_TEXT.resourcePause,
  }[status.level]
  const content = (
    <div
      ref={anchor}
      className="resource-surface"
      data-resource-level={status.level}
      inert={isInert}
    >
      <button
        ref={chip}
        type="button"
        className="resource-chip"
        aria-expanded={isOpen && !isInert}
        aria-controls={isOpen && !isInert ? id : undefined}
        title={UI_TEXT.resourceShow}
        onClick={() => {
          setIsOpen(!isOpen)
        }}
      >
        {UI_TEXT.resourceTitle}: {label}
      </button>
      <span className="sr-only" role="status">
        {label}
      </span>
      {!isOpen || isInert ? null : (
        <div
          id={id}
          role="dialog"
          aria-label={UI_TEXT.resourceTitle}
          className="resource-popover"
          onKeyDown={(event) => {
            if (webviewKey('dialog', event) !== 'close') {
              return
            }

            event.preventDefault()
            event.stopPropagation()
            close()
          }}
          onBlur={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget) &&
              event.relatedTarget !== chip.current
            )
              setIsOpen(false)
          }}
        >
          <header>
            <strong>
              {UI_TEXT.resourceTitle}: {label}
            </strong>
            <button ref={closeButton} type="button" className="button-secondary" onClick={close}>
              {UI_TEXT.usageClose}
            </button>
          </header>
          <ResourceReadings status={status} />
          {status.relocation === 'noRoute' ? <p>{UI_TEXT.resourceRelocationNoRoute}</p> : null}
          {status.overrideUntilMs === null ? null : (
            <p>
              {fill(UI_TEXT.resourceOverrideNotice, {
                time: formatDateTime(status.overrideUntilMs),
              })}
            </p>
          )}
          {status.queued.length === 0 ? null : (
            <div className="resource-queue">
              <p>{UI_TEXT.resourceWaiting}</p>
              <ul>
                {status.queued.map((row, index) => (
                  <li key={`${row.kind}:${row.class}:${String(index)}`}>
                    <code>
                      {row.kind} / {row.class}
                    </code>
                    : {formatNumber(row.count)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <footer>
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                port.resume()
                close()
              }}
            >
              {UI_TEXT.resourceResumeNow}
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                port.settings()
                close()
              }}
            >
              {UI_TEXT.openSettings}
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                port.show()
                close()
              }}
            >
              {UI_TEXT.resourceShow}
            </button>
          </footer>
        </div>
      )}
    </div>
  )
  return target === null ? content : createPortal(content, target)
}

function ResourceReadings({ status }: { readonly status: ResourceStatus }) {
  const sample = status.sample
  const settings = status.settings
  const percent = (value: number | null | undefined) =>
    value == null ? UI_TEXT.resourceUnknown : formatPercent(value)
  const rows = [
    {
      label: UI_TEXT.resourceCpu,
      reading: percent(sample?.cpuPercent),
      threshold: formatPercent(settings.cpuMaxPercent),
    },
    {
      label: UI_TEXT.resourceMemory,
      reading: percent(sample?.memoryUsedPercent),
      threshold: formatPercent(settings.memoryMaxPercent),
    },
    {
      label: UI_TEXT.resourceAvailableMemory,
      reading:
        sample?.memoryAvailableBytes == null
          ? UI_TEXT.resourceUnknown
          : formatBytes(sample.memoryAvailableBytes),
      threshold:
        sample?.memoryTotalBytes == null
          ? UI_TEXT.resourceUnknown
          : formatBytes(resourceMemoryFloorBytes(settings, sample.memoryTotalBytes)),
    },
  ]
  if (settings.gpuMaxPercent !== null)
    rows.push({
      label: UI_TEXT.resourceGpu,
      reading: percent(sample?.gpuPercent),
      threshold: formatPercent(settings.gpuMaxPercent),
    })
  if (settings.diskBusyMaxPercent !== null)
    rows.push({
      label: UI_TEXT.resourceDisk,
      reading: percent(sample?.diskBusyPercent),
      threshold: formatPercent(settings.diskBusyMaxPercent),
    })
  return (
    <dl className="resource-readings">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd
            title={
              row.reading === UI_TEXT.resourceUnknown ? UI_TEXT.resourceUnavailable : undefined
            }
          >
            {row.reading} / {row.threshold}
          </dd>
        </div>
      ))}
    </dl>
  )
}
