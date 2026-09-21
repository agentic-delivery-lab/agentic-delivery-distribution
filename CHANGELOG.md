# Changelog

## [Unreleased]

### Changed

- The draft consumer bundle now pins Control Plane `0.2.0-draft.3` at
  `5dc5dbf2231df354cca1afb8ad66acc0bf940bac`; upgrades remain explicit and
  rollbackable through the bundle manifest.
- The draft consumer bundle now pins the first locally validated Control Plane commit, including its central intake path fix, instead of a pre-contract commit that lacks the release validators.

### Added

- Added the reproducible Dev Container, Feature, bootstrap, workflow-caller,
  and Agent Plugin distribution scaffold.
