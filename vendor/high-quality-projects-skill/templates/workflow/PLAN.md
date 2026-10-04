# Delivery plan

Adapt this example to the requested work. Preserve existing canonical paths and
IDs. Replace example intent and runtime values; do not retain invented work.
Evidence starts empty until the review or check actually runs. This scaffold
cannot pass readiness or closure without real evidence. Read `docs/DELIVERY.md`
in the source package before use.

## Rationale

Explain the scoped change, non-goals, reuse decisions, and architecture here.
The ledger below owns structured facts and status; do not duplicate them in
a second checklist.

```quality-ledger
{
  "schema_version": 1,
  "work": {
    "id": "WORK-1",
    "title": "Validate order quantities",
    "scope_revision": 1,
    "brief": null,
    "brief_reason": "Scoped change to an existing order parser",
    "rules": [
      {
        "path": "AGENTS.md",
        "revision": "1"
      }
    ],
    "inputs": [],
    "environment": {
      "platform": "REPLACE_WITH_OBSERVED_PLATFORM",
      "tools": {
        "python": "REPLACE_WITH_OBSERVED_VERSION"
      }
    }
  },
  "requirements": [
    {
      "id": "REQ-1",
      "statement": "Reject negative order quantities",
      "priority": "critical",
      "acceptance": [
        "AC-1"
      ],
      "superseded_by": null
    }
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "requirement": "REQ-1",
      "given": "An order quantity below zero",
      "when": "The quantity is parsed",
      "then": "A negative-quantity error is raised",
      "checks": [
        "behavior",
        "red"
      ],
      "manual_reason": null
    }
  ],
  "tasks": [
    {
      "id": "TASK-1",
      "purpose": "Extend the canonical quantity parser",
      "acceptance": [
        "AC-1"
      ],
      "depends_on": [],
      "changes": [
        {
          "path": "src/quantity.py",
          "action": "modify"
        }
      ],
      "status": "planned",
      "evidence": [],
      "blocker": null,
      "superseded_by": null
    }
  ],
  "evidence": [],
  "checkpoint": null
}
```
