// The Model API backend's deferred per-call helpers (D6): the Pre/PostLLMCall
// hook fields, the display-only argument previews, and the web-fetch URL
// checks. dist/modelApi.js loads this as dist/modelApiTools.js on the first
// use; a bundle that cannot load refuses the call that needed it, never a
// silent fallback and never a default value.
export { preModelCallFields, postModelCallFields } from './modelCallHooks'
export { ArgumentPreview, type ArgumentPreviewCapabilities } from './argumentPreview'
export { checkPageUrl, type CheckedPageUrl, type PageUrlCheck } from '../../web/pageUrl'
export type { WebFetchFailure } from '../../web/fetchFailure'
export { setUiText } from '../../../shared/l10n/text'
