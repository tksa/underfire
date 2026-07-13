
# Under Fire — Design Brief

## Current opening battle: Dyle, 1940

The first and default selected battle is **Advance to the Dyle**, the French-versus-German 1940 prototype documented in detail below.

## Second scenario Preview: Mokra, 1939

**Mokra: Hold the Railway** is the second selection and is currently labelled **Preview**. It is set on 1 September 1939 with Poland player-controlled against Germany. Its current vertical slice centres on a five-minute defence of the railway crossing by elements of the reinforced Wołyńska Cavalry Brigade against phased attacks associated with the German 4th Panzer Division.

The scenario-specific implementation record, roster, map constraints, and historical guardrails are in [scenarios/mokra.md](scenarios/mokra.md). The complete research and campaign plan is preserved in [POLAND_1939_CAMPAIGN.md](POLAND_1939_CAMPAIGN.md).

The current slice includes the Polish defensive deployment, early-war Polish and German units, the railway battlefield, and attack waves. Its compressed opening formation alternates three Bofors anti-tank guns with three 75 mm field guns across six positions. Five five-man infantry sections occupy the intervals, backed by a full eight-man reserve squad, four player-controlled mounted Ułan reserves east of the railway, two HMGs, one 46 mm mortar, and one 81 mm mortar. These counts serve the five-minute vertical slice and do not represent the full brigade establishment in the campaign dossier.

Mounted reserves use the distinct `mounted_ulan` unit identity; the existing `ulan` remains the dismounted cavalry rifleman used in the defensive line. Eligible reserve cavalry can mount and dismount when selected. On horseback each unit accelerates and brakes progressively, turns within a limited rate rather than pivoting instantly, and synchronises the supplied rigged GLB's walk/run playback to actual speed. Its purpose is rapid redeployment and disengagement before fighting on foot. There is no mounted anti-tank charge.

Polish commands use 75 unique active assets from the 77 supplied recordings. Infantry pools provide 16 selection, 30 movement, 6 core-attack, and 18 morale/patriotic takes. Tank pools reuse vehicle-neutral recordings in pools of 15 selection, 17 movement, 5 core-attack, 18 shared vehicle-safe morale/patriotic, and 8 stop takes. The first accepted attack order in each Polish infantry/tank stream and every third thereafter uses its morale pool; attack-move and attack-ground therefore acknowledge with attack rather than movement semantics. Drag-box selection produces one aggregate acknowledgement instead of one voice per selected unit. The final German Mokra echelon forces one `nie-zlamia-nas` mission cue.

Only `formal-variants/oddzial-gotow-panie-kapitanie` and `patriotic/za-warszawe` remain reserved. Dedicated vehicle-crew recordings remain desirable, but Polish tanks are not silent. The mounted cavalry reserve uses a user-supplied 17-clip rigged horse-and-rider model. Horse artillery limbers, Armoured Train No. 53 *Śmiały*, a scripted Ju 87 phase, the counterattack, and the protected Polish withdrawal remain planned extensions rather than implemented features.

## Primary design reference: Dyle Front 1940

**Advance to the Dyle** remains the first/default battle. The remainder of this document records its original 1940 prototype direction. Mokra-specific decisions are maintained separately in its scenario record and campaign dossier.

## Positioning

An original real-time tactics game inspired by the readability, pacing, and battlefield tension of classic top-down WWII RTT games, but rebuilt around richer visuals, more legible micro, and far more granular individual-unit modeling.

This is **not** a direct Sudden Strike clone. The goal is to capture the market fantasy:
large tactical battlefields, lethal positioning, vehicle duels, infantry fragility, and battlefield texture.

## Historical framing

I interpreted the request as the **opening 1940 Western campaign / Battle of France**, especially the Allied move into Belgium on 10 May 1940, rather than a literal “French invasion in 1940.” Britannica describes the Battle of France as the German invasion of the Low Countries and France from **May 10 to June 25, 1940**. It also notes that French and British forces moved north into Belgium as part of their initial response. The main earlier French ground offensive against Germany was the **Saar Offensive in September 1939**, not 1940. citeturn0search0turn0search2turn0search5

