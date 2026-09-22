import { PRODUCT_NAME } from '../../shared/constants'
import { MetaLogo } from './icons'

export interface EmptyStateProps {
  readonly hint: string
}

export function EmptyState({ hint }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="brand">
        <MetaLogo />
        <span>{PRODUCT_NAME}</span>
      </div>
      <p className="hint">{hint}</p>
    </div>
  )
}
