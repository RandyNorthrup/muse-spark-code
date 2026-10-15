// The subscriptions half of the Models & Agents panel's host side (PLAN.md
// D6): esbuild builds this file into dist/modelsSubscriptions.js, which
// activation requires on the first subscription action, so the ChatGPT and
// Copilot sign-in flows stay out of the bundle the first Models & Agents
// action loads (dist/modelsPanel.js).
export { createSubscriptionFeatures } from '../providers/subscriptionFeatures'
