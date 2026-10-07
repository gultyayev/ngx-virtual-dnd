# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [3.5.0](https://github.com/gultyayev/ngx-virtual-dnd/compare/v3.4.0...v3.5.0) (2026-10-07)

### Features

- **lib:** support lists and items inside open shadow roots ([#125](https://github.com/gultyayev/ngx-virtual-dnd/issues/125)) ([73f362c](https://github.com/gultyayev/ngx-virtual-dnd/commit/73f362cd8f886189e2af1e00e0a07909f55ae6c7))

### Bug Fixes

- **lib:** compute scrollBy() and getScrollTop() from the element's live scrollTop ([#122](https://github.com/gultyayev/ngx-virtual-dnd/issues/122)) ([3622e11](https://github.com/gultyayev/ngx-virtual-dnd/commit/3622e113358ccd7356a66b456c0ec3056651331b))
- **lib:** count wrapped rows when calculating a plain list's source index ([#137](https://github.com/gultyayev/ngx-virtual-dnd/issues/137)) ([5113cdd](https://github.com/gultyayev/ngx-virtual-dnd/commit/5113cdd892c2fd521a94dc35b8a1ab39f3c23145))
- **lib:** keep a list's scroll position after a drop into it at its bottom ([#130](https://github.com/gultyayev/ngx-virtual-dnd/issues/130)) ([b7964f5](https://github.com/gultyayev/ngx-virtual-dnd/commit/b7964f573b22a7a922026a974c1f0418fcd228f0))
- **lib:** keep a mouse drag going when another button is released ([#138](https://github.com/gultyayev/ngx-virtual-dnd/issues/138)) ([fbc53c7](https://github.com/gultyayev/ngx-virtual-dnd/commit/fbc53c71cae9d9ac16019d9c2a0c652f73cc67db))
- **lib:** keep the clone root's own placement out of the drag preview ([#124](https://github.com/gultyayev/ngx-virtual-dnd/issues/124)) ([9f04d10](https://github.com/gultyayev/ngx-virtual-dnd/commit/9f04d100b27c7eebf8f4a56aa94265cba6e2b222))
- **lib:** let a pointer drag start on a button draggable or inside a control ([#127](https://github.com/gultyayev/ngx-virtual-dnd/issues/127)) ([6d468b7](https://github.com/gultyayev/ngx-virtual-dnd/commit/6d468b791b7ab2fe94b28872e6ad8bdf0fb5c4a7))
- **lib:** open the placeholder gap and scroll a vdndVirtualFor used directly in vdndScrollable ([#129](https://github.com/gultyayev/ngx-virtual-dnd/issues/129)) ([adb78fa](https://github.com/gultyayev/ngx-virtual-dnd/commit/adb78fac4187e6f3458a08e6a028e075138f70ae))
- **lib:** report the source list in dragEnd of a draggable destroyed mid-drag ([#121](https://github.com/gultyayev/ngx-virtual-dnd/issues/121)) ([7bb5b9e](https://github.com/gultyayev/ngx-virtual-dnd/commit/7bb5b9efb344a6302378233811d58047b44b3086))
- **lib:** reveal the keyboard placeholder again after it renders at a list's end ([4c7cfda](https://github.com/gultyayev/ngx-virtual-dnd/commit/4c7cfda2b5b2ab68981eba4b13dbb3cfe7b48981)), closes [#116](https://github.com/gultyayev/ngx-virtual-dnd/issues/116)
- **lib:** skip hidden droppables in keyboard cross-list navigation ([b8bf247](https://github.com/gultyayev/ngx-virtual-dnd/commit/b8bf247cb2ffbb14dd11353e5c5158c7da7aa3f7)), closes [#113](https://github.com/gultyayev/ngx-virtual-dnd/issues/113)
- **lib:** snap a constrained drop to the list edge only once the list is scrolled there ([#128](https://github.com/gultyayev/ngx-virtual-dnd/issues/128)) ([deee3aa](https://github.com/gultyayev/ngx-virtual-dnd/commit/deee3aad8c8f3c2f8af48ac9713d1013bcd7d22c))

## [3.4.0](https://github.com/gultyayev/ngx-virtual-dnd/compare/v3.3.0...v3.4.0) (2026-10-01)

### Features

- **lib:** scope the grabbing cursor to lists and items, skip it for touch drags ([#109](https://github.com/gultyayev/ngx-virtual-dnd/issues/109)) ([8c74877](https://github.com/gultyayev/ngx-virtual-dnd/commit/8c7487722d0be4e77372076f8d35efa1c1414109))

### Performance

- **lib:** run shift animations on the compositor by animating translate ([#110](https://github.com/gultyayev/ngx-virtual-dnd/issues/110)) ([4cccdcf](https://github.com/gultyayev/ngx-virtual-dnd/commit/4cccdcfb5abab89d80a87be70d8f3a66cc800867))

## [3.3.0](https://github.com/gultyayev/angular-vdnd/compare/v3.2.1...v3.3.0) (2026-09-30)

### Features

- **lib:** recycle vdnd-virtual-scroll rows with recycleRows ([#106](https://github.com/gultyayev/angular-vdnd/issues/106)) ([8fd5f33](https://github.com/gultyayev/angular-vdnd/commit/8fd5f33b6b56c3d2e8b68e703656ca6fce351148))

### Bug Fixes

- **lib:** emit drop at release instead of from a droppable effect ([#89](https://github.com/gultyayev/angular-vdnd/issues/89)) ([dd05b62](https://github.com/gultyayev/angular-vdnd/commit/dd05b6272879a8b010905bd5e434ce94a8baf9d3))

### Performance

- **lib:** cut drag-start, per-drop and per-frame work in lists and hit-testing ([#108](https://github.com/gultyayev/angular-vdnd/issues/108)) ([afe8bc4](https://github.com/gultyayev/angular-vdnd/commit/afe8bc4ea6391daf1461b976fd10d1baa896f242))
- **lib:** find droppables through a registry instead of document queries ([#88](https://github.com/gultyayev/angular-vdnd/issues/88)) ([1e613e7](https://github.com/gultyayev/angular-vdnd/commit/1e613e710e4243ba1357526bcbddce112be99a38))
- **lib:** forward sortable list outputs without template listeners ([#100](https://github.com/gultyayev/angular-vdnd/issues/100)) ([f85a49e](https://github.com/gultyayev/angular-vdnd/commit/f85a49e42f390b7973c424118925490aae0ff2f4))
- **lib:** make the draggable touchstart listener passive when a drag delay is set ([#107](https://github.com/gultyayev/angular-vdnd/issues/107)) ([858bf29](https://github.com/gultyayev/angular-vdnd/commit/858bf29014f1b357ae32c2277ee0418ce5f2c940))
- **lib:** move the drag preview in the pointer's animation frame ([#101](https://github.com/gultyayev/angular-vdnd/issues/101)) ([4e501d9](https://github.com/gultyayev/angular-vdnd/commit/4e501d93f8855d74e5fce44150044a62bd426227))
- **lib:** render only the virtual rows whose context changed ([#99](https://github.com/gultyayev/angular-vdnd/issues/99)) ([3325a36](https://github.com/gultyayev/angular-vdnd/commit/3325a3684d8bc3ac4185b39dac4ab3b642dcda25))
- **lib:** stop re-rendering every vdnd-virtual-scroll row on placeholder moves ([#105](https://github.com/gultyayev/angular-vdnd/issues/105)) ([273081a](https://github.com/gultyayev/angular-vdnd/commit/273081aeb89331f54ed749b986389c75e00fc392))
- **lib:** update HeightCache offsets only as far as a lookup needs ([#86](https://github.com/gultyayev/angular-vdnd/issues/86)) ([dbb7632](https://github.com/gultyayev/angular-vdnd/commit/dbb763282ad46fe14a6eaac9c825392a7a1897b9))

## [3.2.1](https://github.com/gultyayev/angular-vdnd/compare/v3.2.0...v3.2.1) (2026-09-27)

### Bug Fixes

- **lib:** account for contentOffset in vdnd-virtual-viewport drops ([a46d3d3](https://github.com/gultyayev/angular-vdnd/commit/a46d3d30d0ec3899e9b9fe10ca1055ef9a9d76e2))
- **lib:** allow destroying draggables and droppables before their first render ([b42c738](https://github.com/gultyayev/angular-vdnd/commit/b42c738b0a25f0786e7ad8ef9f631922a89e5dc9))
- **lib:** cancel a pending drag-delay timer when a new press starts ([909bbff](https://github.com/gultyayev/angular-vdnd/commit/909bbffd008d2f784ddc92df1376060c974191d0))
- **lib:** cancel a pointer drag when the window loses focus ([#77](https://github.com/gultyayev/angular-vdnd/issues/77)) ([19463f2](https://github.com/gultyayev/angular-vdnd/commit/19463f276034f091a2228d79fb8b8ef3424dc2b0))
- **lib:** cancel a touch drag when the system cancels the touch ([#85](https://github.com/gultyayev/angular-vdnd/issues/85)) ([9c4f2b0](https://github.com/gultyayev/angular-vdnd/commit/9c4f2b076e5575525a8f78e6a75e296aa88779e8))
- **lib:** deprecate placeholderId, which is always END_OF_LIST ([#82](https://github.com/gultyayev/angular-vdnd/issues/82)) ([84c1a8b](https://github.com/gultyayev/angular-vdnd/commit/84c1a8bb881cf3bab17d496bb945c8559cd94d5b))
- **lib:** don't let a second drag replace the one in progress ([#76](https://github.com/gultyayev/angular-vdnd/issues/76)) ([73d90cb](https://github.com/gultyayev/angular-vdnd/commit/73d90cb3aab4be72001e46665d219b7da9d53ad3))
- **lib:** end the scheduler frame when a participant stops the drag ([2a1c5b4](https://github.com/gultyayev/angular-vdnd/commit/2a1c5b4d3bd083143a06415282d85cd06037b703))
- **lib:** find the droppable and draggable parents at any depth ([#79](https://github.com/gultyayev/angular-vdnd/issues/79)) ([84501ef](https://github.com/gultyayev/angular-vdnd/commit/84501efe48fbb640afad976d92bbe51966eb27be))
- **lib:** follow the finger that started a touch drag ([#78](https://github.com/gultyayev/angular-vdnd/issues/78)) ([bc5ec2d](https://github.com/gultyayev/angular-vdnd/commit/bc5ec2de4e51c8f05533e2a23dbfd3e0161078ee))
- **lib:** keep radio buttons checked when the preview clones their row ([6b4a31f](https://github.com/gultyayev/angular-vdnd/commit/6b4a31f434e80139902e3624b64c4b8a0cb0aa0e))
- **lib:** leave keyboard-drag keys to the item being dragged ([#84](https://github.com/gultyayev/angular-vdnd/issues/84)) ([12c37c6](https://github.com/gultyayev/angular-vdnd/commit/12c37c6af3ee20a023eca067eb27c3f69dd1f226))
- **lib:** let no-drag cover the elements inside it ([#75](https://github.com/gultyayev/angular-vdnd/issues/75)) ([ac97757](https://github.com/gultyayev/angular-vdnd/commit/ac977575e28c7c67b781281c493d4e5c772405fd))
- **lib:** let Space reach form controls inside a draggable ([d786f82](https://github.com/gultyayev/angular-vdnd/commit/d786f82d0334a102356a756d48a14b9b5f3284d0))
- **lib:** make reorderItems ignore a missing source item ([6f093bd](https://github.com/gultyayev/angular-vdnd/commit/6f093bd78c173bd4a7dd19e86d3c58af17866f34))
- **lib:** read the source list untracked in moveItem ([a42f34e](https://github.com/gultyayev/angular-vdnd/commit/a42f34e7f4520db339217fc5a02f2208b41749c8))
- **lib:** render and tear down on the server without browser globals ([#81](https://github.com/gultyayev/angular-vdnd/issues/81)) ([0ef9567](https://github.com/gultyayev/angular-vdnd/commit/0ef95675f5d986e9138592dc1323fb73a0d635cf))
- **lib:** render the rows in view in vdnd-virtual-viewport with a large contentOffset ([7004826](https://github.com/gultyayev/angular-vdnd/commit/7004826df28869183fdb0642477a23aa27f3adb0))
- **lib:** start and stop measuring rows when dynamicItemHeight changes ([#80](https://github.com/gultyayev/angular-vdnd/issues/80)) ([4090360](https://github.com/gultyayev/angular-vdnd/commit/40903605082af5d7dd98e6fe53a0a379e8ad2b25))
- **lib:** store the offset the browser applied in VirtualScrollContainer.scrollTo ([ea3bc1a](https://github.com/gultyayev/angular-vdnd/commit/ea3bc1aeb07fd1868f6019e109b132e26af48d9f))

## [3.2.0](https://github.com/gultyayev/angular-vdnd/compare/v3.2.0-alpha.2...v3.2.0) (2026-09-25)

## [3.2.0-alpha.2](https://github.com/gultyayev/angular-vdnd/compare/v3.2.0-alpha.1...v3.2.0-alpha.2) (2026-09-25)

### Features

- **lib:** animate the drag preview into place on drop ([#72](https://github.com/gultyayev/angular-vdnd/issues/72)) ([57186dc](https://github.com/gultyayev/angular-vdnd/commit/57186dc07a671a75c3853bf0c850a751cd5a3979))

## [3.2.0-alpha.1](https://github.com/gultyayev/angular-vdnd/compare/v3.2.0-alpha.0...v3.2.0-alpha.1) (2026-09-24)

### Features

- **docs:** add Rspress documentation site and upgrade npm to 12 ([#69](https://github.com/gultyayev/angular-vdnd/issues/69)) ([723fab1](https://github.com/gultyayev/angular-vdnd/commit/723fab1306253688b15d11c5dac8ab2001b7cf0e))

### Bug Fixes

- **lib:** end same-list keyboard navigation at the list's last slot ([a5191de](https://github.com/gultyayev/angular-vdnd/commit/a5191de55952f14fd05dd9c434cc25d1d3208c4f))
- **lib:** keep the placeholder in view during keyboard drag autoscroll ([29c0c42](https://github.com/gultyayev/angular-vdnd/commit/29c0c426f1e9d7355455b8669418284158d82a51))
- **lib:** scroll to the drop position on each keyboard move and fix the focus fallback ([abd1760](https://github.com/gultyayev/angular-vdnd/commit/abd1760ddc3811b67f5ae1ab87430f397be687a9))

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
