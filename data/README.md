# data/ — editable game data

## units.csv — the unit roster

`units.csv` is the **editable unit roster**. At boot, `Game.loadUnitsCSV()`
(in `js/units.js`) fetches it and merges every row over the built-in baseline in
`Game.UNIT_STATS`, so you can tweak a stat or **add a whole new unit just by
editing this file** — no JS changes, no build step. If the file can't be loaded
(e.g. the page is opened via `file://`), the built-in roster is used unchanged.

It currently holds **~610 units**: the 38 hand-tuned French/German units the game
actually plays, plus the full **RWM / Sudden Strike roster** (~572 units across
all nations) imported as a reference library. The scenario only spawns what it
asks for, so the extra entries are data you can draw on, not active units.

### Columns

| Column | Meaning |
|---|---|
| `key` | unique id, `team_kind` (e.g. `french_s35`). The merge key. |
| `team` | `french` / `german` / `american` / `russian` / … (nation) |
| `kind`, `class` | `class` ∈ infantry / support / vehicle / aircraft / ship / train |
| `supportType` | medic / mechanic / supply / fuel / officer / sapper (optional) |
| `label` | display name |
| `weapon` | key into `Game.WEAPONS`. Imported units use a synthesized `rwm_*` weapon (see `w_*`). |
| `secondaryWeapon` | optional second weapon key |
| `hp`, `speed`, `size`, `sight`, `rotationSpeed`, `cost` | core stats |
| `color` | mesh tint (hex) |
| `driveType` | tracked / wheeled (vehicles) |
| `armor_front/side/rear` | armor plate (0 for infantry) |
| `turret_speed`, `turret_accel`, `hullTurnAccel` | vehicle traverse (blank = no turret) |
| `crew` | crew size (reference) |
| `year` | **introduction year** — era gating (see below) |
| `rwm_ref` | source RWM unit name (provenance for imported rows) |
| `w_type`, `w_fire`, `w_range`, `w_damage`, `w_cooldown`, `w_accuracy`, `w_supp`, `w_pen`, `w_blast` | weapon stats. Filled for imported units (the loader builds a weapon from them when `weapon` isn't already defined). **Leave blank to use a hand-authored weapon from `js/weapons.js`.** |

### Add a unit
Add a row with a unique `key`. Reference an existing weapon in the `weapon`
column, **or** give it a synthesized weapon by setting `weapon` to a new id and
filling the `w_*` columns. Turreted vehicles: set `turret_speed`/`turret_accel`.
Set a sensible `year`.

### Era gating (year)
Every unit has an introduction `year`. `Game.unitsForYear(year, team)` returns the
keys available by a given campaign year, so a 1940 campaign won't offer 1944 kit
(the StG-44, Tiger, Panther, etc. are correctly excluded). Units with no year are
always available.

### About the imported RWM values
RWM uses a different internal scale, so imported numbers are **scaled** into Under
Fire's ranges (speed ×3.3; HP ×0.6; range ÷11; armor kept ~as-is for vehicles) and
weapon accuracy/suppression/penetration are assigned by class. They're a solid
*starting point*, not balanced — refine any unit you actually field. Years are a
best-effort heuristic from each unit's name/gun plus a nation/type baseline. The
4 exact duplicates of our curated units (Somua, Char B1 bis, Pak 36, Pz I A) were
skipped on import. Full source roster + provenance: `docs/reference/rwm/`.
