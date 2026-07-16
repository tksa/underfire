# Controls — Under Fire vs. Sudden Strike 2

Source of truth for the SS2 column: the official Sudden Strike 2 manual,
§III.I "Key Configuration" (p. 25-26) plus the orders described in §III.E/F.
Status legend: **✅ have** (matches SS2) · **≈ different** (feature exists,
different key/behavior) · **❌ missing** (not implemented) · **n/a** (not
applicable in a browser or to this game's design).

## Keyboard

| SS2 binding | SS2 function | Status | Under Fire |
|---|---|---|---|
| Q W E R / A S D F / Z X C V | Orders Menu positions 1-12 (contextual 3×4 grid) | ≈ | No positional grid; fixed action keys instead (below). The HUD command bar is the equivalent of the orders menu. |
| T | Hold Fire on/off | ✅ | T (H kept as alias) |
| G | Stand Ground on/off | ✅ | G — hold position, weapons stay free |
| B | Special Order on/off | ≈ | B = Air strike targeting (our closest "special order") |
| Ctrl + 1-0 | Save unit selection to group | ✅ | Ctrl+0-9 |
| 1-0 | Recall saved selection | ✅ | 0-9 (double-tap also centers the camera on the group — extra) |
| Tab | Center view around selected units | ✅ | Tab |
| Spacebar | Center view around last event (red circle) | ≈ | Space = tactical pause here (kept — long-standing muscle memory); L jumps to the last attack instead |
| Pause | Pause mode on/off (orders can still be issued) | ✅ | Pause key, P, or Space |
| Esc | Control Options Menu | ✅ | Esc opens the game menu |
| Ctrl + F1-F8 | Save map view position | ✅ | Ctrl+F1-F8 |
| F1-F8 | Recall map view position | ✅ | F1-F8 |
| F9 | Display mission objectives | ✅ | F9 |
| F10 | Exit game | n/a | Browser owns window closing; use the menu |
| F11 | Open Save menu | n/a | No mid-mission save yet (browser F11 = fullscreen) |
| F12 | Open Load menu | n/a | As above (browser F12 = devtools) |
| Shift + order | Append order to the end of the queue | ✅ | Shift+right-click queues waypoints |
| Ctrl + Move order | Gather at destination | ✅ | Ctrl/Cmd+right-click — converge on the point (plain right-click uses formation slots) |
| Ctrl + double-click unit | Select all units of that type map-wide | ≈ | Double-click selects all of that type (no Ctrl needed) |
| ; | Show number of reinforcements on their way | ≈ | ; shows a reinforcement intelligence report |
| M (hold) | Tactical map overlay | ❌ | Minimap is always visible instead |
| Backspace / Enter (chat) | Multiplayer chat | n/a | Single-player game |

## Under Fire keys with no SS2 equivalent

| Key | Function |
|---|---|
| E | Toggle right-click order stance: Move ↔ Attack-move |
| F | Attack ground (suppress a spot) |
| R | Rotate/face a direction |
| Q | Throw grenade (SS2 grenades live in the orders grid) |
| N | Throw smoke |
| Z | Cycle formation (line/column/wedge/block/spread) |
| X | Cycle posture (attention / at ease / auto) |
| C | Guard an area (patrol circle) |
| V | Stop / cancel orders |
| S | Infantry run/walk toggle |
| / | Cycle behavior (defensive/aggressive/cautious) |
| J | Fighter cover — opens the squadron menu (plane types + counts); pick one, the green patrol ring follows the cursor, right-click calls the sortie (approach path = the map edge nearest the click). An airborne plane is click-selectable like a tank; right-click then re-tasks its patrol circle. (SS2 ran air support through orders-menu plane icons + waypoints.) |
| Alt | Toggle all health bars |
| L | Jump to last attack |
| ` | Debug panel |

## Mouse

| SS2 | Status | Under Fire |
|---|---|---|
| Left-click / drag: select / box-select | ✅ | Same (Shift adds to selection). Left-click only ever selects — mounting, boarding, manning guns and tow hook-ups are right-click orders |
| Right-click: move / contextual action | ✅ | Same; E toggles move vs attack-move stance |
| Right-click + drag on open terrain | — | The press point is the destination and the arrow sets the formation's final facing. Drag beside the selected formation to rotate it in place. Shift queues the destination/facing order; Ctrl/Cmd retains gather behavior. |
| Right-click enemy: attack | ✅ | Same |
| Right-click building with infantry selected: enter | ✅ | Same (right-click only; left-click selects; capacity enforced) |
| Hover a riderless horse with its linked Ułan selected | — | Shows the green enter cursor; right-click sends the Ułan to the horse's mounting side. The horse itself cannot be selected or controlled. |
| Select building → unload occupants | ✅ | Select a garrisoned building (click it with nothing else selected): right-click terrain = **all** file out and move there; right-click the building itself = **one** soldier steps out |
| Cursor edge scrolling | ✅ | Same (+ WASD/arrow keys, wheel zoom) |
| Double right-click ground | — | Retreat order (Under Fire extra) |
| Double right-click enemy armor | — | Selected foot infantry close assault: they charge the vehicle and throw AT grenade bundles from short range (2 per man). Single right-click with rifle infantry refuses instead: small arms cannot hurt real armor, and riflemen automatically seek cover, kneel, or give ground when a tank approaches. |

## Garrison display (SS2 §III.D "Unit Status")

SS2 shows, for any building containing units, the occupants' status bars even
when the building is not selected. Under Fire now does the same: buildings
with troops inside show a floating stack — one row per soldier — with a green
**life** bar and a yellow **ammo** bar, plus an occupancy count. The selected
building gets a gold frame. (SS2's blue morale / red experience bars exist as
unit stats but are not drawn in the building stack yet.)

## Known gaps vs. SS2 (candidates for later)

- Orders-menu **positional** hotkeys (Q-W-E-R…) mapped to the HUD grid slots.
- Building floor distribution modes (sequential / even / by visibility).
- Mid-mission save/load (F11/F12).
- Morale (blue) and experience (red) bars in the garrison stack.
- Hold-M tactical map overlay (we have a permanent minimap).
