// Subscription sign-in and dispatch load on the first subscription action.
export { setUiText } from '../../shared/l10n/text'
export {
  ChatGptSignIn,
  ChatGptSignInError,
  parseChatGptCallback,
} from '../../core/providers/subscriptions/chatgpt'
export type { ChatGptHostPort } from '../../core/providers/subscriptions/chatgpt'
export {
  createChatGptHostId,
  isChatGptHostId,
} from '../../core/providers/subscriptions/chatgptHostId'
export {
  createSubscriptionClient,
  chatGptCatalog,
  chatGptModels,
  chatGptAccountId,
  chatGptPlanAccount,
  chatGptFailureText,
} from '../../core/providers/subscriptions/registry'
// The Copilot adapter's failure, shared one copy with the host side exactly
// like ChatGptSignInError above (PLAN.md D119): copilotClient.ts reads it
// through this entry so the deferred-cohort rewrite binds the subscriptions
// bundle's copy, and the registry's `instanceof` holds across the bundle
// boundary instead of each bundle carrying its own class.
export { CopilotFailureError } from '../../core/providers/subscriptions/copilotFailure'
export {
  runtimeChatGptCommandDeps,
  runChatGptProviderCommand,
  chatGptAuthenticationMethods,
  chatGptFailureOf,
  runtimeSubscriptionClient,
} from '../../runtime/chatGptProviderCommands'
