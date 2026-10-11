import { USAGE_TEXT } from '../../shared/l10n/usageTable'
import type { UsagePageState } from '../../shared/usagePage'
import { count, money } from './display'

export function SavingsSection({ savings }: { readonly savings: UsagePageState['savings'] }) {
  return (
    <section>
      <h2>{USAGE_TEXT.savings}</h2>
      <dl className="usage-kpis">
        <div>
          <dt>{USAGE_TEXT.cachedTokens}</dt>
          <dd>{count(savings.cachedTokens)}</dd>
        </div>
        <div>
          <dt>{USAGE_TEXT.cacheSavings}</dt>
          <dd>{money(savings.cacheUsd)}</dd>
        </div>
        <div>
          <dt>{USAGE_TEXT.packedAvoided}</dt>
          <dd>{count(savings.packedAvoided)}</dd>
        </div>
      </dl>
    </section>
  )
}
