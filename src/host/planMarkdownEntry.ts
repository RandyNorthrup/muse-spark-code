// The plan reader's bundle (M79, PLAN.md D6): esbuild builds this file into
// dist/planMarkdown.js, which `planMarkdownLoader` requires on the first plan
// action (Save plan, Implement, Plans…), so the panel's Markdown parser, 114
// KiB of it, stays out of the bundle VS Code loads at activation. It needs
// no localized text: the loader, in the activation bundle, says what failed.

export { PLAN_MARKDOWN as planMarkdown } from '../core/plans/planMarkdown'
