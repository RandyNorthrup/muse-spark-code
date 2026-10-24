import { useEffect, useMemo, useRef, useState } from 'react'
import { AccountsSection } from './AccountsSection'
import type { ModelsAccountsSlice } from '../../../../shared/accountsPanel'
import { modelsAccountsSliceSchema } from '../../../../shared/accountsPanel'
import { modelAccountsMessageSchema } from '../../../../shared/modelAccountsProtocol'
import type { AccountsRequest } from '../../../../shared/hostApi/accounts'
import { ACCOUNT_PANEL_REQUEST_TIMEOUT_MS, UI_TEXT } from '../../../../shared/constants'
import type { HostBridge } from '../../../hostBridge'
import { webviewErrorReport } from '../../../errorReport'
import './accounts.css'

/** A request the surface withdrew as it closed: nothing failed, nothing to show. */
class AccountsRequestWithdrawn extends Error {}

export function AccountsSurface({
  host,
  revision,
}: {
  readonly host: HostBridge
  readonly revision: number
}) {
  const [slice, setSlice] = useState<ModelsAccountsSlice>()
  const [failedRevision, setFailedRevision] = useState<number | null>(null)
  const sequence = useRef(0)
  const waiting = useRef(
    new Map<
      number,
      { resolve(value: unknown): void; withdraw(): void; timer: ReturnType<typeof setTimeout> }
    >(),
  )
  const port = useMemo(
    () => ({
      request: (request: AccountsRequest) =>
        new Promise<unknown>((resolve, reject) => {
          sequence.current += 1
          const requestId = sequence.current
          const refuse = () => {
            waiting.current.delete(requestId)
            reject(new Error(UI_TEXT.accounts.unavailable))
          }
          const withdraw = () => {
            waiting.current.delete(requestId)
            reject(new AccountsRequestWithdrawn())
          }
          const timer = setTimeout(refuse, ACCOUNT_PANEL_REQUEST_TIMEOUT_MS)
          waiting.current.set(requestId, { resolve, withdraw, timer })
          try {
            host.post({ type: 'modelAccounts/request', requestId, request })
          } catch (error: unknown) {
            // The request reads unavailable; the host's log gets the cause.
            clearTimeout(timer)
            refuse()
            host.post(webviewErrorReport('promise', error))
          }
        }),
      accept: (value: ModelsAccountsSlice) => {
        setSlice(value)
      },
      openLink: (url: string) => {
        host.post({ type: 'openExternal', url })
      },
    }),
    [host],
  )
  useEffect(() => {
    const pending = waiting.current
    const receive = (event: MessageEvent<unknown>) => {
      const parsed = modelAccountsMessageSchema.safeParse(event.data)
      if (!parsed.success || parsed.data.type !== 'modelAccounts/reply') return
      const owned = pending.get(parsed.data.requestId)
      if (owned === undefined) return
      clearTimeout(owned.timer)
      pending.delete(parsed.data.requestId)
      owned.resolve(parsed.data.value)
    }
    host.messages.addEventListener('message', receive)
    return () => {
      host.messages.removeEventListener('message', receive)
      for (const owned of pending.values()) {
        clearTimeout(owned.timer)
        owned.withdraw()
      }
    }
  }, [host])
  useEffect(() => {
    let isCurrent = true
    void port
      .request({ type: 'accounts/list', provider: 'meta' })
      .then((value) => {
        if (!isCurrent) return
        const parsed = modelsAccountsSliceSchema.safeParse(value)
        if (!parsed.success) {
          setFailedRevision(revision)
          return
        }
        setFailedRevision(null)
        setSlice(parsed.data)
      })
      .catch((error: unknown) => {
        // Withdrawn as the surface closed: no failure happened.
        if (error instanceof AccountsRequestWithdrawn) return
        host.post(webviewErrorReport('promise', error))
        if (isCurrent) setFailedRevision(revision)
      })
    return () => {
      isCurrent = false
    }
  }, [host, port, revision])
  if (failedRevision === revision)
    return (
      <div role="alert">
        <p>{UI_TEXT.accounts.unavailable}</p>
        <button
          type="button"
          onClick={() => {
            window.location.reload()
          }}
        >
          {UI_TEXT.surfaceLoadRetry}
        </button>
      </div>
    )
  return slice === undefined ? (
    <p role="status">
      {UI_TEXT.accounts.title}: {UI_TEXT.loadingOutput}
    </p>
  ) : (
    <AccountsSection value={slice} port={port} />
  )
}
