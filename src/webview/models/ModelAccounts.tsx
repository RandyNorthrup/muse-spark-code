import { useEffect, useState } from 'react'
import { modelAccountsAvailableSchema } from '../../shared/modelAccountsRoute'
import { UI_TEXT } from '../../shared/constants'
import type { HostBridge } from '../hostBridge'
import { deferred } from '../components/DeferredSurface'

const Accounts = deferred(async () => {
  const chunk = await import('./sections/accounts/AccountsSurface')
  return { default: chunk.AccountsSurface }
})

/** Host availability opens the existing account surface on first use only. */
export function ModelAccounts({ host }: { readonly host: HostBridge }) {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      const parsed = modelAccountsAvailableSchema.safeParse(event.data)
      if (parsed.success) setRevision((current) => current + 1)
    }
    host.messages.addEventListener('message', receive)
    host.post({ type: 'modelAccounts/ready' })
    return () => {
      host.messages.removeEventListener('message', receive)
    }
  }, [host])
  return revision === 0 ? null : (
    <Accounts
      host={host}
      revision={revision}
      label={UI_TEXT.accounts.title}
      className="accounts-section"
    />
  )
}
