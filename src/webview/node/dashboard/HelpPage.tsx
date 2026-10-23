import { UI_TEXT } from '../../../shared/constants'

/** What each workspace page does, in the installed language. The sections
cover every content page of the workspace; the sandbox note says plainly
what the preview shares. */
export function HelpPage() {
  return (
    <section aria-label={UI_TEXT.nodeHelp.title}>
      <h2>{UI_TEXT.nodeHelp.title}</h2>
      <h3>{UI_TEXT.nodeLabels.files}</h3>
      <p>{UI_TEXT.nodeHelp.files}</p>
      <h3>{UI_TEXT.nodeLabels.terminal}</h3>
      <p>{UI_TEXT.nodeHelp.terminal}</p>
      <h3>{UI_TEXT.nodeLabels.dashboard}</h3>
      <p>{UI_TEXT.nodeHelp.dashboard}</p>
      <h3>{UI_TEXT.nodeLabels.audit}</h3>
      <p>{UI_TEXT.nodeHelp.audit}</p>
      <h3>{UI_TEXT.nodeLabels.git}</h3>
      <p>{UI_TEXT.nodeHelp.git}</p>
      <p>{UI_TEXT.nodeHelp.sandbox}</p>
    </section>
  )
}
