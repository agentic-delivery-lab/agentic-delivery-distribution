# Changelog

## [Unreleased]

### Changed

- The draft bundle advances to `0.1.0-draft.16`, pinning Control Plane draft30
  at `069475071cfa6b725446e8179ad1db164dc2d96e`, including the canonical
  organization event catalog; draft15 remains the explicit rollback bundle.

- The draft bundle advances to `0.1.0-draft.15`, pinning the corrected
  Control Plane draft29 release at
  `7061773305054da9eb33b4ef872a7b7c63364d65`; draft14 remains the explicit
  rollback bundle.

- The draft bundle advances to `0.1.0-draft.14`, pinning the Control Plane
  release at `0956144e5b9229209ad0fb82299a1d99a366ac66`, which includes the
  release-bound Primitive selection contract; draft13 remains the explicit
  rollback bundle.

- The draft bundle advances to `0.1.0-draft.13`, pinning the Control Plane
  release at `b52464571e1c0d3adfa5986bd54668d3c7da4a13` so consumers receive
  the commit-exact dependency digest validation.

- The draft bundle advances to `0.1.0-draft.12`, pinning Architecture draft
  `0.1.0-draft.6` at `5655c0fda81e9ebcc6e3f7e9805e966ce15ed96b` and its
  changelog-inclusive digest; draft11 remains the explicit rollback bundle.

- The draft bundle advances to `0.1.0-draft.11`, pinning the integrity-bound
  Architecture release `0.1.0-draft.5` at
  `2bfe92c8c641a2258d4393a37785c793d8a46c48` and Control Plane release
  `0.2.0-draft.25` at `81fa558aad0f998876bc29871080f2380b2c8582`;
  the Dev Container Feature default follows the same immutable controller pin;
  draft10 remains the explicit rollback bundle.

- The draft bundle advances to `0.1.0-draft.10`; its generated reusable
  workflow callers now have valid GitHub Actions YAML structure and a
  deterministic indentation check.

- Corrected the generated consumer reusable-workflow YAML indentation and
  added structural validation so bootstrap output is accepted by GitHub
  Actions rather than only by text-based pin checks.

- The draft bundle advances to `0.1.0-draft.9`, pinning Control Plane
  `0.2.0-draft.24` at `1c33a16b9a5a7e6480410c69bdda32648126eabc`; draft8
  remains the rollback bundle.

- The draft bundle advances to `0.1.0-draft.8`, pinning Control Plane
  `0.2.0-draft.23` and feature defaults to
  `30197d5c8731ea6e682ae4de5e629b964e278aab` while retaining the separately
  pinned reusable workflow source `c3d0d2c7be0a68ca9d6ae83174f8ebae754826f4`;
  draft7 remains the rollback bundle.

- The draft bundle advances to `0.1.0-draft.7`, pinning Control Plane
  `0.2.0-draft.22` at `ccbe92fffd41d0e5cdc906a170e74f2a723e7386` and workflow
  source `c3d0d2c7be0a68ca9d6ae83174f8ebae754826f4`; draft6 remains the
  explicit rollback bundle.

- The draft bundle advances to `0.1.0-draft.6`, pinning Control Plane
  `0.2.0-draft.21` at `9634a711ded35f54a69e4c361fc3369100d84290` and workflow
  source `df4068a77b3192d20c48de521f47edfcb312c6ee`; draft5 remains the
  explicit rollback bundle.

- The draft bundle advances to `0.1.0-draft.5`, pinning Control Plane
  `0.2.0-draft.20` at `213036f87776dcf75e349355ff7983ded476c42e` and workflow
  source `c3bf78d51836be737eb069b4408f7b16f21c0877`.

- The draft bundle advances to `0.1.0-draft.4`, pinning Control Plane
  `0.2.0-draft.19` at `02b742c86f77700e8c787ae17f31959d22bbdf2e`, the
  acyclic Primitive release snapshot at `51e94992c5f39c59046f752e0cf6cff2ed3fff32`,
  and workflow source `5401a3d8c3ace20661eb749245e80bd2b511cafe`.

