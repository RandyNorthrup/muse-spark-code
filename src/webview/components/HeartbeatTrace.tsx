// An original P/QRS/T trace for this panel (M87, D66). Geometry is fixed;
// CSS owns the sweep and switches to a still trace for reduced motion.
const TRACE =
  'M0 12 H18 Q22 12 24 9 Q26 6 29 12 H34 L38 15 L43 2 L48 22 L53 12 H63 Q68 4 73 12 H100'

export function HeartbeatTrace() {
  return (
    <svg className="heartbeat-trace" viewBox="0 0 100 24" aria-hidden="true" focusable="false">
      <path className="heartbeat-base" d={TRACE} pathLength="100" />
      <path className="heartbeat-sweep" d={TRACE} pathLength="100" />
    </svg>
  )
}
