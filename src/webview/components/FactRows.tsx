import { Fragment } from 'react'

/** Repeated definition-list markup shares one renderer within the deferred surface. */
export function FactRows({
  rows,
}: {
  readonly rows: readonly (readonly [string, string | undefined])[]
}) {
  return rows.map(([label, value], index) =>
    value === undefined ? null : (
      <Fragment key={index}>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </Fragment>
    ),
  )
}
