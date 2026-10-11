// axe's reasons (messageKey) for a contrast it could not decide: the text is
// covered, or it could not see the background behind it; or the content is
// glyphs, not text.
const CONTRAST_RULE = 'color-contrast'
const UNSEEN_REASONS = new Set(['elmPartiallyObscured', 'elmPartiallyObscuring', 'bgOverlap'])
const GLYPH_ONLY_REASON = 'nonBmp'

/**
 * axe's undecided ("incomplete") results, sorted (the review of PR #18).
 * Two kinds of contrast result are counted, not failed, because no tool
 * decides them here: text axe could not see where it looked (covered by a
 * menu or dialog the user opened, or scrolled out of the transcript's
 * view; the same rows are checked where a scenario shows them), and
 * glyph-only content. Everything else axe could not decide fails, as a
 * violation does.
 */
export function sortIncomplete(findings) {
  const undecided = []
  let unseen = 0
  let glyphOnly = 0
  for (const finding of findings) {
    const nodes = finding.nodes.filter((node) => {
      const isContrast = finding.id === CONTRAST_RULE && node.reasons.length > 0
      if (isContrast && node.reasons.every((reason) => UNSEEN_REASONS.has(reason))) {
        unseen += 1
        return false
      }
      if (isContrast && node.reasons.every((reason) => reason === GLYPH_ONLY_REASON)) {
        glyphOnly += 1
        return false
      }
      return true
    })
    if (nodes.length > 0) {
      undecided.push({ ...finding, nodes })
    }
  }
  return { undecided, unseen, glyphOnly }
}
