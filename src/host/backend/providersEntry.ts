// M95's captured codecs and provider core have their own Node bundle (D74).
// No entry imports these values at activation or on a Meta-only turn. Lane I
// composes the registry and panel seam after the shared transport lands.
export * as chat from '../../core/backends/modelapi/codecs/chat'
export * as ollama from '../../core/backends/modelapi/codecs/ollama'
export * as anthropic from '../../core/backends/modelapi/codecs/anthropic'
export * as gemini from '../../core/backends/modelapi/codecs/gemini'
export * as responses from '../../core/backends/modelapi/codecs/responses'
export * as capabilities from '../../core/providers/capabilities'
export * as modelMetadata from '../../core/providers/modelMetadata'
export * as credentialRecord from '../../core/providers/credentialRecord'
export * as endpointPolicy from '../../core/providers/endpointPolicy'
export * as modelFilters from '../../core/providers/modelFilters'
export * as modelRef from '../../shared/modelRef'
export * as pkce from '../../core/providers/pkce'
export * as presets from '../../core/providers/presets'
export * as priceCard from '../../core/providers/priceCard'
export * as providerSpend from '../../core/providers/providerSpend'
export * as providerSpendKeyUsage from '../../core/providers/providerSpendKeyUsage'
export * as providersFile from '../../core/providers/providersFile'
// M95c part 6: the custom request headers' record, read by the codec
// client's per-attempt auth, the editor's header manager and the CLI.
export * as requestHeaders from '../../core/providers/requestHeaders'
export * as scanDiff from '../../core/providers/scanDiff'
export * as suggest from '../../core/providers/suggest'
export * as tokenCount from '../../core/providers/tokenCount'
export * as wizardFlow from '../../core/providers/wizardFlow'
export { setUiText } from '../../shared/l10n/text'

// RVCM1054D P2: the Copilot client's refusal constructor across the seam.
// The Models panel bundle calls this instead of formatting the sentences
// itself, so the panel keeps only the call and stays under its cap.
export { refuse } from '../../core/media/codecRefusal'
export { createProviderRegistry } from '../../core/providers/providerRegistry'
export { createModelsPanelSeam } from '../../core/providers/panelSeam'
// The image chunk's D121 fallback (an edit with no record) reads Meta's own
// record across the seam instead of carrying a copy of it.
export { metaCapabilityRecord } from '../../core/providers/capabilityRecord'
export { recordPlanUsage } from '../../core/providers/subscriptions/planUsage'
export { parsePlanLimitHeaders } from '../../core/providers/subscriptions/planUsage'
export * as planRefusals from '../../core/providers/subscriptions/planRefusals'
export {
  connectOpenRouterAccount,
  createOpenRouterPanelUsage,
  clearOpenRouterPanelUsage,
  createOpenRouterDraftDiscard,
  createOpenRouterUsageReader,
  openRouterDiscardedKeyNotice,
  promptOpenRouterCode,
  OPENROUTER_ORIGIN,
} from '../providers/openRouter'
export * as huggingface from '../providers/huggingface'
export { startOAuthLoopback } from '../providers/oauthLoopback'
export { metaResolvedModel } from '../../core/backends/modelapi/modelPolicy'
export { isPkceState, pkceRandom } from '../../core/providers/pkce'
