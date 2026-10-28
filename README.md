# Agentic Delivery Distribution

This repository packages the executable developer environment and thin
consumer integration for Agentic Delivery:

- Dev Container configuration;
- idempotent bootstrap into a consumer repository;
- reusable workflow callers pinned to an immutable Control Plane commit; and
- Agent Plugin projections from approved Primitive and Automation releases.

The package does not contain the generic lifecycle, routing state machine,
organization credentials, or canonical agent/skill implementations.

The workflow bundle records two independent immutable references: the
Control Plane release being validated and the source commit that provides the
reusable workflow entry point. A consumer caller pins both explicitly, so a
workflow implementation upgrade cannot silently upgrade the lifecycle release.
The caller passes no App credentials and does not replace repository-local
CI/CD.

The local repository is a new-history scaffold. Publication and organization
installation are separate operator actions.

The draft Dev Container Feature has been retired because it installed no
integration. Use the explicit bootstrap plan and apply commands below; the
managed-file, provenance-lock and recovery formats are unchanged. Historical
Feature source remains available at its original immutable commits.

Bootstrap is explicit. Planning is local; apply requires native source checks:

```text
pnpm bootstrap:plan    # inspect the three managed files; writes nothing
pnpm bootstrap:apply   # admitted sources only; the current draft graph holds
pnpm bootstrap:apply -- --force  # overwrite reviewed local conflicts
pnpm bootstrap:plan -- --update # preview changes against the prior ownership lock
pnpm bootstrap:apply -- --update # replace/remove only unchanged prior-owned files
pnpm bootstrap:recover  # restore a process-interrupted installation
pnpm bootstrap:rollback # explicitly restore the last changed installation
```

Apply requires explicit `AGENTIC_DELIVERY_CONTROL_PLANE_ROOT`,
`AGENTIC_DELIVERY_ARCHITECTURE_ROOT` and
`AGENTIC_DELIVERY_CUSTOMIZATIONS_ROOT` checkout paths. The Control Plane checkout
must be the accepted validation source
`d81f1d8095802ab06a96555c4f08396545ad05b6`, with its frozen-lockfile dependencies
installed. This tool source is separate from runtime and reusable-workflow pins.
Tracked-source verification does not attest local Node/Git binaries or ignored
installed dependency trees; their admitted tool/profile evidence remains a
separate release prerequisite.
The `source-validation` source-lock row records the role; a local `verified`
flag does not establish admission.

The supported `bootstrap.mjs` apply entry point verifies exact checkout bytes,
native numeric repository identities, immutable commit objects and trees, and
ancestry against observed canonical default heads through GitHub's REST API.
It invokes the accepted public Control Plane validator for producer provenance,
digests and compatible versions, using an immutable data snapshot. It checks
the actual reusable-workflow fields; a matching SHA in a comment cannot mask a
wrong workflow/runtime pin. Git and validation subprocesses receive no GitHub
token. API reads use `GH_TOKEN` or `GITHUB_TOKEN` when supplied; unauthenticated
public reads remain rate limited. Unknown, unavailable or oversized observations
hold apply without a retry or account fallback.

Only canonical released Distribution, Architecture and Customizations records
and released projection records can pass source promotion readiness. The
controller manifest has no approval-status field: its compatibility is checked
by the public validator. These checks do not authorize participant activation,
approve a runtime context or provide independent human approval. The selected
draft graph remains unadmitted. Successful source validation is not a successful
installation; actual released-source install/update/recovery/rollback and client
evidence remain required.

Writes consume snapshot data from the observed immutable Distribution commit,
not files reread from a mutable checkout after admission. The existing consumer
ownership lock and transaction journal formats remain unchanged. The returned
API result carries native source observations. Read-only plans evaluate local
projection data and explicitly report source admission as unevaluated.
Recovery and rollback require neither source checkouts nor network access.
`bootstrap-projection.mjs` contains low-level projection/transaction mechanics;
it is not a source-admission entry point. Synthetic transaction tests use that
layer; supported-entry-point admission tests remain separate.

