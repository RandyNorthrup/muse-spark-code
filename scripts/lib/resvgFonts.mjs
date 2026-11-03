/**
The font options every art render passes to resvg. The art draws no text, so
resvg reads no system fonts: by default each render scans them all, which
costs a tenth of a second or more on macOS and Windows (RLF-CIMAC) and would
let a machine's own fonts reach the pixels.
*/
export const RESVG_FONTS = Object.freeze({ loadSystemFonts: false })
