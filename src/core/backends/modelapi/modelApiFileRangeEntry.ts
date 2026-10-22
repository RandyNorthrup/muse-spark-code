// The Model API backend's deferred byte-range file execution (D6): reads
// and edits of one byte window at any file size. dist/modelApi.js loads
// this as dist/modelApiFileRange.js on the first range addressed call; the
// whole-file paths never load it. A bundle that cannot load refuses the
// call that needed it, never a silent fallback and never a default value.
export { editFileByRange, readFileByRange } from './fileRangeTools'
