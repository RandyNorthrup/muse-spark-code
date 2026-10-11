import { FilePlaybookJournal } from '../../core/orchestration/playbook/journal'
import { OrchestratorPlaybook } from '../../core/orchestration/playbook/policy'
import { UI_TEXT } from '../../shared/l10n/text'
import { changedPlaybookSettings, type PlaybookChange, type PlaybookSurfacePort } from './command'

export interface PlaybookSurfaceDeps {
  /** Trusted agent data folder; the journal file lives under it. */
  readonly agentDataFolder: string
  /** Trusted canonical workspace; never a model-supplied path. */
  readonly workspaceFolder: string
  readonly teamId: string
  /** Lease lane label for future dispatch use; the surface grants no leases. */
  readonly laneId: string
  readonly now?: () => number
}

/** The journal-backed settings/record port for user-initiated surfaces (the
 * CLI, ACP local commands, the panel settings page once mounted). Actor and
 * time come from this trusted context, never from the request; P re-checks
 * authority on every change. Wire this factory only to surfaces the person
 * operates; a model turn never receives it. */
export function createPlaybookSurface(deps: PlaybookSurfaceDeps): PlaybookSurfacePort {
  const journal = new FilePlaybookJournal(deps.agentDataFolder, deps.workspaceFolder)
  const policy = new OrchestratorPlaybook({
    journal,
    teamId: deps.teamId,
    laneId: deps.laneId,
    workspaceFolder: deps.workspaceFolder,
    now: deps.now ?? Date.now,
    // The caller answers for the person at the keyboard or terminal: every
    // request through this port is their own settings operation. Stamping
    // still comes from here, never from the request body.
    authorizeOverride: () => true,
    drillRequirements: { guards: () => ['rounds'] },
    checkAdmission: { admit: () => true },
    hookAdmission: { admit: () => true },
  })
  return {
    read: () => Promise.resolve({ settings: policy.getSettings(), records: policy.getRecord() }),
    // The port contract is rejection, never a synchronous throw: a hostile
    // change rejects (nothing is persisted before the schema parse), so the
    // synchronous validation is caught and carried as the rejection reason.
    change: (change: PlaybookChange): Promise<unknown> => {
      try {
        const next = changedPlaybookSettings(policy.getSettings(), change, 'owner', Date.now())
        const decision = policy.updateSettings(next)
        if (decision.kind !== 'allow') throw new Error(UI_TEXT.playbookUnavailable)
        return Promise.resolve({ settings: policy.getSettings(), records: policy.getRecord() })
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)))
      }
    },
  }
}
