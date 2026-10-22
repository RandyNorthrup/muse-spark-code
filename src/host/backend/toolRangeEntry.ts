// The host side of byte-range file reads and edits (D6): esbuild builds
// this file into dist/toolRange.js, which ToolIo requires on the first
// range addressed call, so whole-file turns never carry the windowed reader
// and the streaming splice. A bundle that cannot load refuses the call that
// needed it, naming the chunk, and retries on the next range call.
export { createFileRangeIo, type FileRangeIoDeps } from './toolRangeIo'
