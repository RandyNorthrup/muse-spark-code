// D6: the team workers' fence, split out of dist/teamHost.js to hold its unchanged
// 130 KiB cap (SPLIT_PARTS, scripts/lib/deferredBundles.mjs). The host keeps one copy
// of its error classes this way, as each other team bundle already keeps its own.
export * from './workerFence'
