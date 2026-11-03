// D6: the backend's instruction text and the workspace context it reads, split out of
// dist/modelApi.js to hold its unchanged 525 KiB cap. The one class here has this one
// copy. esbuild builds this file into dist/modelApiInstructions.js, and the backend's
// imports of the two modules become a require of that sibling
// (SPLIT_PARTS, scripts/lib/deferredBundles.mjs).
export * from './instructions'
export * from '../../context/workspaceContext'
