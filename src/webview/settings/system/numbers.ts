// Muse Desktop (M111, D91.16) lane ST1: typed number drafts. A settings
// number field is either a safe integer or nothing at all: an empty or
// partial draft disables Apply instead of reaching the service as zero.

export function parseDraftInt(text: string): number | undefined {
  if (!/^-?\d+$/.test(text.trim())) {
    return undefined
  }
  const value = Number(text)
  return Number.isSafeInteger(value) ? value : undefined
}
