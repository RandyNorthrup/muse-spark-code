import '../roles/roles.css'
import './agents.css'
import { UI_TEXT } from '../../../../shared/constants'
import { TeamTree } from '../../../components/TeamTree'
import type { SectionProps } from '../../sections'

export function AgentsSection({ panelState, post, dispatch }: SectionProps) {
  if (panelState.roles === undefined) return null
  const tree = panelState.agents?.tree
  return (
    <section className="team-editor" aria-labelledby="agents-title">
      <h2 id="agents-title">{UI_TEXT.teamEditor.agents}</h2>
      {panelState.notice === undefined ? null : <p role="alert">{panelState.notice}</p>}
      {tree === undefined ? (
        <p role="status">{UI_TEXT.teamEditor.empty}</p>
      ) : (
        <TeamTree
          tree={tree}
          actions={{
            labels: {
              transcript: UI_TEXT.teamEditor.transcript,
              diff: UI_TEXT.teamEditor.diff,
              editRole: UI_TEXT.teamEditor.editRole,
              stopAll: UI_TEXT.teamEditor.stopAll,
            },
            onOpenTranscript: (taskId) => {
              post({ type: 'agents/transcript', taskId })
            },
            onStopTask: (taskId) => {
              post({ type: 'agents/stopTask', taskId })
            },
            onReviewDiff: (taskId) => {
              post({ type: 'agents/diff', taskId })
            },
            onDecideMerge: (taskId, decision) => {
              post({ type: 'agents/merge', taskId, decision })
            },
            onEditRole: (roleId) => {
              dispatch({ type: 'host-navigate', section: 'roles', itemId: roleId })
            },
            onResetEntry: (entryId) => {
              post({ type: 'agents/resetEntry', entryId })
            },
            onStopAll: () => {
              post({ type: 'agents/stopAll' })
            },
          }}
        />
      )}
    </section>
  )
}
