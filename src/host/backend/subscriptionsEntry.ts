// Subscription sign-in cores load on the first subscription action.
// Dispatch and terminal commands live beside them in
// dist/subscriptionCommands.js (subscriptionCommandsEntry); the registry
// reads these cores through this entry (one `instanceof` across the
// boundary).
export {
  ChatGptSignIn,
  ChatGptSignInError,
  chatGptCallbackBinding,
  chatGptGrantStatus,
  chatGptRecordSchema,
  chatGptRegistrationSchema,
  parseChatGptCallback,
  resolveChatGptHostId,
} from '../../core/providers/subscriptions/chatgpt'
export type { ChatGptHostPort } from '../../core/providers/subscriptions/chatgpt'
export {
  createChatGptHostId,
  isChatGptHostId,
} from '../../core/providers/subscriptions/chatgptHostId'
export {
  GrokSignIn,
  GrokSignInError,
  buildGrokAuthorizeUrl,
  grokAccountIdHash,
  grokCallbackBinding,
  grokRecordSchema,
  parseGrokCallback,
  parseGrokDeviceCode,
  requireGrokClientId,
  resolveGrokScopes,
  verifyGrokIdToken,
} from '../../core/providers/subscriptions/grok'
export type {
  GrokDevicePrompt,
  GrokHostPort,
  GrokRecord,
} from '../../core/providers/subscriptions/grok'
// The Copilot adapter's failure, shared one copy with the host side exactly
// like ChatGptSignInError above (PLAN.md D207): copilotClient.ts reads it
// through this entry so the deferred-cohort rewrite binds the subscriptions
// bundle's copy, and the registry's `instanceof` holds across the bundle
// boundary instead of each bundle carrying its own class.
export { CopilotFailureError } from '../../core/providers/subscriptions/copilotFailure'
