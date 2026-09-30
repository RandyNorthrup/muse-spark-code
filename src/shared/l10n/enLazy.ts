// The English table's stand-in inside the lazily loaded bundles (PLAN.md D6):
// dist/modelApi.js, dist/checkpointStore.js and dist/agentImport.js. Each one
// is handed the activation's table (`setUiText`, the language installed and
// English merged in) before it reads a word, so its own copy of the 78 KB
// English table was dead weight that counted against its size budget and
// grew with every new text. `scripts/lib/lazyBundleTable.mjs` has the build
// resolve `text.ts`'s import of `./en` to this file in those bundles only;
// the activation bundle, the webview and the ACP agent keep the real table.
// A word read before the table is installed is `undefined` here: the
// bundles' entries install it first, and no module reads it at load.

import type { UiText } from './en'

// The cast is the point: an empty table in the shape every reader expects,
// replaced in full by `setUiText` (PLAN.md §8).
export const EN = {} as UiText
