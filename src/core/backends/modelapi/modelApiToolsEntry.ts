// The Model API backend's deferred per-call helpers (D6): the Pre/PostLLMCall
// hook fields, the display-only argument previews, and the web-fetch URL
// checks. dist/modelApi.js loads this as dist/modelApiTools.js on the first
// use; a bundle that cannot load refuses the call that needed it, never a
// silent fallback and never a default value.
export { preModelCallFields, postModelCallFields } from './modelCallHooks'
export { ArgumentPreview } from './argumentPreview'
export { checkPageUrl } from '../../web/pageUrl'
export { setUiText } from '../../../shared/l10n/text'
