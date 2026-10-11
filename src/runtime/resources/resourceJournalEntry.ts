// INT0170: M107 W2's machine resource journal, built once as dist/resourceJournal.js.
// The window governor's recorder (dist/resourceGovernor.js) and the usage page's
// reader (dist/usageService.js) both load it, so neither bundle carries a copy.
export * from './history'
