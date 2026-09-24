# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [3.2.0-alpha.0](https://github.com/gultyayev/angular-vdnd/compare/v3.1.3...v3.2.0-alpha.0) (2026-09-24)

### Features

- **lib:** add shift animation and placeholderMove event ([#68](https://github.com/gultyayev/angular-vdnd/issues/68)) ([0d697f0](https://github.com/gultyayev/angular-vdnd/commit/0d697f0f55f54e18d9e298eea388c240389c2d03))

## [3.1.3](https://github.com/gultyayev/angular-vdnd/compare/v3.1.2...v3.1.3) (2026-07-18)

### Bug Fixes

- **demo:** remove Ionic md elevation shadow from task page headers ([e22ee19](https://github.com/gultyayev/angular-vdnd/commit/e22ee19410cc215faf57c48c49674af5e5d34373))
- **e2e:** wait for stable demo layout ([#65](https://github.com/gultyayev/angular-vdnd/issues/65)) ([74e4242](https://github.com/gultyayev/angular-vdnd/commit/74e4242da76c5d1c78ea0d1e61a39997dd994f40))
- gate perf by measuring base and head on the same runner ([#63](https://github.com/gultyayev/angular-vdnd/issues/63)) ([62d314f](https://github.com/gultyayev/angular-vdnd/commit/62d314f5c471a9269dbe6c5cc661d2695c78a3ea))
- **lib:** exclude disabled droppables from drag-time candidate sets ([#51](https://github.com/gultyayev/angular-vdnd/issues/51)) ([0efb3ec](https://github.com/gultyayev/angular-vdnd/commit/0efb3ec740c3536c1d05e7a72f2e4ddd0f4d3a7b))
- **lib:** fall through exhausted nested containers in autoscroll ([#60](https://github.com/gultyayev/angular-vdnd/issues/60)) ([38eee56](https://github.com/gultyayev/angular-vdnd/commit/38eee565d5c46e85dda1b880a8904c125653b574))
- **lib:** make autoscroll registration resilient to post-init layout changes ([#61](https://github.com/gultyayev/angular-vdnd/issues/61)) ([c71c51c](https://github.com/gultyayev/angular-vdnd/commit/c71c51c5ade6a535216149e05e37e0222bdbfbed))
- **lib:** normalize keyboard drag end index ([#45](https://github.com/gultyayev/angular-vdnd/issues/45)) ([4f54b8f](https://github.com/gultyayev/angular-vdnd/commit/4f54b8ffb85ccd331e150a8c7f19139b68f6060d))
- **lib:** preserve source index across rapid cross-list drags ([#44](https://github.com/gultyayev/angular-vdnd/issues/44)) ([6695753](https://github.com/gultyayev/angular-vdnd/commit/6695753c3691930ea1a880a58a7fe128abefa4cc))
- **lib:** refresh drag hit-test candidates on mid-drag DOM changes ([#58](https://github.com/gultyayev/angular-vdnd/issues/58)) ([b9d21d7](https://github.com/gultyayev/angular-vdnd/commit/b9d21d7bd8c8bed754627c0cb4e0ccd212e70303))
- **lib:** route keyboard cross-list count through DragIndexCalculatorService ([#59](https://github.com/gultyayev/angular-vdnd/issues/59)) ([a2bd956](https://github.com/gultyayev/angular-vdnd/commit/a2bd95678b48c04bd2447ed62a6f131a460f6b81))
- make performance regression gate reliable ([#52](https://github.com/gultyayev/angular-vdnd/issues/52)) ([061828c](https://github.com/gultyayev/angular-vdnd/commit/061828c7402e5f769fa42d92428d2f51c808bf7b))

### Performance

- **lib:** stop active droppable effect from re-snapshotting every frame ([#62](https://github.com/gultyayev/angular-vdnd/issues/62)) ([b2acd8a](https://github.com/gultyayev/angular-vdnd/commit/b2acd8a3212411151d575d976b26ef0afb40a5d4))

## [3.1.2](https://github.com/gultyayev/angular-vdnd/compare/v3.1.1...v3.1.2) (2026-07-07)

### Bug Fixes

- **lib:** refresh viewport transforms on drag exclusion changes ([2057a38](https://github.com/gultyayev/angular-vdnd/commit/2057a387398dc5b3ff02b4a3c2fff42d39e4acf9))
- **lib:** safely resolve consumer IDs in attribute lookups ([ab2ea17](https://github.com/gultyayev/angular-vdnd/commit/ab2ea17091ba7ff883c4a55518a60434c5861461))
- **lib:** sync auto-scroll registration with signal inputs ([c084a32](https://github.com/gultyayev/angular-vdnd/commit/c084a32aa458326a8a684e17270c3ab4c5bf50f9))

## [3.1.1](https://github.com/gultyayev/angular-vdnd/compare/v3.1.0...v3.1.1) (2026-06-24)

### Performance

- **lib:** drag-and-drop hot-path optimizations ([#18](https://github.com/gultyayev/angular-vdnd/issues/18)) ([7f07562](https://github.com/gultyayev/angular-vdnd/commit/7f075621c78886ae1ced105f3835b2844c11cb5b))

## [3.1.0](https://github.com/gultyayev/angular-vdnd/compare/v3.0.1...v3.1.0) (2026-06-23)

### Features

- **lib:** allow Angular 22 in peer dependency range ([40db308](https://github.com/gultyayev/angular-vdnd/commit/40db3087867e44bd0698c7940bd278e44135549f))

## [3.0.1](https://github.com/gultyayev/angular-vdnd/compare/v3.0.0...v3.0.1) (2026-03-05)

### Performance

- **lib:** cache droppable metadata during active drag ([53f9c59](https://github.com/gultyayev/angular-vdnd/commit/53f9c59fd231172cdfe120113dc7abaf320895d7))
- **lib:** optimize hot-path services for active drag ([6be81b4](https://github.com/gultyayev/angular-vdnd/commit/6be81b4ce4fbd088b9ca739b0058be182973afbc))

## [3.0.0](https://github.com/gultyayev/angular-vdnd/compare/v2.0.0...v3.0.0) (2026-02-20)

### ⚠ BREAKING CHANGES

- **lib:** dragMove, dragReadyChange, dragEnter, dragLeave,
  dragOver, visibleRangeChange, and scrollPositionChange outputs have
  been removed along with their associated event types. Use
  DragStateService signals for equivalent reactive state, and the
  vdnd-drag-pending CSS class instead of dragReadyChange.

### Features

- **lib:** remove 7 unused outputs from public API ([ff680d8](https://github.com/gultyayev/angular-vdnd/commit/ff680d82183e4e95e6b3f61cc3940d8c7962eca8))

### Bug Fixes

- **lib:** clamp constrainToContainer to scroll viewport and fix flaky E2E reorder ([2ac1bd6](https://github.com/gultyayev/angular-vdnd/commit/2ac1bd673f10435b05b7613883b87e2317d89412))

## [2.0.0](https://github.com/gultyayev/angular-vdnd/compare/v2.0.0-alpha.1...v2.0.0) (2026-02-17)

## [2.0.0-alpha.1](https://github.com/gultyayev/angular-vdnd/compare/v2.0.0-alpha.0...v2.0.0-alpha.1) (2026-02-14)

### Performance

- **lib:** split high-frequency signals from monolithic drag state ([18d642f](https://github.com/gultyayev/angular-vdnd/commit/18d642f880461f4c59d5252ab1eee1b8c0bbc506))

## [2.0.0-alpha.0](https://github.com/gultyayev/angular-vdnd/compare/v1.3.0-alpha.6...v2.0.0-alpha.0) (2026-02-13)

### ⚠ BREAKING CHANGES

- **lib:** VirtualContentComponent template restructured — virtual
  area is now wrapped in a `.vdnd-virtual-area` div. Consumers using
  `contentOffset` are unaffected (it remains as an escape hatch).
- **lib:** `totalItems` input removed from `VirtualViewportComponent`
  and `VirtualContentComponent`. The total item count is now derived
  automatically from the child `VirtualForDirective` via the shared strategy.

DX improvements:

- `*vdndVirtualFor` inherits `itemHeight`, `dynamicItemHeight`, and
  `droppableId` from parent viewport/droppable when inside one — only
  `trackBy` remains required on the directive
- `VirtualSortableListComponent.group` is now optional — inherits from
  parent `vdndGroup` directive
- `FixedHeightStrategy.setItemKeys()` now bumps `version` on count change,
  enabling strategy-derived total height
- `VirtualScrollStrategy.getItemCount()` is now a required interface method

Migration: Remove `[totalItems]` bindings from `vdnd-virtual-viewport` and
`vdnd-virtual-content`. Remove redundant `itemHeight`, `dynamicItemHeight`,
and `droppableId` from `*vdndVirtualFor` when inside a viewport component.

### Features

- **lib:** auto-measure projected header height via ContentHeaderDirective ([b94b634](https://github.com/gultyayev/angular-vdnd/commit/b94b6345f2d0f8e2da861ed72d9e7cc6e40ac73f))
- **lib:** eliminate data duplication in Pattern B consumer API ([2745934](https://github.com/gultyayev/angular-vdnd/commit/2745934ea1280f17ca7c01c622ec7409a5f789e0))

### Bug Fixes

- **lib:** unify constrained mode probe logic with capped center ([9e20230](https://github.com/gultyayev/angular-vdnd/commit/9e20230df4d1870787660579f123c0bfb6432eb5))

## [1.3.0-alpha.6](https://github.com/gultyayev/angular-vdnd/compare/v1.3.0-alpha.5...v1.3.0-alpha.6) (2026-02-13)

### Bug Fixes

- **lib:** dynamic height drift cases ([916d97e](https://github.com/gultyayev/angular-vdnd/commit/916d97eded0261ccb135daafc3b4d0b0b56cc29b))

## [1.3.0-alpha.5](https://github.com/gultyayev/angular-vdnd/compare/v1.3.0-alpha.4...v1.3.0-alpha.5) (2026-02-13)

### Bug Fixes

- **lib:** harden dynamic height strategy performance and correctness ([9caac28](https://github.com/gultyayev/angular-vdnd/commit/9caac28ecd32fe8c9d41d4cd3098bd1a59a29a08))
- **lib:** use direction-aware probing for dynamic drag index ([b6346d1](https://github.com/gultyayev/angular-vdnd/commit/b6346d1113b733dc6fd94f5cfa8e5dbf7b13152b))

## [1.3.0-alpha.4](https://github.com/gultyayev/angular-vdnd/compare/v1.3.0-alpha.3...v1.3.0-alpha.4) (2026-02-13)

### Bug Fixes

- **lib:** allow constrained dynamic drag to reach list edges ([38519b2](https://github.com/gultyayev/angular-vdnd/commit/38519b27648d1d8c8de6d0f50f2af55b5dea5da4))

## [1.3.0-alpha.3](https://github.com/gultyayev/angular-vdnd/compare/v1.3.0-alpha.2...v1.3.0-alpha.3) (2026-02-13)

### Features

- **lib:** warn of trackBy duplicates ([087f77d](https://github.com/gultyayev/angular-vdnd/commit/087f77de697854e0f7cd96431c65a4bb491f4a27))

## [1.3.0-alpha.2](https://github.com/gultyayev/angular-vdnd/compare/v1.2.3...v1.3.0-alpha.2) (2026-02-13)

### Features

- **lib:** add dynamic item height support for virtual scroll ([#15](https://github.com/gultyayev/angular-vdnd/issues/15)) ([a7479e3](https://github.com/gultyayev/angular-vdnd/commit/a7479e38671b8269b897fa56f781a7182609e150))
- **lib:** constrain drag by container ([#16](https://github.com/gultyayev/angular-vdnd/issues/16)) ([2fe954f](https://github.com/gultyayev/angular-vdnd/commit/2fe954f4b2cc3f92929bad01df679b7692243197))

### Bug Fixes

- **lib:** don't print warnings in prod mode ([d987c96](https://github.com/gultyayev/angular-vdnd/commit/d987c96bbd98c8ae0a5d94c9668d02a6e06f7792))
- **lib:** stabilize same-list dynamic placeholder index before exclusion sync ([fe6063d](https://github.com/gultyayev/angular-vdnd/commit/fe6063dc77cdc8db02e5ca814d78daf23fe4854c))

## [1.3.0-alpha.1](https://github.com/gultyayev/angular-vdnd/compare/v1.3.0-alpha.0...v1.3.0-alpha.1) (2026-02-12)

### Bug Fixes

- fix e2e ([0d9e468](https://github.com/gultyayev/angular-vdnd/commit/0d9e4684d31c27cc8daaf8f70999c8750c9ddea6))
- fix gaps ([2b352ec](https://github.com/gultyayev/angular-vdnd/commit/2b352ec982e8e9f1c8c1de08c35b393b87c8b518))
- fix height shrinkage ([d9030e5](https://github.com/gultyayev/angular-vdnd/commit/d9030e5a7fd5707f9db8a3ade90aa6293c8f9b68))

## [1.3.0-alpha.0](https://github.com/gultyayev/angular-vdnd/compare/v1.2.3...v1.3.0-alpha.0) (2026-02-11)

### Features

- **lib:** add dynamic item height support for virtual scroll ([5678c3c](https://github.com/gultyayev/angular-vdnd/commit/5678c3c3fa60b5202c77a2c1c3f8b0c08528b7ae))

### Bug Fixes

- **lib:** don't print warnings in prod mode ([d987c96](https://github.com/gultyayev/angular-vdnd/commit/d987c96bbd98c8ae0a5d94c9668d02a6e06f7792))
- **lib:** fix scroll with drag in dynamic height ([871f9b4](https://github.com/gultyayev/angular-vdnd/commit/871f9b4e99bfd7b1c40264506e38eb9517cbcfb2))

## [1.2.3](https://github.com/gultyayev/angular-vdnd/compare/v1.2.2...v1.2.3) (2026-02-06)

### Bug Fixes

- **lib:** teleport drag preview to body overlay to fix CSS transform offset ([979c443](https://github.com/gultyayev/angular-vdnd/commit/979c44372b1b6e4c93c48567ac06515b2a01409f))

## [1.2.2](https://github.com/gultyayev/angular-vdnd/compare/v1.2.1...v1.2.2) (2026-01-24)

### Performance

- **lib:** reduce drag jank and dedupe scroll bindings ([#9](https://github.com/gultyayev/angular-vdnd/issues/9)) ([52b0177](https://github.com/gultyayev/angular-vdnd/commit/52b01773113ed05db9dfc1820f2882454c7467f6))

## [1.2.1](https://github.com/gultyayev/angular-vdnd/compare/v1.2.0...v1.2.1) (2026-01-23)

### Bug Fixes

- **lib:** prevent axis-lock offset at drag start ([#7](https://github.com/gultyayev/angular-vdnd/issues/7)) ([3cf1611](https://github.com/gultyayev/angular-vdnd/commit/3cf161114912676b45414f197bc15a4c7de1e756))

### Performance

- **lib:** use transform-based positioning for drag preview ([#5](https://github.com/gultyayev/angular-vdnd/issues/5)) ([fcd8c75](https://github.com/gultyayev/angular-vdnd/commit/fcd8c758ad920a0a4e1a19acd27a90797c906d29))

## [1.2.0](https://github.com/gultyayev/angular-vdnd/compare/v1.1.2...v1.2.0) (2026-01-23)

### Features

- **demo:** add page-level scroll demo with Ionic ([#4](https://github.com/gultyayev/angular-vdnd/issues/4)) ([d1c7fb1](https://github.com/gultyayev/angular-vdnd/commit/d1c7fb18c5b6b5903b929b13e533452198d36af8))

## [1.1.2](https://github.com/gultyayev/angular-vdnd/compare/v1.1.1...v1.1.2) (2026-01-14)

### Performance

- **lib:** optimize change detection and reduce allocations during drag ([1b8a579](https://github.com/gultyayev/angular-vdnd/commit/1b8a5791aa36010c95a11fc72dcf4aed03e987d2))

## [1.1.1](https://github.com/gultyayev/angular-vdnd/compare/v1.1.0...v1.1.1) (2026-01-08)

## [1.1.0](https://github.com/gultyayev/angular-vdnd/compare/v1.0.0...v1.1.0) (2026-01-08)

### Features

- **lib:** add a11y support ([3ebccec](https://github.com/gultyayev/angular-vdnd/commit/3ebccec10d447e9840168d0a1e97a5a5039188ed))
