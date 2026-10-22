// Import-free preview constants, re-exported by constants.ts. The standalone
// <=25 KiB page must not instantiate the browser's complete English fallback.
export const MAKER_PROTOCOL_VERSION = 1
export const MAKER_PREVIEW_MAX_TRIANGLES = 100_000
export const MAKER_PREVIEW_MAX_COORDINATE = 1_000_000
export const MAKER_VERTEX_COMPONENTS = 3
export const MAKER_TRIANGLE_COMPONENTS = 9
export const MAKER_PREVIEW_VALIDATION_CHUNK = 9000
export const MAKER_PREVIEW_VALIDATION_DEADLINE_MS = 1000
export const MAKER_PREVIEW_CANVAS_SIZE = 640
const ROTATION_SLICES = 12
export const MAKER_PREVIEW_ROTATION_STEP = Math.PI / ROTATION_SLICES
export const MAKER_PREVIEW_ZOOM_STEP = 1.2
export const MAKER_PREVIEW_MIN_ZOOM = 0.25
export const MAKER_PREVIEW_MAX_ZOOM = 4
export const MAKER_PREVIEW_FRAME_SCALE = 0.8
