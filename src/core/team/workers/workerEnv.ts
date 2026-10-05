// Engine and ACP workers share lane I's canonical credential/loader fence.
import { workerEnvironment } from '../refFence'

export interface ScrubWorkerEnvInput {
  readonly platform: NodeJS.Platform
  readonly baseEnv: NodeJS.ProcessEnv
  /** Profile names may pass through only when the mandatory fence permits them. */
  readonly passthrough?: readonly string[] | undefined
}

export function scrubWorkerEnv(input: ScrubWorkerEnvInput): NodeJS.ProcessEnv {
  return workerEnvironment(input.baseEnv, input.platform, input.passthrough)
}
