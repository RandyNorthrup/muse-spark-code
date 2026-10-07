import * as z from 'zod/mini'
import { VAULT_LIMITS } from '../../../shared/constants'
import { assertWebTarget, webOrigin } from './origin'
import { type WebTargetLease } from './ports'

// The script returns our own shape. Runtime.evaluate's envelope was captured by M81.
// Text nodes only: no input.value, value attribute, textarea, script or hidden field is read.
const PAGE_TEXT = String.raw`(()=>{const out=[];const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);for(let n=walk.nextNode();n;n=walk.nextNode()){if(n.parentElement?.closest('input,textarea,select,script,style,noscript,[hidden]'))continue;out.push(n.textContent??'')}return out.join('\n')})()`
const evaluated = z.object({
  result: z.object({ value: z.string().check(z.maxLength(VAULT_LIMITS.frameBytes)) }),
  exceptionDetails: z.optional(z.unknown()),
})

/** M109-L-SCRUB: T binds this to the broker service; no identity fallback is permitted. */
export async function readWebPage(
  target: WebTargetLease,
  scrub: (text: string) => Promise<string>,
): Promise<string> {
  try {
    const origin = webOrigin(target.facts.topUrl)
    assertWebTarget(target, origin)
    const answer = evaluated.parse(
      await target.cdp.send(
        'Runtime.evaluate',
        {
          expression: PAGE_TEXT,
          returnByValue: true,
          // M81 supplies this isolated-world context id, not the model's main world.
          contextId: target.isolatedContextId,
        },
        target.sessionId,
      ),
    )
    if (answer.exceptionDetails !== undefined) throw new Error('useChanged')
    assertWebTarget(target, origin)
    const clean = await scrub(answer.result.value)
    assertWebTarget(target, origin)
    return z.string().parse(clean).slice(0, VAULT_LIMITS.text)
  } catch {
    throw new Error('useChanged')
  }
}
