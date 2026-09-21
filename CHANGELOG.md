# Changelog

## [Unreleased]

### Changed

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

- Added the reproducible Dev Container, Feature, bootstrap, workflow-caller,
  and Agent Plugin distribution scaffold.