Onboarding integration tests need the three pinned public checkouts described
above. CI provides them with complete history and frozen tool dependencies.
`BOOTSTRAP_CONTROL_PLANE_ROOT`, `BOOTSTRAP_ARCHITECTURE_ROOT` and
`BOOTSTRAP_CUSTOMIZATIONS_ROOT` can select equivalent test checkouts. Those tests
mock REST responses for synthetic Distribution commits while running actual Git,
the pinned public validator and producer digest tools. They do not prove native
hosting or adoption; separate live native-binding observations are retained.

The projection stage reads only paths declared in `manifests/workflow-bundle.json`.
It preflights every target before writing, refuses symbolic links in source,
consumer and provenance paths (including their parent directories), and
writes `.agentic-delivery/distribution.lock.json` with the bundle pins and
source SHA-256 values. A conflict is never silently overwritten. Before file planning,
bootstrap validates the supported workflow-bundle v1 shape, canonical source
repository names, typed immutable commits and Architecture digest, file modes,
and the exact controller contract tuple (event envelope 1, lifecycle 1.0.0,
state machine 1.0.0). Unknown contracts and withdrawn bundles are rejected,
including when force replacement is requested. These local metadata checks do
not prove native hosting identity or reproduce producer content digests;
release admission remains a separate requirement. The source lock must also
bind each bootstrap interface (controller, Architecture and workflow source) to
exactly one verified Git row with the canonical numeric repository ID and the
same immutable commit as the bundle. Missing IDs, duplicate rows or mismatches
hold installation, including force replacement; older source bundles without
these bindings require a reviewed compatible source lock. This checks declared
identity consistency; supported apply additionally performs the native checks
above. Historical consumer rollback
and recovery do not require a source lock and retain their existing readers.
Manifest paths use portable ASCII names; case variants and overlapping targets
are rejected, including aliases of the provenance lock.

Managed update is a separate opt-in from force replacement. It requires a
supported prior consumer lock and checks every prior-owned file against its
recorded hash, including files retired by the new bundle. Local edits, missing
owned files and new-path collisions stop the entire update before writing;
matching bytes alone do not authorize adopting an unowned new path. Existing
file permissions are retained during replacement, and clean retired files are
removed through the same recovery transaction. Case-only target migrations
require explicit handling. Update cannot be combined with force.
When a journal records committed lock evidence, the prior lock must also match
that content hash. Legacy version-1 ownership locks without journals remain usable;
rolling back their first update restores that legacy state without inventing
older rollback history.

The current transaction profile requires Linux and a trusted local working
tree on ext2/3/4, Btrfs, XFS, tmpfs or overlayfs, with other writers and consumers
stopped. Other filesystem types are rejected before writes. Path checks do not isolate
hostile concurrent directory renames. Before managed files change, bootstrap
flushes a private `.agentic-delivery-bootstrap-transaction.json` containing
the prior bytes, modes, presence and provenance lock. Ordinary write failures
attempt automatic restoration; a killed process leaves the journal and blocks
another apply until explicit recovery. Recovery and rollback preflight every
recorded file and refuse intervening local edits, including permission changes.
An unchanged repeat apply retains the previous rollback baseline. A successful
changed apply retains rollback data for that operation; recovery does not undo
a committed installation unless the user explicitly selects rollback.
Each rollback also restores the preceding committed journal byte-for-byte.
Repeating rollback therefore moves back one more changed installation; use
recovery after an interrupted operation rather than blindly repeating rollback.

Rollback restores recorded files and removes only known newly created empty
directories. Unrelated files are preserved. Keep the private journal until
its rollback data is no longer needed. The verified boundary is process
interruption on the local Linux profile, not storage failure or universal
power-loss recovery; filesystem flush semantics depend on the OS and device.
Ownership checks and synthetic upgrade tests do not admit a release source or
prove native hosting identity. Source digests, supported version combinations
and the complete compatible release graph still require separate validation
before release admission.

