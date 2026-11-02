// Muse Desktop (M111, D91.16) lane ST1: the shell's page frame. One place
// owns loading, load failure with retry, the apply-failure banner and the
// remount that resets page drafts whenever fresh state lands. Every
// failure reaches the person with its code; nothing is dropped.

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import { SysdError } from '../../../shared/desktop/sysd'
import { fill } from '../../../shared/l10n/text'

export interface PageReport<Data> {
  succeeded(data: Data): void
  onError(error: unknown): void
  reload(): void
}

function errorCode(error: unknown): string {
  return error instanceof SysdError
    ? String(error.code)
    : UI_TEXT.settingsSystem.powerBatteryUnknown
}

interface Snapshot<Data> {
  readonly token: number
  readonly load: () => Promise<Data>
  readonly data?: Data | undefined
  readonly error?: unknown
}

function LoadingState(): ReactNode {
  const text = UI_TEXT.settingsSystem
  return (
    <div className="muse-settings-page">
      <p role="status" className="muse-settings-empty">
        {text.loading}
      </p>
    </div>
  )
}

export function PageFrame<Data>({
  load,
  children,
}: {
  readonly load: () => Promise<Data>
  readonly children: (data: Data, report: PageReport<Data>) => ReactNode
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  // A snapshot belongs to the loader that read it: when the shell swaps
  // pages the loader changes and the old page's state must never render
  // as the new page's, so a snapshot for another loader reads as loading.
  const [snapshot, setSnapshot] = useState<Snapshot<Data>>({ token: -1, load })
  const [applyError, setApplyError] = useState<unknown>(undefined)
  const [loadToken, setLoadToken] = useState(0)
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    let isLive = true
    // The load's error port: a refused read becomes the frame's error
    // state, shown with its code.
    const onError = (error: unknown): void => {
      if (isLive) {
        setSnapshot({ token: loadToken, load, error })
      }
    }
    const run = async (): Promise<void> => {
      try {
        const data = await load()
        if (isLive) {
          setSnapshot({ token: loadToken, load, data })
          setEpoch((count) => count + 1)
        }
      } catch (error) {
        onError(error)
      }
    }
    void run()
    return () => {
      isLive = false
    }
  }, [load, loadToken])

  const reload = useCallback(() => {
    setApplyError(undefined)
    setLoadToken((count) => count + 1)
  }, [])
  const onError = useCallback((error: unknown) => {
    setApplyError(error)
    setLoadToken((count) => count + 1)
  }, [])
  const succeeded = useCallback(
    (data: Data) => {
      setApplyError(undefined)
      setSnapshot({ token: loadToken, load, data })
      setEpoch((count) => count + 1)
    },
    [load, loadToken],
  )

  if (snapshot.token !== loadToken || snapshot.load !== load) {
    return <LoadingState />
  }
  if (snapshot.error !== undefined) {
    return (
      <div className="muse-settings-page">
        <p role="alert" className="muse-settings-apply-error">
          {fill(text.loadFailed, { code: errorCode(snapshot.error) })}
        </p>
        <div>
          <button
            type="button"
            className="muse-settings-button muse-settings-button-secondary"
            onClick={reload}
          >
            {text.retry}
          </button>
        </div>
      </div>
    )
  }
  if (snapshot.data === undefined) {
    return <LoadingState />
  }
  return (
    <div key={epoch} className="muse-settings-page-frame">
      {applyError === undefined ? null : (
        <p role="alert" className="muse-settings-apply-error">
          {fill(text.applyFailed, { code: errorCode(applyError) })}
        </p>
      )}
      {children(snapshot.data, { succeeded, onError, reload })}
    </div>
  )
}

// One confirmed change against its service: fresh state on success, the
// banner plus a re-read on failure, so the page never shows a guess.
export async function runPageApply<Data>(
  report: PageReport<Data>,
  task: () => Promise<Data>,
): Promise<void> {
  try {
    report.succeeded(await task())
  } catch (error) {
    report.onError(error)
  }
}
