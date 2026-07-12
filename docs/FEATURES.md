# Sudden Strike Feature Implementation Plan
Combined from SS3 + SS4 manuals + SS fan guide. ✅ = done, ⬜ = todo.

---

## Module 1 — Visual Feedback & HUD ✅
- ✅ Health bars, Alt toggle, status icons (T/E/⊘/⛏/!/►)
- ✅ Classic SS HUD: minimap + fog overlay, 8 cmd buttons, info panel
- ✅ Pointer-events fix, minimap flat rectangle

## Module 2 — Controls ✅
- ✅ 20+ hotkeys: S/F/G/T/V/H/B/J/E/R/P/N/M/X/Q/C/Y/F9/Esc/Z
- ✅ Unit groups (Ctrl+0-9), camera save (F5-F8), Shift+waypoints

## Module 3 — Combat ✅
- ✅ Ammo, XP (+ XP from damage taken), component damage, armor facing, ricochet sparks
- ✅ Forest cover reduction, mine system, elite crew accuracy

## Module 4 — Support Units ✅
- ✅ Medic, Mechanic (turret), Supply/Fuel trucks, Officer, Sapper
- ✅ Supply truck passive ammo regen, 1:1 ammo cost, officer vision sharing

## Module 5 — Infantry ✅
- ✅ Grenades, Smoke, Sprint, First aid, Mine, Entrench
- ✅ TNT demolitions, Binoculars, Building garrison
- ✅ Infantry ammo scavenging while moving

## Module 6 — Terrain ✅
- ✅ Speed modifiers, dense forest, swamp, weather (rain/snow)

## Module 7 — Vehicle & Crew ✅
- ✅ Entry/exit, capture, towing, elite crews, ramming
- ✅ Vehicle reverse movement (40% speed, keeps front facing)

## Module 8 — Air Support ✅
- ✅ Air strike (with bombing run visual), Recon plane

## Module 9 — Sight & Detection ✅
- ✅ Fog of war (3D overlay + minimap), camouflage, recon
- ✅ LOS refresh delay (moving units -40% sight, officers -20%)

## Module 10 — Doctrine System ✅
- ✅ 3 doctrines (infantry/armor/support) integrated into menu

## Module 11 — Main Menu & Save/Load ✅
- ✅ Main menu: Dyle first/default, Mokra second with a Preview label, scenario-aware side policy, doctrine choice
- ✅ Save/load game (localStorage), F9 quicksave
- ✅ Escape opens menu

## Module 12 — Unit Formations ✅ (NEW)
- ✅ 5 types: Line, Column, Wedge, Block, Spread
- ✅ HUD selector panel with clickable icons
- ✅ Z key cycles formations

## Module 13 — HP Status System ✅ (NEW)
- ✅ Green (>50%): normal
- ✅ Yellow (20-50%): slow regen, vehicles immobilized, infantry half-speed
- ✅ Red (<20%): HP bleeds until death or healed

## Module 14 — Poland 1939 / Battle of Mokra 🚧

- ✅ **Mokra: Hold the Railway** is the second selectable battle and is labelled **Preview**, with Poland as the intended player side and Germany as the opponent
- ✅ Dedicated railway battlefield with constrained crossings, Mokra I–III settlement strips, woods, and cultivated western approaches
- ✅ Period-appropriate Polish core roster and constrained German attack roster; no 7TP or routine Panzer III in the scenario
- ✅ Defensive hold objective with phased German attacks
- ✅ **Advance to the Dyle** retained as the first/default selected scenario
- ✅ Empty Polish voice slots fail silently until real Polish recordings are supplied
- ⬜ Dedicated final Polish skins, infantry, gun, and vehicle models
- ⬜ Mounted cavalry and horse-limber systems
- ⬜ Armoured Train No. 53 *Śmiały*
- ⬜ Scripted Ju 87 attack phase
- ⬜ Counterattack and protected withdrawal objective phases

Detailed scope: [Mokra implementation record](scenarios/mokra.md). Full plan: [Poland 1939 campaign dossier](POLAND_1939_CAMPAIGN.md).
