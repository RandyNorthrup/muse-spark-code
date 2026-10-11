import type { ModelApiHost } from '../../core/backends/modelapi/ModelApiHost'
import type { EngineWorkerSession } from '../team/teamEnginePorts'

/** Editor and headless workers share creation and failure teardown. */
export async function openTeamWorkerSession(
  host: ModelApiHost,
  input: { readonly folder: string; readonly modelId: string; readonly approvalMode: string },
): Promise<EngineWorkerSession> {
  try {
    const session = await host.startSession({
      workspaceRoot: input.folder,
      modelId: input.modelId,
      approvalMode: input.approvalMode,
    })
    return {
      session,
      toolNames: host.sessionToolNames(session.sessionId) ?? [],
      close: () => host.close(),
    }
  } catch (error: unknown) {
    await host.close()
    throw error
  }
}
