# Agentic Delivery Distribution

This repository packages the executable developer environment and thin
consumer integration for Agentic Delivery:

- Dev Container and Feature definitions;
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

Bootstrap is explicit and local:

```text
pnpm bootstrap:plan    # inspect the three managed files; writes nothing
pnpm bootstrap:apply   # create missing files and provenance lock
pnpm bootstrap:apply -- --force  # overwrite reviewed local conflicts
pnpm bootstrap:plan -- --update # preview changes against the prior ownership lock
pnpm bootstrap:apply -- --update # replace/remove only unchanged prior-owned files
pnpm bootstrap:recover  # restore a process-interrupted installation
pnpm bootstrap:rollback # explicitly restore the last changed installation
```

The command reads only paths declared in `manifests/workflow-bundle.json`.
It preflights every target before writing, refuses symbolic links in source,
consumer and provenance paths (including their parent directories), and
writes `.agentic-delivery/distribution.lock.json` with the bundle pins and
source SHA-256 values. A conflict is never silently overwritten.
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

## Customizations repository-name migration

The staged capabilities lock uses schema version 2 and the explicit source
`agentic-delivery-lab/agentic-delivery-agent-customizations`, bound to repository
ID `1380894656`. Version 1 remains available for immutable historical locks.
The capability release ID, source commit and digest are unchanged. The
renamed source identity and explicit-name access have been read back, and the
digest reproduced using the exact pinned source tool. This draft does not admit a compatible full release composition,
activate participants or establish Copilot publication entitlement.

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
