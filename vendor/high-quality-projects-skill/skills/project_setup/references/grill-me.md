# Grill Me discovery guide

Use this guide after the workspace scan and before choosing a framework,
installing dependencies, or creating product code. Treat it as a coverage map,
not a script to recite.

## Contents

- [Interview method](#interview-method)
- [Why and outcomes](#why-and-outcomes)
- [Who and ownership](#who-and-ownership)
- [What and scope](#what-and-scope)
- [Where and supported environments](#where-and-supported-environments)
- [When and lifecycle](#when-and-lifecycle)
- [Experience, brand, and accessibility](#experience-brand-and-accessibility)
- [Product shape and distribution](#product-shape-and-distribution)
- [Signing and trust](#signing-and-trust)
- [Data, integrations, and architecture](#data-integrations-and-architecture)
- [Security, privacy, and compliance](#security-privacy-and-compliance)
- [Quality, performance, and reliability](#quality-performance-and-reliability)
- [Release pipeline and supply chain](#release-pipeline-and-supply-chain)
- [Operations, support, and retirement](#operations-support-and-retirement)
- [Commercial and governance constraints](#commercial-and-governance-constraints)
- [Closeout challenge](#closeout-challenge)

## Interview method

1. Extract answers already present in the request, workspace, linked material,
   and earlier conversation. Do not ask the user to repeat them.
2. Open with the problem, primary users, desired outcome, and smallest useful
   release. These answers shape every later question.
3. Ask focused rounds of roughly five to eight related questions. Continue with
   another round when answers expose new decisions. Never send this entire guide
   as one questionnaire.
4. Explain why a question matters when its impact is not obvious. When the user
   does not know, offer two or three concrete options with tradeoffs and a
   recommended reversible default.
5. Track each answer as **confirmed**, **assumed**, **open/blocking**, or **N/A
   with reason**. Record owner and due date for a deferred decision.
6. Summarize each round. Challenge contradictions, vague adjectives, impossible
   combinations, and goals with no measurable evidence.
7. Scale depth to risk. A local throwaway script needs fewer answers than a
   signed desktop application, public service, regulated system, or paid
   product, but no applicable critical topic may be silently skipped.

## Why and outcomes

- What problem exists today, for whom, and what evidence shows it is worth
  solving?
- Why build this instead of buying, integrating, extending, or doing nothing?
- What user or business outcome defines success? Which measurements will prove
  it, and by when?
- What is explicitly not a goal for the first release?
- What would make the project unsuccessful even if it ships?
- Which assumptions are riskiest and need an early prototype or experiment?

## Who and ownership

- Who are the primary, secondary, and excluded users? What abilities,
  languages, devices, connectivity, and accessibility needs do they have?
- Who buys, approves, administers, operates, supports, secures, and audits it?
- Who owns product decisions, architecture, data, releases, credentials,
  incident response, and final acceptance?
- How many contributors are expected, and what stacks can they maintain?
- Who can stop a release? Who is on call when it fails?
- Which external people or organizations must approve branding, security,
  privacy, legal terms, app-store listing, or distribution?

## What and scope

- What are the critical end-to-end user journeys, in priority order?
- What is the smallest complete release that creates real value rather than a
  collection of disconnected features?
- Which capabilities are must-have, should-have, later, and rejected?
- What inputs, outputs, imports, exports, reports, notifications, and automation
  are required?
- What data is created, read, changed, deleted, retained, restored, or moved?
- What must work offline, under degraded connectivity, or without an account?
- Which existing behavior, file formats, APIs, or compatibility promises must
  remain stable?
- Which existing repositories, modules, components, utilities, schemas, tests,
  configuration, documentation, and assets can be reused or extended? Which are
  authoritative, generated, deprecated, or off-limits?
- What migration path is needed from the current process or product?

## Where and supported environments

- Is the target web, API, service, desktop, mobile, CLI, library, embedded
  device, extension, infrastructure, or a deliberate combination?
- Which operating systems, CPU architectures, browsers, devices, screen sizes,
  input methods, and assistive technologies are supported?
- Where will it run: user device, cloud, on-premises, edge, air-gapped network,
  app store, package registry, container platform, or several of these?
- Which regions, time zones, locales, currencies, languages, and data-residency
  boundaries matter?
- Which development, test, staging, preview, production, and disaster-recovery
  environments are required?
- What network, proxy, firewall, certificate, or enterprise-management limits
  must it tolerate?

## When and lifecycle

- Is there a real deadline, launch window, contractual date, or dependency on
  another system? What is flexible?
- What milestones prove risk reduction before feature completion?
- What release cadence is expected: continuous, scheduled, store-reviewed,
  customer-coordinated, or manual?
- How long must each version, API, schema, file format, and supported platform be
  maintained?
- What deprecation notice and backward-compatibility policy is required?
- What maintenance, support, and end-of-life horizon is funded?

## Experience, brand, and accessibility

- What product name, brand voice, emotional tone, and trust level should the
  experience communicate?
- Which existing branding items are available: brand guidelines, editable logo
  or wordmark source files, logo variants, app icons, favicons, social/OG images,
  store artwork, illustrations, fonts, color tokens, design-system files,
  screenshots, or templates? Record paths or links, formats, owners, licenses,
  approved variants, and which original is authoritative.
- Which branding assets are missing, and who may create or approve them? Never
  redraw, trace, recolor, or replace an existing asset without permission.
- Which competitors or reference products should the design follow or avoid?
- Which color schemes are required? Capture exact tokens or hex values when
  known, plus light, dark, high-contrast, and system-theme behavior.
- What information hierarchy, navigation model, density, and interaction style
  fit the users and tasks?
- What accessibility target and testing evidence are required? Cover keyboard,
  focus, semantics, screen readers, zoom/reflow, contrast, reduced motion,
  touch targets, captions, and error recovery where applicable.
- Which responsive widths, orientations, window sizes, and input modes require
  explicit design and testing?
- Does content require localization, right-to-left layout, plain-language
  review, or legal/regulated wording?
- Who approves visual design, and must a design system or component library be
  created or reused?

## Product shape and distribution

- Is this a hosted service, self-hosted service, installable application,
  library/package, internal tool, appliance, or source-only project?
- Is it single-user, multi-user, single-tenant, multi-tenant, or organization
  managed?
- How will users discover, obtain, install, configure, update, repair, roll
  back, and uninstall it?
- Will it ship through an app store, package registry, installer, disk image,
  archive, container registry, device-management system, or direct download?
- Is public distribution allowed? Are private, beta, enterprise, offline, or
  customer-specific channels needed?
- What telemetry, crash reporting, update checks, or license checks are allowed,
  disclosed, and disableable?
- Must the product work after the vendor service disappears or a subscription
  ends?

## Signing and trust

- Will executables, installers, packages, containers, mobile apps, extensions,
  scripts, updates, or release manifests be signed?
- Which platform trust requirements apply: code-signing certificates,
  notarization, store signing, package signatures, container signatures, or
  enterprise trust roots?
- Who legally owns signing identities and accounts? Where are keys held, who can
  use them, and how are access, rotation, backup, revocation, and recovery
  handled?
- Which CI environment may sign, and which approvals must occur before signing?
- Must users be able to verify checksums, signatures, provenance, or an SBOM
  without contacting the service?
- What happens when a certificate expires, a key is compromised, or a signed
  release must be revoked?

Never invent platform signing rules. Verify current requirements against the
official platform or store documentation before implementing the pipeline.

## Data, integrations, and architecture

- What are the system boundaries, trust boundaries, and authoritative data
  sources?
- Which integrations are required, who owns them, what authentication do they
  use, and what are their quotas, failure modes, and sandbox options?
- What consistency, latency, search, history, audit, backup, restore, import,
  export, retention, and deletion behavior is required?
- Which schemas, APIs, events, file formats, or plugin contracts are public and
  therefore need versioning?
- What scale is expected now and at a realistic upper bound: users, requests,
  records, file sizes, concurrency, regions, and growth?
- Which constraints drive architecture: team skills, existing systems, hosting,
  cost, offline use, regulation, performance, or portability?
- Which build-versus-buy decisions need evidence before the stack is selected?

## Security, privacy, and compliance

- What data classifications exist, including credentials, personal data,
  financial data, health data, intellectual property, and customer secrets?
- Is authentication required? Which identities, roles, permissions, sessions,
  recovery paths, and administrative actions exist?
- What abuse cases, threat actors, fraud risks, unsafe content, or high-impact
  actions must be designed against?
- What encryption, secret storage, audit logging, tamper evidence, retention,
  deletion, backup, and recovery rules apply?
- Which privacy notices, consent flows, data-subject rights, age restrictions,
  licenses, export controls, or compliance obligations require expert review?
- What dependency, secret, static-analysis, dynamic-analysis, and penetration
  testing is proportionate to the risk?
- What is the vulnerability disclosure, patch, incident response, and breach
  communication process?

Do not give legal or compliance certification. Record when qualified review is
required and treat it as a release dependency.

## Quality, performance, and reliability

- What observable acceptance criteria exist for every critical journey?
- Which canonical plan and existing requirement/task identities must delivery
  preserve? How will requirements readiness be reviewed separately from evidence
  that the implementation works? Reuse answers already established in the brief.
- Which unit, integration, contract, end-to-end, accessibility, visual,
  compatibility, migration, recovery, load, and security tests are required?
- What supported-platform test matrix must CI or release certification cover?
- Which critical defects must red drills prove the tests detect? What disposable
  environments, evidence, owners, and CI/milestone/release cadence are needed?
  Red drills are required; establish their scope rather than asking whether to
  omit them. Reuse existing answers and choose routine mechanics during delivery.
- What response-time, startup-time, memory, CPU, battery, bundle-size, storage,
  throughput, and cost budgets apply?
- What availability, durability, recovery-time, recovery-point, and graceful-
  degradation targets are justified?
- Which failures must be retried, queued, rejected, surfaced, or handled
  manually?
- What evidence is required before a milestone, release candidate, and
  production release can be called complete?

## Release pipeline and supply chain

- Where is source hosted, and what branch, review, ownership, and protected-
  change rules apply?
- Which CI system and runner environments are trusted? Are network-isolated or
  self-hosted runners required?
- Which gates run on commit, pull request, merge, release candidate, and
  production promotion?
- How are versions, changelogs, release notes, migrations, compatibility, and
  deprecations managed?
- Where are build artifacts stored, how long are they retained, and can the
  exact release be reproduced or traced to source and dependencies?
- Which dependency locks, vulnerability scans, secret scans, SBOMs, licenses,
  signatures, checksums, provenance, and attestations are required?
- Which environments require approval? Is promotion immutable, or is each
  environment rebuilt independently?
- What deployment strategy applies: direct, rolling, canary, phased, blue/
  green, store rollout, customer wave, or manual installation?
- How are database and data migrations tested, ordered, observed, and rolled
  back when the code rollback is not enough?
- What is the rollback trigger, authority, maximum recovery time, and last-known-
  good artifact path?
- Are feature flags needed? Who owns removal dates so they do not become
  permanent branches?

## Operations, support, and retirement

- Which logs, metrics, traces, audit events, dashboards, health checks, alerts,
  and synthetic checks prove the product works for users?
- Who receives each alert, during which hours, with what escalation and
  runbook?
- What support channels, severity levels, response targets, diagnostic bundles,
  and privacy boundaries are required?
- How are backups restored and disaster recovery exercised rather than merely
  configured?
- What capacity, cost, quota, certificate-expiry, domain-expiry, and dependency-
  end-of-life alerts are needed?
- How will data be exported or deleted, infrastructure removed, credentials
  revoked, users notified, and dependencies archived when the product retires?

## Commercial and governance constraints

- Is the project internal, open source, paid, subscription, licensed, sponsored,
  or customer-funded?
- What budget limits hosting, third-party services, certificates, store fees,
  design, testing, security review, and ongoing support?
- Which source, content, font, model, data, and dependency licenses are allowed?
- Are contributor agreements, ownership rules, procurement, vendor review, or
  accessibility/security attestations required?
- What records must be retained for decisions, approvals, releases, audits, or
  customer commitments?

## Closeout challenge

Before asking for confirmation:

1. Restate the project in one paragraph: who it serves, why it exists, what the
   first release does, where it runs, and how it reaches users.
2. List measurable success criteria and explicit non-goals.
3. Show chosen defaults and the tradeoff behind each one.
4. List every open decision with owner, due date, downstream impact, and whether
   it blocks stack selection, implementation, signing, distribution, or release.
5. Test the brief for contradictions: scope versus schedule, platforms versus
   budget, privacy versus telemetry, offline use versus service dependency,
   rollback versus irreversible migrations, and accessibility versus chosen UI.
6. Ask the user to confirm or correct the resulting `PROJECT_BRIEF.md`.

Do not interpret “use your judgment” as permission to make irreversible,
credential-owning, legal, signing, distribution, data-retention, or production-
operations decisions. Offer a recommendation, record it, and obtain explicit
confirmation.
