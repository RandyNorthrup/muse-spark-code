# Project brief

> Replace all bracketed guidance. Use `N/A — <reason>` instead of leaving an
> applicable section blank. Mark status **Confirmed** only after the project
> owner reviews the decision summary and blocking questions are resolved.

| Field | Value |
|---|---|
| Status | Draft / Confirmed |
| Product owner | [name or role] |
| Technical owner | [name or role] |
| Last confirmed | [YYYY-MM-DD] |
| Decision authority | [who resolves scope, security, and release conflicts] |

## Executive contract

- **Problem:** [who has what problem today]
- **Why now:** [evidence, deadline, or opportunity]
- **First useful release:** [smallest complete outcome]
- **Success measures:** [metric, target, measurement source, target date]
- **Non-goals:** [explicit exclusions]
- **Failure conditions:** [what makes the project unsuccessful even if shipped]

## People

- Primary and secondary users:
- Excluded users:
- Accessibility, language, device, and connectivity needs:
- Product, engineering, design, security, operations, support, and release
  owners:
- Approvers and external stakeholders:

## Scope and journeys

- Critical journeys, in priority order:
- Must-have capabilities:
- Later capabilities:
- Inputs, outputs, imports, exports, and integrations:
- Offline and degraded-mode behavior:
- Migration and compatibility commitments:
- Canonical scoped plans, existing requirement/task IDs, and acceptance
  obligations to preserve during delivery:

## Experience and brand

- Product name and brand voice:
- Design references and prohibited directions:
- Existing brand guidelines, editable logos/wordmarks, logo variants, app icons,
  favicons, social/OG images, store artwork, illustrations, fonts, templates,
  and design-system files; include path/link, format, owner/license, approved
  use, and authoritative original:
- Missing brand assets and creation/approval owner:
- Color tokens; light, dark, and high-contrast behavior:
- Typography, icons, density, and navigation model:
- Accessibility target and required evidence:
- Responsive devices, widths, orientations, and input modes:
- Localization and content requirements:
- Design approver:

## Product shape and supported environments

- Product type and service model:
- Supported operating systems, architectures, browsers, devices, and assistive
  technologies:
- Hosting, regions, data residency, and network constraints:
- Development, test, staging, production, and recovery environments:
- Tenant, account, and offline model:

## Distribution, signing, and updates

- Distribution channels:
- Installation, configuration, update, rollback, repair, and uninstall path:
- Artifacts requiring signatures, notarization, or store approval:
- Signing identity owner, key custody, authorized CI, rotation, and revocation:
- Checksum, signature, SBOM, provenance, and offline-verification requirements:
- Telemetry, crash reporting, update checks, and opt-out behavior:

## Data, security, privacy, and compliance

- Data classes and authoritative sources:
- Authentication, roles, permissions, sessions, and recovery:
- Trust boundaries and highest-impact abuse cases:
- Encryption, secrets, audit, retention, deletion, backup, and restore:
- Privacy, legal, licensing, and qualified-review dependencies:
- Vulnerability reporting, patching, and incident ownership:

## Architecture and dependencies

- Architectural constraints and selected style:
- Existing code, components, utilities, types, schemas, tests, configuration,
  documentation, infrastructure, and assets to reuse or extend:
- Approved new implementations and why existing work cannot satisfy the
  confirmed contract:
- Public APIs, schemas, events, file formats, and versioning promises:
- Required integrations, quotas, sandboxes, and failure behavior:
- Expected and upper-bound scale:
- Build-versus-buy decisions and evidence:
- Selected stack, versions, compatibility sources, and rejected alternatives:

## Quality and reliability contract

- Acceptance evidence for each critical journey:
- Requirements-readiness review owner and canonical delivery-plan location:
- Required test levels and supported-platform matrix:
- Red-drill scope for critical behavior and gates; safe test environments,
  CI/milestone/release cadence, evidence location, and owner:
- Accessibility and visual checks:
- Performance, resource, bundle, storage, and cost budgets:
- Availability, durability, recovery, and graceful-degradation targets:
- Milestone, release-candidate, and production certification criteria:

## Release pipeline

- Source host, branching, review, ownership, and protected-change rules:
- CI runners and trusted environments:
- Commit, pull-request, merge, release, and promotion gates:
- Artifact registry, retention, reproducibility, and traceability:
- Versioning, changelog, release notes, compatibility, and deprecation:
- Deployment and environment-promotion strategy:
- Migration ordering, verification, and rollback:
- Release approval, signing approval, rollback authority, and last-known-good
  artifact:

## Operations, support, and lifecycle

- Logs, metrics, traces, audit events, health checks, dashboards, and alerts:
- On-call, escalation, incident, and runbook ownership:
- Support channels, severity levels, and response targets:
- Backup-restore and disaster-recovery exercise schedule:
- Capacity, cost, quota, certificate, domain, and dependency-lifecycle alerts:
- Maintenance window, support lifetime, deprecation, export, deletion, and
  retirement plan:

## Delivery constraints

- Milestones and real deadlines:
- Team size, skills, availability, and ownership gaps:
- Budget and procurement limits:
- External approvals and dependencies:

## Decision ledger

| Decision | State | Choice or question | Why / evidence | Owner | Due | Blocking impact |
|---|---|---|---|---|---|---|
| [topic] | Confirmed / Assumed / Open / N/A | [value] | [tradeoff or source] | [owner] | [date] | [none or blocked work] |

## Readiness confirmation

- [ ] Primary user, problem, first release, success measures, and non-goals are
      confirmed.
- [ ] Critical journeys and supported environments are confirmed.
- [ ] Existing branding items and authoritative originals are inventoried;
      missing assets, accessibility, and responsive targets are confirmed or
      N/A.
- [ ] Existing code, components, configuration, documentation, and assets have
      been scanned; reuse/extension decisions and justified new work are
      recorded.
- [ ] Service, distribution, signing, and update models are confirmed or N/A.
- [ ] Data, authentication, security, privacy, and compliance boundaries are
      confirmed or assigned to qualified review.
- [ ] Release, promotion, rollback, operations, support, and retirement owners
      are confirmed or N/A.
- [ ] Test evidence and red-drill scope, environments, and ownership are defined;
      unimplemented or deferred checks remain open verification work.
- [ ] No open decision blocks stack selection or initial implementation.

**Confirmation:** [name/role, date, corrections or conditions]