- The draft bundle advances to `0.1.0-draft.3`, pinning Control Plane
  `0.2.0-draft.18` at `d34d37170c8bfaf944ee0a2bb7b52aac145febf4` and the
  Primitive release source at `13acf15d7d2c5ed12b9158d57ff45fcce93d1a06`.

- An intermediate draft2 bundle proposal was superseded before publication
  because its Primitive release still referenced the preceding Architecture
  pin; consumers must use the aligned draft3 bundle above.

- The draft bundle now pins Architecture `0.1.0-draft.3` at
  `d4714c9489fb14824ef0967903d34a73c3e437fb`, Primitive `0.1.0-draft.3` at
  `8d99a4a7a7240a02090ab2ac81cdb7676b8a42ad`, and Control Plane
  `0.2.0-draft.16` at `9e4ca88eb69a4df69067162d0fbc7100bd6cf691`.

- The draft bundle now pins Primitive release `0.1.0-draft.2` at
  `cfd86652d9f3a830c28d3dd40f6e762588c0af75` with its content digest, Control
  Plane release `0.2.0-draft.15` at `ce6a0144edeefbb8125962c06f70b9c9c91cde78`,
  and workflow source `d2bda1a0c8fc546a0ec3dc0e59809302cdf424e8`.

- The draft consumer bundle now pins Control Plane `0.2.0-draft.14` at
  `707a4a74c8d331f2400fffa2714f04b8a7d59b9b`, Architecture at
  `112a4163f7f8cb9142005568fb6270eef6df85cb`, and the reusable workflow
  source at `b64c8a3960614b4d0deb638c9ca8e5fca4d32c95`; the architecture
  review path now carries the pinned content-digest contract.

- The draft consumer bundle now pins Control Plane release commit
  `02b2727c582fc181a8622e86e0ed87b2e81c98f3` and workflow source commit
  `52e7a2092a1e7807ee091264a3dbbe97b8764593`, carrying downstream identity
  acceptance evidence through API, git, pull-request, and evidence projections.

- The draft consumer bundle now pins Control Plane release `0.2.0-draft.12`
  at `93583d371818045a9ae694b97e0cf90a4fae8956`; the workflow source pins
  runtime commit `3ea621d64507c0ef187181a487e5f8ff190e5aa3` and includes the
  deterministic origin lifecycle write-back acceptance check.

- The draft consumer bundle now pins the Control Plane acceptance release at
  `bd65b887eceb7162eb68235752eebf7d1e5edc59`; consumers gain the offline
  multi-repository identity and rollback contract through an explicit pin.
- The reusable workflow source now pins `83f164388096e0e343b1641c27ee399e509bf68b`,
  which includes the repository-independent acceptance validator while keeping
  the Control Plane release pin separate.

- The draft consumer bundle now pins Control Plane `0.2.0-draft.9` at
  `bfe2913c244dcaa3ff29aee18cac327ccbce44f0`; the central gateway requires an
  explicit controller repository ID and upgrades remain reviewable.
- The draft consumer bundle now pins Control Plane `0.2.0-draft.8` at
  `eeef545c40d5b9e9a590e335c5ab193deaaac928`; upgrades remain explicit and
  rollbackable through the bundle manifest.
- The draft consumer bundle now pins the first locally validated Control Plane commit, including its central intake path fix, instead of a pre-contract commit that lacks the release validators.

### Added

- Added Architecture content-digest pinning to the workflow bundle and
  consumer provenance lock.

- Added a schema and cross-file validation for the Primitive capabilities lock,
  including the Primitive source digest and its consistency with the Agent
  Plugin, source lock, Architecture pin, and Control Plane pin.

- Added the reproducible Dev Container, Feature, bootstrap, workflow-caller,
  and Agent Plugin distribution scaffold.
