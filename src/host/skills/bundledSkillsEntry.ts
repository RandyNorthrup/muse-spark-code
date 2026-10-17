// The bundled skills installer's bundle (M89, PLAN.md D6, D68): esbuild builds
// this file into dist/bundledSkills.js, which `bundledSkillsLoader` requires
// on the first install, removal or offer, so the file work stays out of the
// bundle VS Code loads at activation. It returns data only; the loader's
// side, in the activation bundle, words every result.

export {
  bundledSkillsStatus,
  installBundledSkills,
  removeBundledSkills,
} from './bundledSkillsInstall'

export { playbookReviewerCharter } from './playbookReviewerCharter'
