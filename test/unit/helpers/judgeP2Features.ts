import path from 'node:path'
import { createLogger } from '../../../src/host/logger'
import { judgeFeaturesLoader } from '../../../src/runtime/judge/judgeBundle'
import { collectingLogger } from './collectingLogger'

/** The shipped lazy judge assembly from dist, with its log collected. */
export function shippedJudgeP2Features() {
  const messages: string[] = []
  return judgeFeaturesLoader({
    bundlePath: path.join(process.cwd(), 'dist/judgeP2.js'),
    log: createLogger(collectingLogger(messages)),
  })()
}
