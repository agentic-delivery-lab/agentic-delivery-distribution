# Changelog

## [Unreleased]

### Changed

- The draft consumer bundle now pins the Control Plane acceptance release at
  `8e6bcde17add29f3cc5932df96282b4b15fb32eb`; consumers gain the offline
  multi-repository identity and rollback contract through an explicit pin.

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