That framing gives you a strong visual and mechanical identity:
- French mechanized cavalry
- early-war armor duels
- orchards, villages, roads, hedgerows, and canal approaches
- doctrinal mismatch between excellent French armor and poorer operational tempo

## Creative direction

Working title: **Dyle Front 1940**

Tone:
- muddy, tense, tactile
- high-detail ground treatment
- smoke, dust, tracked scars, shell craters, broken masonry
- lower glamour than a heroic RTS, higher immediacy than abstract strategy

Camera:
- top-down / high oblique, readable at operational zoom
- smooth close zoom for unit-level inspection
- silhouettes and selection readability must survive all terrain conditions

## Pillars

### 1. Individual-unit granularity
Every soldier and vehicle is a meaningful object.

Per-unit simulation:
- health / wound state
- suppression / morale
- stance
- fatigue
- ammo class
- visibility state
- cover state
- veterancy
- crew shock for vehicles
- bailout / disabled track / damaged gun states for armor

This is the main difference from older RTT designs that often read more like platoon tokens.

### 2. Beautiful battlefield texture
Not “more clutter,” but materially rich readability.

Visual targets:
- blended terrain materials
- decal stacking: mud, tracks, shell impacts, scorch, rubble
- vegetation layers with wind reaction
- soft shadowing under trees, walls, wrecks, and hedgerows
- smoke that lingers and meaningfully obscures
- destruction pass on villages and walls
- seasonal color grade option: late spring 1940

### 3. Lethal positional tactics
Open ground should feel dangerous. MG arcs, village corners, hedges, and armor hull-down positions should define engagements.

### 4. Distinct French 1940 identity
Avoid generic “Allies vs Axis” flattening.

French design identity:
- strong tank armor quality on certain vehicles
- weaker tactical radio cohesion
- excellent defensive potential
- uneven command responsiveness
- powerful local counterpunches if handled well

## Scope shape

### Campaign theatre
Best starting theatre:
- Belgium / northern France, May 1940
- Hannut / Gembloux inspired engagements
- reconnaissance clashes, village assaults, armored screens, withdrawals, canal defenses

### Factions for vertical slice
- French Army
- German Army

Expansion-ready:
- BEF
- Belgian Army
- Dutch forces
- later Italian alpine / southern-front content only if the game expands

## Core loop

1. Recon the approach with scouts and line-of-sight tools  
2. Position infantry around hard cover and concealment  
3. Establish supporting fire with MG / AT / tank guns  
4. Maneuver armor to exploit flanks or suppress strongpoints  
5. Manage individual suppression, facing, and exposure  
6. Secure objectives while preserving force quality for the next phase

## Systems

### Command and control
Use responsive controls, but avoid instant-perfect obedience.

Suggested implementation:
- direct orders remain immediate for usability
- command delay is short but visible on low-cohesion units
- units without radio or officer proximity suffer slower response when pinned or dispersed
- tanks with weak situational awareness rotate slower to new threats
- selected officers reduce nearby order delay and rally suppression faster

### Infantry model
Each soldier:
- weapon profile
- loadout weight
- accuracy state
- suppression state
- cover evaluation
- posture
- spotting modifier

Roles:
- fusilier
- FM 24/29 gunner
- engineer / pioneer
- anti-tank team
- squad leader
- dispatch rider / recon element

### Vehicle model
Each vehicle should track:
- hull armor and facing
- turret traverse
- optics quality
- crew shock
- mobility state
- engine damage
- ammunition type
- commander awareness
- radio capability

French hero vehicles for identity:
- Somua S35
- Hotchkiss H39
- Panhard 178
- Char B1 bis for later escalation

German early-war set:
- Panzer I / II / III / IV where appropriate
- Sd.Kfz. 222 / 231 recon cars
- Pak 36
- MG34 teams
- motorcycle and recon elements

### Fire and suppression
Suppression should matter almost as much as damage.

Model:
- near misses generate suppression cones
- MGs deny space, not just HP
- suppression reduces spotting, movement speed, aim quality, and willingness to cross open ground
- pinned infantry should auto-seek low-profile states
- recovery requires time, leadership, or smoke

