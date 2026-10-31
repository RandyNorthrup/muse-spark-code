// Lazy editor composition over the same request owner as CLI/ACP. The editor
// supplies SecretStorage and native dialogs; no key enters its webview bridge.
import {
  createRuntimeAccountServices,
  type AccountServicesSettings,
} from '../../runtime/providers/runtimeServices'
import type { SecretStore } from '../auth/credentialStore'
import { promptForMetaAccountKey } from '../auth/metaAccountKey'
import { AccountsPanelHandler } from '../models/accountsHandler'
import { accountPolicyFor, type AccountPolicy } from '../../core/providers/accountPolicy'
import { accountEventText } from '../../acp/accountText'
import { ACCOUNT_REQUEST_CERTIFICATION, UI_TEXT } from '../../shared/constants'
import type { CoreLogger } from '../../core/logging'

export function createEditorAccountServices(deps: {
  readonly dataDir: string
  readonly secrets: SecretStore
  readonly session: () => string | undefined
  readonly settings: () => AccountServicesSettings
  readonly promptForApiKey: () => Promise<string | undefined>
  readonly askPolicy: (row: AccountPolicy) => Promise<unknown>
  readonly setSeveral: (isEnabled: boolean) => Promise<void>
  readonly notice: (session: string, text: string) => void
  readonly log: Pick<CoreLogger, 'warn'>
}) {
  const services = createRuntimeAccountServices({
    dataDir: deps.dataDir,
    log: deps.log,
    secrets: deps.secrets,
    settings: deps.settings,
    askPolicy: deps.askPolicy,
    onNotice: (session, event, accounts) => {
      deps.notice(session, accountEventText(event, accounts))
    },
  })
  return {
    requests: (
      client: Parameters<typeof services.requests>[0],
      options?: Parameters<typeof services.requests>[1],
    ) => services.requests(client, options),
    billing: services.billing,
    /** The window's own store and metadata, for the developer owner. */
    commands: services.commands,
    dispose: () => {
      services.dispose()
    },
    hold: (isHeld: boolean) => {
      services.hold(isHeld)
    },
    async request(value: unknown) {
      if (!ACCOUNT_REQUEST_CERTIFICATION.isComplete) throw new Error(UI_TEXT.accounts.unavailable)
      const session = deps.session()
      const port = services.sessions('meta')
      const state = await port.read(session ?? '')
      let selected = state.currentAccount
      const confirmations = await services.confirmations('meta')
      const handler = new AccountsPanelHandler({
        accounts: services.store,
        confirmations,
        confirmSeveral: async (provider) => {
          if (provider !== 'meta') return false
          const entry = await services.metadata.read(provider)
          const row =
            entry === undefined ? undefined : accountPolicyFor(entry.policyProvider, entry.product)
          if (row === undefined) return false
          const grant = await confirmations.obtain(row, true)
          // Only-at-my-own-caps still allows the accounts to exist; the pool
          // honours the recorded choice at each vendor limit.
          return grant !== undefined && grant.choice !== 'cancel'
        },
        setSeveral: deps.setSeveral,
        provider: (id) => (id === 'meta' ? services.metadata.read(id) : Promise.resolve(undefined)),
        currentAccount: () => selected,
        settings: deps.settings,
        capabilities: () => ({
          planWindows: [],
          hasRateHeadroom: false,
          usageUrl: null,
          label: UI_TEXT.backendModelApi,
        }),
        credential: async (provider, account) => {
          if (
            provider !== 'meta' ||
            (await promptForMetaAccountKey(services.store, account, deps.promptForApiKey)) !==
              'stored'
          )
            throw new Error(UI_TEXT.accounts.unavailable)
        },
        use: async (provider, account) => {
          if (provider !== 'meta' || session === undefined)
            throw new Error(UI_TEXT.accounts.unavailable)
          const state = await port.use(
            session,
            account,
            () => ACCOUNT_REQUEST_CERTIFICATION.isComplete && deps.session() === session,
          )
          selected = state.currentAccount
        },
        answer: () => false,
        now: Date.now,
      })
      return await handler.handle(value)
    },
  }
}