Created directories are bound to their filesystem identities. Replaced or
uncertain directories hold restoration and preserve the journal for inspection;
bootstrap does not infer ownership from a matching directory name. The journal
stays in the existing consumer root until file restoration and directory cleanup
finish, so interruption during cleanup remains recoverable.
Temporary files are also bound to recorded filesystem identities before their
contents are written. Recovery removes only those identified files. Journal
updates append checksummed records, allowing an incomplete final append to
recover from its validated complete prefix; corrupt complete records hold for
inspection. Unknown file or directory ownership is preserved and reported.
The private journal reader validates original schema-1 records and writes
schema-2 records for explicit prior-history and lock-hash fields. Existing
records remain intact; rollback to an older installation restores its original
journal bytes. Older records that did not capture a lock hash do not acquire
invented lock evidence. The consumer provenance lock remains schema version 1.

Organization Copilot agent publication is a separate explicit operation:

```text
pnpm agents:promote:plan
pnpm agents:promote
```

It reads only `agentic-delivery-primitives/agents/copilot/*.agent.md`, copies
those exact files into `.github-private/agents/`, and writes the publication
lock with the immutable Primitive source commit, content hash, ADRs, tool
policy, promotion release, compatibility targets, and timestamp. Stale
generated files are removed only when their previous lock hash still matches;
changed or unmanaged files stop the promotion.

The two preview Automation templates are similarly projected from the Control
Plane's canonical `automations/templates/` source into
`packages/agent-plugin/automations/`. `manifests/automation-projections.lock.json`
records the source commit and per-file hashes. The templates are manual and
read-only; VS Code users choose their local workspace, model, permissions,
enabled state, and schedule after import.

The draft7 package uses the [Agent Plugins 1.0 manifest](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json).
Factory provenance resides in `extensions.io.github.agentic-delivery-lab`;
package name, version and description use standard top-level fields. The current
publisher validates only its manual-automation subset and rejects undeclared
fields. The Control Plane release reader retains historical flat metadata
support. Empty agent, skill and hook scaffolds are retired. Package validation
does not prove client loading, compatible client versions or release admission;
those checks remain required before claiming supported installation.

## Customizations repository-name migration

The staged capabilities lock uses schema version 2 and the explicit source
`agentic-delivery-lab/agentic-delivery-agent-customizations`, bound to repository
ID `1380894656`. Version 1 remains available for immutable historical locks.
The current draft selects Customizations draft15 and Architecture draft78 from
the accepted controller draft67 manifest. Their content digests were reproduced
using each exact pinned source tool, and the native repository IDs were read
back. Runtime source `98495275481aff381180771da6eba9da95bc7816` remains separate
from reviewed workflow source `4d7448c0d628bd591d16c57082204391f1faeffd`.
This draft does not admit an installation, activate participants or establish
Copilot publication entitlement.

Agent-projection generation now emits publication lock version 2, with the
current name and repository ID on the lock and each record. It admits an old
version 1 lock only under its historical source identity for ownership checks.
The Control Plane version 2 publication reader and private caller updates must
be admitted before using these projections; version 1 is not silently treated
as version 2. Existing local checkout paths and the
`AGENTIC_DELIVERY_PRIMITIVES_ROOT` override remain supported while worktrees
are in use; repository names do not authorize moving another session's files.

The development hosting profile is recorded in `.github/rulesets/`. Its
mandatory main-branch PR/check rule has no bypass actors. A separate review
rule permits only `sjefsharp` (native user ID `14937399`) to use the approved
interactive development delegation through a pull request. Runner Apps do
not inherit that exception. Live readback is required before claiming these
files are enforcement. This reconciles the W13 prerequisite for current W05
administration; it does not activate unattended merging or prove runner
credential isolation.
