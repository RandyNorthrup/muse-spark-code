// Each grammar in D93.5, including the older question-heading form.
export const PLAN_FORMAT_FIXTURE = `# Fixture plan

## 2. Resolved decisions
### D1 — Backends (M12, 2026-10-05)
Use the selected backend.
## 3. Open questions
- **Q-M12 — Choose the target (2026-10-05).**
  The owner chooses the target.
### Q-M91b — Older question form
An older question.
## 6. Milestones
**Delivery order**
1. **M12** — Establish the contracts.
Needs: none.
2. **M110a0** — Build the runtime.
Needs: M12.
### M12 — Fixture contracts (D1)
**Status 2026-10-05: planned.**
- **Goal.** A stable contract.
- **Depends on.** none.
| Lane | Scope | Own files | Shared files (region) | Starts | Rig | Hours |
| --- | --- | --- | --- | --- | --- | ---: |
| 0 Contracts | Schemas | src/shared/contract.ts | constants.ts | day 0 | Win11 VM | 10 |
- [x] A recorded fixture.
- [ ] A certified renderer.
### M110a0 — Runtime (D1)
**Status 2026-10-05: building.**
- **Depends on.** M12.
### M91b — Plugins (D1)
**Status 2026-10-05: merged.**
### CIFIX14C — CI repair (D1)
**Status 2026-10-05: complete.**
## 7. Gates
Run the gates.
## 8. Escape hatches
| Item | Reason |
| --- | --- |
| M12 fixture | No production escape hatch. |
## 9. Residuals
Unknown credential patterns can survive scrubbing.
## 10. Releases
### 0.14.2 — 2026-10-05
Fixture release.
`

export const QUALITY_LEDGER_FIXTURE = `# Fixture project

\`\`\`quality-ledger
{"schema_version":1,"work":{"id":"M12","title":"Contracts","scope_revision":1,"brief":null,"brief_reason":"Reporting fixture","rules":[{"path":"AGENTS.md","revision":"1"}],"inputs":[],"environment":{"platform":"win32","tools":{"node":"24"}}},"requirements":[{"id":"R1","statement":"Deterministic output","priority":"critical","acceptance":["A1"],"superseded_by":null}],"acceptance":[{"id":"A1","requirement":"R1","given":"A fixed snapshot","when":"Rendered twice","then":"Bytes match","checks":["behavior","red"],"manual_reason":null}],"tasks":[{"id":"T1","purpose":"Freeze contracts","acceptance":["A1"],"depends_on":[],"changes":[{"path":"src/shared/reportSchema.ts","action":"add"}],"status":"planned","evidence":[],"blocker":null,"superseded_by":null}],"evidence":[],"checkpoint":null}
\`\`\`
`
export const NO_PLAN_FIXTURE = '# Fixture project\n\nThis project has no structured plan.\n'
