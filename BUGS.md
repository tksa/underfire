# Under Fire — Bug List

A living list of known issues, sourced from playtests and community feedback.
As the project grows these should become GitHub issues; for now this is the
running tracker.

Severity: **P0** = blocks enjoyable play · **P1** = major · **P2** = minor/polish.

_Last updated: 2026-06-24._

## Fixed (pending deploy / in this build)

| # | Sev | Bug | Reported by | Fix |
|---|-----|-----|-------------|-----|
| 1 | P0 | **Infantry don't fire at the enemy** | willythemoviemaker | Root cause: target acquisition/firing was gated by the player **fog-of-war grid**, so units wouldn't engage enemies the shared map hadn't revealed (even point-blank), and targeted farther revealed enemies over closer ones. Removed the fog gate from `unitCanSee` (`js/pathfinding.js`) — units now engage based on their own sight + line-of-sight. Verified: a pinned target takes damage. |
| 2 | P0 | **AT guns don't fire** | willythemoviemaker | Same fog-gate cause (AT guns share the targeting path). Verified: 25mm AT dealt ~90 dmg to a pinned tank after the fix. |
| 3 | P1 | **Units vanish instantly on death** (no corpse/wreck) | willythemoviemaker | Centralised death handling in `js/renderer.js`: any death now leaves a remnant regardless of cause — infantry fall as a body, vehicles become a charred wreck. Verified. |
| 4 | P1 | **Shoot through objects (trees/hedges)** | willythemoviemaker | `lineOfSight` (`js/pathfinding.js`) barely reduced LOS through foliage. Now forests/hedges/orchards progressively obscure the line and block when thick enough; walls/buildings remain hard blockers. Verified: a 4-tile forest blocks LOS; open ground stays clear. |
| 5 | P1 | **No main menu to go back to** | willythemoviemaker | Escape already reopened the menu but there was no visible control. Added an in-game **☰ Menu** button (`index.html`) that pauses and reopens the menu. Verified. |
| 6 | P2 | **"Tanks don't fire on their own"** | willythemoviemaker (via tksa: it's a UI issue) | Tanks do fire; they were silently **out of ammo**. The old ammo indicator drew off the (8px) health-bar canvas and only redrew on HP change. Added a real overhead **ammo bar** (blue/amber/red) that shows whenever a unit is low/empty, and clear **LOW AMMO / OUT OF AMMO** warnings in the Selected panel (single + group). (`js/renderer.js`, `js/units.js`) |

## Works as intended / needs polish (not a code bug)

| # | Sev | Item | Notes |
|---|-----|------|-------|
| 6 | P0 | **Attack-move** | Exists: the **Attack** command (button / `E`) issues an assault-move that pauses to engage. With the firing fix, units now also shoot at enemies in range while moving on a normal move. |
| 7 | P1 | **Formations** | `issueCommand` applies rotated per-unit formation offsets; verified 5 units form distinct slots (e.g. a line). Units currently path to their slots individually, so they arrange **at the destination** rather than marching in formation. In-transit formation movement is a future polish item, not a broken feature. |
| 8 | P1 | **"Tanks shoot through buildings"** | Buildings and walls **do** hard-block LOS in the tile model (verified `lineOfSight` returns blocked through a house). What's left is a visual mismatch: building **meshes** are larger/taller than their tile footprints, so a shot can look like it clips a building edge. Tightening footprints to match meshes is a future refinement. |

## Open

| # | Sev | Bug | Reported by | Suspected area |
|---|-----|-----|-------------|----------------|
| 9 | P1 | **Pathfinding routes wrong around buildings** ("goes left" when driving around). | willythemoviemaker | `js/pathfinding.js` A* — heuristic/tie-breaking or vehicle-footprint handling around `house`/`wall` tiles. Needs a dedicated pass. |
| 10 | P1 | **No pathfinding inside buildings.** | willythemoviemaker | By current design `house` tiles are solid (`sightBlock`/blocked). If garrisoning/entering is wanted, needs entry points + a garrison path; otherwise this is working-as-designed. |

## Notes
- Community sentiment: "far from playable in an enjoyable sense" (tesserS). The firing fix (#1/#2) is the biggest single improvement.
- Move fixed items here with the commit/PR as they're verified.
