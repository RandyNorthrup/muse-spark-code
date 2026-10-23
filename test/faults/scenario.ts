// What one fault-injection scenario is (M110r Y4): a name, its needs,
// and the run. The run proves its facts or throws; the environment it
// cannot meet refuses loudly, never silently.
export type ScenarioNeeds = 'loopback' | 'namespaces' | 'git'

export interface FaultScenario {
  readonly name: string
  readonly needs: ScenarioNeeds
  run(repoRoot: string): Promise<void>
}
