# Troubleshooting — ngx-virtual-dnd

Load this doc when debugging unexpected behavior.

## Common Issues

| Error/Symptom                                         | Cause                                                              | Fix                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `elementFromPoint` returns null                       | Target outside viewport                                            | `scrollIntoViewIfNeeded()` first                                                        |
| Placeholder not appearing                             | Group mismatch                                                     | Check `vdndDroppableGroup` matches                                                      |
| Drag preview stuck                                    | Listener cleanup missed                                            | Check `ngOnDestroy` removes listeners                                                   |
| Safari drift during scroll                            | Using `scrollBy()`                                                 | Use direct `scrollTop +=`                                                               |
| Changes not appearing in demo                         | Library not rebuilt                                                | Run `ng build ngx-virtual-dnd`                                                          |
| Dev server: `Could not find module 'ngx-virtual-dnd'` | `ng build ngx-virtual-dnd` replaced `dist/` under it               | Restart `npm start` after each library build                                            |
| A fully hidden list is still hit or scrolled          | A clipped `DOMRect` with a negative height normalizes into the gap | Already fixed — `lib/utils/scroll-insets.ts` helpers return `null` when no area is left |
| Signal write error in effect                          | Using deprecated option                                            | Remove `allowSignalWrites: true`                                                        |
| Drag preview offset in Ionic/transformed container    | Ancestor CSS `transform` breaks `position: fixed`                  | Already fixed — `OverlayContainerService` teleports preview to body                     |
| Unit test can't find drag preview element             | Preview teleported to overlay container                            | Use `document.querySelector()` instead of `fixture.debugElement.query()`                |
| Short item displaces tall item too early              | Probe enters tall item's range at ~20% overlap                     | Already fixed — midpoint refinement in `DragIndexCalculatorService`                     |
| Autoscroll stops short of the end, pointer at rest    | List grew after autoscroll found no room left                      | Already fixed — `AutoScrollService` retries it when its geometry changes                |
