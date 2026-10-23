// One acceptance rule for a judge source's reported model (M98 phase 2).
// A source answers under its request model id, or under one of the model
// ids its capture says that request id may report (a SystemOne alias such
// as `typesafe/jev-1.13` resolves to the dated `typesafe/jev-1.13-20260917`).
// Every surface that checks the serving model (the cascade's settlement and
// the CLI/MCP foreign-model check) uses this rule, and nothing else; any
// other id stays a foreign model.

/** Whether `reported` is a model this source may answer as for `requested`. */
export function isServedJudgeModel(
  reported: string,
  requested: string,
  served: readonly string[] | undefined,
): boolean {
  return reported === requested || (served?.includes(reported) ?? false)
}
