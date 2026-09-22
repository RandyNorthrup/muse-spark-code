import { PRODUCT_NAME } from '../../shared/constants'
import { SparkIcon } from './icons'

export interface EmptyStateProps {
  readonly hint: string
}

export function EmptyState({ hint }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="brand">
        <SparkIcon />
        <span>{PRODUCT_NAME}</span>
      </div>
      <p className="hint">{hint}</p>
    </div>
  )
}