### Cover and concealment
Differentiate these clearly.

- Cover reduces hit probability / damage potential
- Concealment reduces detection / targeting consistency
- Hedges: medium cover, medium concealment
- Forest edges: good concealment, inconsistent firing lanes
- Stone walls: high frontal cover
- Houses: strong cover but artillery / HE vulnerability
- Wheat fields: concealment, not real protection

### Destruction
This game wants progressive battlefield wear:
- facades chip
- walls collapse
- wrecks remain as cover and sight blockers
- roads scar under artillery and tracks
- smoke + debris update map readability over time

## Graphics target

For a modern production version, I would push:

- PBR terrain blending
- detail normals on roads, mud, masonry, and roof tile
- runtime decal layering
- per-object AO pass
- screen-space contact shadows for units and walls
- GPU particles for dust, impact smoke, and debris
- terrain macro/micro variation so fields do not repeat visibly
- cloth and foliage motion on a per-biome basis

The prototype included here uses 2D textured rendering only, but it already encodes the right readability priorities.

## UX

### UI principles
- minimalist chrome, high-legibility overlays
- selected-unit card focuses on survivability, suppression, and visibility
- LOS, cover, and weapon-range overlays must be fast to inspect
- no oversized RTS economy interface; the focus is battlefield state

### Player verbs
- move
- attack-move
- face
- crouch / go prone
- hold fire
- smoke
- reverse for vehicles
- breach / clear building
- rally around officer
- dismount / remount for mechanized infantry

## Content plan

### First/default vertical slice mission

**“Advance to the Dyle”**
- French vanguard enters from west
- orchard and hedgerow belt in mid-map
- village crossroads objective in east
- German MG nest, recon car patrol, Panzer II reserve
- optional timed reinforcement
- victory by seizing crossroads or routing defenders

### Campaign mission types
- delaying action
- reconnaissance in force
- village assault
- canal crossing defense
- rear-guard withdrawal
- armored meeting engagement
- breakthrough containment

## Technical build recommendation

### Best fit
If the goal is commercial production:
- **Unreal Engine** for visual ambition and terrain material quality
- gameplay in C++ + Blueprint tooling, or Mass / custom ECS for high unit counts

If the goal is faster iteration with a smaller team:
- **Unity** with a custom deterministic-ish simulation layer
- authoring tools for LOS, cover volumes, and destructible facades
- DOTS only if the team already knows it; otherwise conventional architecture is safer

If the goal is indie velocity and modability:
- **Godot 4** for a smaller-scope stylized RTT, but it becomes more work if you truly want dense modern battlefield rendering

### Architecture
Split the game into:
- simulation layer
- presentation layer
- command layer
- AI layer
- content data layer

Data-driven assets:
- weapons
- ammo
- armor profiles
- vehicle crew layouts
- terrain materials
- cover tags
- spotting modifiers
- doctrine / faction modifiers

## What I built in the prototype

The included browser prototype demonstrates:
- individual-unit control
- A* movement over typed terrain
- LOS checks against map blockers
- tile-based cover and concealment
- suppression accumulation and recovery
- stance control
- basic armor-vs-penetration interactions
- a textured battlefield rather than abstract colored rectangles

## What a real production next step should be

### Milestone 1
- proper camera zoom
- animation state machine
- squad metadata over per-unit simulation
- facing / armor arcs
- reverse move for vehicles
- terrain query debug tools

### Milestone 2
- building occupancy
- HE / AP shell separation
- smoke grenades
- officer / radio command network
- cover node reservation
- save/load replayable sim state

### Milestone 3
- destruction pipeline
- mission scripting tools
- content editor for scenarios
- 1940 equipment roster expansion
- polished audio and vehicle handling

## Product summary

The Dyle pitch is:

> **Dyle Front 1940** is a richly detailed real-time tactics game set in the opening battles of the 1940 Western campaign. Command individual soldiers, crews, and armored vehicles across orchards, villages, and hedgerow belts in a battlefield where suppression, sight lines, and cover matter as much as firepower. It carries the readability and tension of classic WWII RTT games, but with modern visuals and far deeper unit-level simulation.
