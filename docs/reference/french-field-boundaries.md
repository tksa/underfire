# French Countryside Field Boundaries, 1800-1950

> Provenance: guide provided by the project owner (tksa) on 2026-07-03 as the
> design reference for Under Fire's field-divider / boundary generation
> (`Game._addFieldDividers` and friends in `js/terrain.js`). Preserved here
> verbatim; the original transmission was cut at section 19.2, so later
> sections (remaining local detail rules, validation, references) are missing.
> See `to_do.md` for the implementation status against this guide.

A historical and procedural-generation guide for farms, roads, open fields, small stone walls, dry-stone retaining walls, wooden fences, hedges, ditches, and roadside enclosure in rural France from roughly 1800 to 1950, with special attention to what a World War II countryside would plausibly contain.

---

## 1. Purpose and Scope

This document is meant for worldbuilding, map design, terrain generation, game environments, and historically grounded procedural placement. It focuses on the way rural space was divided in France by physical boundaries such as:

- Low stone and dry-stone walls.
- Retaining walls for terraces, roads, paths, and steep fields.
- Wooden post-and-rail fences, paling fences, hurdles, gates, and temporary barriers.
- Hedgerows, earth banks, drainage ditches, and mixed hedge-wall systems.
- Open-field boundaries where the legal parcel existed but no strong visible barrier stood.

The important rule is this: **there was no single French countryside**. Between 1800 and 1950, a farm landscape in Normandy, Brittany, Burgundy, the Massif Central, Provence, Alsace, Beauce, or the Alps could look very different. Some areas were dense with hedgerows and sunken lanes. Some had dry-stone walls built from field clearance. Some had terraced slopes. Some had wide, open arable fields with few visible barriers at all.

For a World War II setting, especially 1940-1944, avoid assuming every boundary is a modern fence. The countryside was still largely shaped by foot, animal, cart, tenant farming, smallholdings, inheritance, local stone, local wood, old roads, pasture needs, and water control. Heavy postwar landscape simplification came later in many regions, especially through mechanized agriculture and land consolidation.

---

## 2. Historical Background: 1800-1950

### 2.1 Early nineteenth century: local material, inherited parcels, and the cadastre

The Napoleonic cadastre, established by the law of 15 September 1807, created a parcel-based fiscal mapping system for France and was carried out through much of the first half of the nineteenth century. For generation purposes, this matters because the countryside should not be imagined as random. Rural space had named plots, owners, boundaries, paths, lanes, watercourses, commons, meadows, woods, gardens, vineyards, orchards, and farmyards.

However, a cadastral boundary was not always a wall or fence. It could be:

- A hedge.
- A low bank.
- A ditch.
- A line of stones.
- A line of trees.
- A path or track.
- A stream.
- A boundary stone.
- A remembered line between strips of cultivated land.
- A visible difference in crop or plough direction.

So a realistic algorithm should generate **legal parcel edges first**, then decide which edges become physical barriers.

### 2.2 Open-field survival and unenclosed arable land

In parts of northern, eastern, and central France, traditional open-field patterns and fragmented holdings persisted longer than in England. Grantham's study of nineteenth-century France notes that traditional landholding patterns in France maintained themselves until after the First World War. In open-field country, arable land could be divided into many strips or plots without a hedge, wall, or fence between every owner. Roads, village lanes, drainage lines, crop changes, and survey knowledge did much of the boundary work.

For terrain generation, this means:

- Do not enclose every field in the Paris Basin, Beauce, Champagne, Picardy, or other open cereal areas.
- Use long fields, strips, tracks, boundary stones, and occasional ditches rather than dense fence grids.
- Physical barriers become more common around villages, orchards, gardens, pasture, woods, and livestock routes.

### 2.3 Bocage expansion and western France

In Brittany and other western regions, hedgerow systems formed ancient agroforestry landscapes. The AGFORWARD report describes Breton bocage as field-boundary hedgerow networks with high- and medium-stem trees, traditionally used to mark property, shelter livestock and crops, and provide firewood and timber. A related AGFORWARD report notes that hedgerows existed earlier, but their main expansion in Brittany occurred from the eighteenth century to the end of the nineteenth century, accompanying parcel separation and redistribution linked to inheritance.

For map generation, western bocage landscapes should use:

- Smaller, irregular fields.
- Dense field-edge networks.
- Hedges on banks, sometimes with ditches.
- Sunken lanes.
- Orchards, pasture, cattle, and mixed crop-livestock farms.
- Wooden gates and short fences at breaks in hedges.
- Some stone at banks, road edges, farmyards, bridges, and older walls, depending on local geology.

### 2.4 Stone walls and field clearance

Dry-stone construction is the practice of building with stone without mortar, using careful selection and arrangement for stability. UNESCO recognizes dry-stone construction as a traditional knowledge system used in many types of structures, including paths, retaining structures, and agricultural works.

In France, dry-stone construction appears in many rural regions. It was used for terraces, boundary walls, road retaining walls, paths, huts, enclosures, riverbanks, and other works. A French heritage inventory notes its use for terrace walls, road-retaining structures, and its adaptability to terrain and drainage. DREAL Grand Est describes dry stone as widely used over centuries, including for mountain terraces, water management, parcel-dividing walls, road retaining walls, and other landscape works.

A key reason for small stone walls is **field clearance**. On rocky plateaus and upland pastures, farmers removed stone from fields to make mowing, ploughing, or grazing easier, then stacked the stone along parcel edges. The Parc naturel regional des Monts d'Ardeche describes dense networks of dry-stone walls and stone piles on the Ardeche and Haute-Loire plateau as the legacy of clearing stones from meadows and cultivated land, then regrouping them along parcel boundaries.

For procedural placement, stone walls should be most common where:

- Surface stone is abundant.
- Soil is shallow.
- Slopes need terracing or retaining.
- Fields were cleared from rocky pasture, woodland, heath, or scrub.
- Local stone is cheaper than imported timber.
- Boundaries need to endure for decades without constant replanting.

### 2.5 Cattle landscapes: hedges, trees, and murets

The Charolais-Brionnais cattle landscape is a useful model for mixed pasture, hedges, trees, and murets. Its cultural landscape includes grass surfaces, hedges, trees, murets, rural built heritage, and hydraulic systems; hedges divide grassland, serve as livestock enclosures, and help define many parcels. Some hedges date to the medieval period, but many appeared in the eighteenth and nineteenth centuries with the development of cattle fattening and grazing systems. In some sectors, stone murets replace hedges, especially where geology provides sandstone or limestone; some directly border and delimit agricultural parcels.

For generation, cattle regions should include:

- Pasture parcels enclosed by hedges, murets, or mixed lines.
- Shade trees and pollarded trees along boundaries.
- Gates at cattle routes.
- Tracks connecting farmstead, water, meadows, and markets.
- Boundaries that are functional livestock barriers, not decorative edging.

### 2.6 World War II and the bocage battlefield

In Normandy in 1944, Allied and German forces fought in a landscape of small fields, thick hedgerows, and sunken lanes. Michael Doubler's study of the Normandy campaign describes the bocage as an extensive network of small fields bordered by living hedge banks and sunken dirt lanes, which created a difficult defensive terrain.

For World War II maps, especially Normandy, Cotentin, and western Normandy:

- Use irregular fields, not square modern paddocks.
- Use thick hedgerows on earth banks, often taller than a person.
- Use narrow sunken lanes bordered by banks and vegetation.
- Give infantry short visibility from field to field.
- Make tanks and vehicles prefer lanes, gates, breaches, and farm entrances.
- Add occasional stone walls and farmyard walls, but do not replace the bocage with a pure stone-wall grid.
- Add battle damage only where fighting occurred: blown gaps, crushed hedges, cut wire, shell craters, burnt barns, broken gates, and temporary military obstacles.

### 2.7 1945-1950: before full modern simplification

Land consolidation, or remembrement, was legally introduced in France by the 1941 law and 1942 decree. Its goals included increasing agricultural productivity, regrouping dispersed parcels, removing obstacles to mechanization such as hedges and groves, rethinking access roads, and sometimes draining ponds.

Postwar agricultural modernization strongly enlarged parcels and encouraged hedge removal. A 2019 article on bocage monitoring in France states that after the Second World War, agricultural modernization enlarged parcels to facilitate mechanized work, causing hedge removal and changes to traditional agricultural systems.

However, for a 1944-1950 landscape, do not overdo modern consolidation. In many places, the dense prewar mesh still existed. Large-scale hedge removal and parcel enlargement became more visible later, especially from the 1950s onward.

---

## 3. Boundary Types

### 3.1 Dry-stone boundary wall

**Purpose:** mark and protect a parcel, contain animals, store stones cleared from fields, protect crops, divide pasture, define road edges.

**Most likely terrain:** rocky uplands, limestone plateaus, granite areas, sandstone ridges, vineyard slopes, pasture margins, fields newly cleared from stony ground.

**Appearance:**

- Height: usually about knee to chest height, often 0.5-1.3 m for field boundaries.
- Width: commonly broad enough to be stable, often 0.4-1.0 m depending on stone and region.
- Construction: local stone, no mortar, rough coursing, wedge stones, rubble core, larger stones at base.
- Top: flat capstones, upright stones, rough coping, or loose uneven finish.
- Shape: follows parcel line, contour, road edge, or cleared-field edge; seldom perfectly smooth.
- Condition: gaps, collapsed sections, moss, lichen, bramble, nettle, grass at base.

**Procedural rule:** use where stone availability is high and the boundary is old, permanent, and worth maintaining.

### 3.2 Dry-stone retaining wall or terrace wall

**Purpose:** hold soil on slopes, create flat or semi-flat cultivation strips, support roads and lanes, reduce erosion, manage water.

**Most likely terrain:** vineyards, orchards, chestnut groves, small mountain fields, south-facing slopes, valleys, Mediterranean hills, Cevennes, Provence, Ardeche, Alps, Pyrenees, Corsica, Vosges vineyards.

**Appearance:**

- Runs roughly along contours.
- Repeats as stair-stepped bands up a slope.
- Taller and more engineered than simple boundary walls.
- Has drainage through gaps, joints, small weep-like openings, or permeable dry-stone fabric.
- Often connected by narrow steps, ramps, mule tracks, or switchback lanes.

**Procedural rule:** if a cultivable slope is steep enough that soil would wash away, place retaining walls along contour intervals rather than arbitrary parcel grids.

### 3.3 Stone pile or pierrier

**Purpose:** store stones removed from fields where no neat wall was built or where surplus stone accumulated.

**Most likely terrain:** stony plateaus, field corners, edges of pasture, near walls, near old clearings.

**Appearance:**

- Irregular piles, cairns, low heaps, elongated ridges.
- Often beside walls, in field corners, or at the edge of cleared ground.
- Overgrown with grass, bramble, small shrubs, lizards, moss.

**Procedural rule:** generate pierriers where stone availability is high but boundary need is low, or where walls have collapsed.

### 3.4 Hedgerow on bank

**Purpose:** livestock enclosure, property line, windbreak, firewood/timber source, shade, erosion control, wildlife habitat, privacy, lane enclosure.

**Most likely terrain:** western France, Normandy, Brittany, Mayenne, Vendee, Charolais, parts of Limousin, wet temperate pasture regions.

**Appearance:**

- Earth bank 0.4-1.5 m high, sometimes more in sunken lanes.
- Ditch on one or both sides.
- Dense shrubs: hawthorn, blackthorn, hazel, elder, bramble, holly, dog rose.
- Trees: oak, ash, beech, chestnut, willow, alder, maple, depending on region.
- Managed by cutting, laying, pollarding, coppicing, or trimming.
- Gaps with wooden gates, rails, or dead-hedge repairs.

**Procedural rule:** use in bocage and cattle pasture regions, especially where moisture and labor allowed hedge maintenance.

### 3.5 Wooden post-and-rail fence

**Purpose:** short-term or medium-term livestock control, farmyard separation, orchard/garden protection, repair to hedge gaps, gates, paddocks, temporary divisions.

**Most likely terrain:** near farmsteads, along road gates, around gardens, calves, pigs, horses, orchards, dairies, water points, young hedges, temporary paddocks, less often as long remote field boundaries.

**Appearance:**

- Upright posts at 1.5-3 m spacing.
- One to three horizontal rails.
- Rough-sawn or split timber, often oak, chestnut, pine, or local hardwood.
- Weathered grey-brown wood, uneven heights, repaired rails.
- Often paired with wire by the early twentieth century, but pure wire should not dominate a pre-1950 rural landscape unless the local setting demands it.

**Procedural rule:** wooden fences are common in short useful segments, not as endless modern ranch grids. Use them where people handle animals daily.

### 3.6 Paling, picket, or garden fence

**Purpose:** protect kitchen gardens, orchards, cottage yards, poultry areas, beehives, small livestock pens, school/church/house edges.

**Most likely terrain:** close to settlements and farmhouses.

**Appearance:**

- Vertical slats or stakes.
- Rough, handmade, variable spacing.
- 0.8-1.5 m high.
- More regular near wealthier houses, estates, railway property, or village gardens.

**Procedural rule:** put near habitation, not in the middle of large fields.

### 3.7 Wattle, hurdle, brush, or dead hedge

**Purpose:** temporary enclosure, gap repair, young hedge protection, sheep/calf penning, poultry control, erosion check, seasonal work.

**Most likely terrain:** farmyards, edges of gardens, temporary grazing, broken hedges, woodland edge, orchards.

**Appearance:**

- Interwoven branches, stakes, brush bundles, fascines.
- Rough, irregular, short-lived.
- Often mixed with living hedges.

**Procedural rule:** use as patch material and temporary enclosure, especially where a living hedge has a breach.

### 3.8 Ditch, bank, or drain

**Purpose:** drainage, boundary marking, livestock deterrence, road drainage, field water control, erosion control.

**Most likely terrain:** wet lowlands, clay soils, bocage, roadsides, streamside fields, marsh edges.

**Appearance:**

- Shallow to deep ditch, often with vegetation.
- Bank of excavated soil on one side.
- Hedge or fence on top of bank.
- Culverts or plank crossings at gates.

**Procedural rule:** when wetness is high, choose ditch/hedge/fence over dry-stone walls.

### 3.9 Invisible or low-visibility boundary

**Purpose:** legal division without expensive physical enclosure.

**Most likely terrain:** open arable fields, consolidated cereal lands, strips, common fields, flat dry areas, low-livestock crop zones.

**Appearance:**

- Crop change.
- Plough direction change.
- Boundary stone.
- Shallow furrow.
- Track edge.
- Very low grass line.

**Procedural rule:** include this type. A realistic French map should not always show every parcel boundary as a barrier.

---

## 4. Regional Landscape Archetypes

### 4.1 Normandy bocage, 1800-1950

**Dominant feel:** enclosed, irregular, green, small fields, sunken lanes, hedges on banks, farms tucked behind vegetation.

**Use for WWII:** very strong. This is the classic 1944 hedgerow battlefield.

**Boundary palette:**

- Hedgerows on earth banks: very common.
- Ditches: common.
- Wooden gates: common.
- Wooden repairs: common.
- Stone walls: local around farmyards, villages, road cuts, bridges, and where stone is available, but not the default boundary everywhere.
- Open invisible boundaries: uncommon inside dense bocage, but possible in larger arable patches.

**Algorithmic pattern:**

- Field size: often small to medium, irregular.
- Roads: winding, narrow, often sunken.
- Parcel edges: high continuity; many boundaries connect into a mesh.
- Visibility: short; line of sight often stops at the next hedge.

### 4.2 Brittany bocage

**Dominant feel:** old hedgerow network, mixed livestock-cropping, many trees, banks, small lanes, humid climate.

**Boundary palette:**

- Hedgerows and banks: dominant.
- Tree-lined parcel edges: common.
- Stone walls: common in stony localities, near villages, old farm enclosures, and coastal or granite areas.
- Wooden fences: near farmyards, gaps, livestock handling areas.

**Algorithmic pattern:**

- Emphasize field-boundary hedgerow networks.
- Place tree species variety.
- Use old parcel subdivision and inheritance as a driver of density.
- Avoid overly rectilinear modern grids before 1950.

### 4.3 Charolais-Brionnais and cattle pasture country

**Dominant feel:** grassland, hedges, trees, cattle, lanes to markets, some stone murets in geologically suitable sectors.

**Boundary palette:**

- Hedges around pasture: common.
- Trees in hedges: common.
- Murets where stone is available: local but important.
- Wooden gates: common.
- Wooden fences: near cattle handling and farmyards.

**Algorithmic pattern:**

- Make field boundaries functional cattle enclosures.
- Place water points and tracks.
- Use shade trees and high hedges.
- Stone murets cluster by geology, not randomly.

### 4.4 Massif Central, Ardeche, Haute-Loire, Limousin uplands

**Dominant feel:** rocky upland meadows, stone clearance, low walls, stone piles, rough pasture, small roads, hamlets.

**Boundary palette:**

- Dry-stone murets: common where stone is abundant.
- Pierriers: common.
- Hedges: possible but less dominant in exposed rocky plateaus.
- Wooden gates and rails: used at access points.
- Retaining walls: common on steep slopes and roads.

**Algorithmic pattern:**

- Let geology drive wall density.
- Generate long stone lines along cleared meadow boundaries.
- Put murets along contours and property edges.
- Add broken, overgrown, and collapsed sections.

### 4.5 Provence, Cevennes, Alps, Pyrenees, Mediterranean hills

**Dominant feel:** terraced slopes, vineyards, olives, chestnuts, orchards, dry valleys, stone retaining walls, paths, steps.

**Boundary palette:**

- Dry-stone retaining terraces: dominant on cultivated slopes.
- Stone boundary walls: common.
- Ditches and drainage: important but often dry seasonal channels.
- Wooden fences: limited, mostly gardens, animals, temporary closures.
- Hedges: less continuous than western bocage; shrubs and scrub often appear on abandoned edges.

**Algorithmic pattern:**

- Use contour-following terrace bands.
- Terrace density increases on steep cultivated slopes.
- Leave rocky scrub, gullies, and uncultivated slopes between cultivated pockets.
- Place stone huts, steps, narrow paths, and walls near vineyards or old gardens.

### 4.6 Alsace, Vosges, Jura, Burgundy wine slopes

**Dominant feel:** vineyards, stone retaining walls, small plots, village-edge cultivation, wooded slopes, stone lanes.

**Boundary palette:**

- Vineyard walls and retaining walls: common on slopes.
- Dry-stone murets in sub-Vosges hills and valleys: common in certain areas.
- Hedges: possible but not necessarily continuous.
- Wooden fences: garden, orchard, stock areas.

**Algorithmic pattern:**

- Place narrow vineyard parcels following slope and exposure.
- Stone walls appear where vineyard plots are terraced or where stones were cleared.
- Access paths climb between strips.

### 4.7 Beauce, Brie, Champagne, Picardy, Paris Basin open-field country

**Dominant feel:** open arable land, large views, villages, tracks, few visible barriers in the fields.

**Boundary palette:**

- Invisible or low-visibility parcel boundaries: common.
- Ditches: roads and drainage lines.
- Hedges: near villages, orchards, gardens, water, estate edges, and some roads.
- Stone walls: farmyards, villages, cemeteries, manor/estate walls, not every field.
- Wooden fences: village edges, livestock pens, gardens.

**Algorithmic pattern:**

- Large open fields or strips.
- Few obstacles in the middle of cultivated plains.
- Roads and crop changes define space.
- Physical barriers cluster around settlements and animals.

---

## 5. Functional Logic: Why Boundaries Were Placed

A realistic placement system should ask why a boundary exists. Do not place walls and fences as pure decoration. Each boundary should satisfy at least one function.

### 5.1 Property and inheritance

Boundary lines often follow ownership and tenancy. Inheritance can split land into many parcels. In bocage country, parcel division can create dense boundary networks. In open-field country, ownership can be fragmented without every parcel being enclosed.

**Generation implication:** create parcel topology before selecting boundary materials.

### 5.2 Livestock containment

Cattle, sheep, pigs, horses, and poultry need barriers. Hedges, ditches, walls, and wooden rails all serve this function.

**Generation implication:** boundary strength rises around pasture, meadows, farmyards, dairies, orchards, and animal routes.

### 5.3 Crop protection

Gardens, orchards, vines, and grain fields might need protection from animals. Hedges and walls prevent livestock entry. Small fences protect kitchen gardens and poultry yards.

**Generation implication:** stronger enclosure near high-value crops and settlement gardens.

### 5.4 Stone removal

In rocky fields, walls and pierriers are often by-products of clearing stone from the land.

**Generation implication:** high surface-stone value increases stone walls, stone piles, and irregular wall spurs.

### 5.5 Erosion and water control

Terraces, contour walls, ditches, banks, and hedges slow runoff and preserve soil.

**Generation implication:** slope, wetness, and runoff create boundary lines even where property boundaries are weak.

### 5.6 Road and lane protection

Roads need retaining walls, drainage ditches, banks, and boundaries to prevent animals from wandering. Sunken lanes can form where traffic, water, soil, and banks interact over time.

**Generation implication:** roads are strong attractors for boundaries.

### 5.7 Fuel, timber, and rural resources

Hedges were not only boundaries. They could provide firewood, branches, fodder, tool handles, stakes, fruit, nuts, and other household resources. A 2024 article discussing the economic history of hedges notes that hedge wood and branches supplied rural households for heating, ovens, tools, barriers, stakes, and other uses; it also notes that barbed wire and electric wire later helped displace the hedge's function as a closure.

**Generation implication:** older hedges should look managed, cut, laid, or pollarded rather than simply wild lines of trees.

---

## 6. Terrain Factors That Control Boundary Type

### 6.1 Stone availability

Stone availability is the strongest predictor for stone walls.

High stone availability:

- Limestone plateau.
- Granite upland.
- Sandstone ridge.
- Basalt/volcanic upland.
- Stony field clearance.
- Vineyard slopes with bedrock near surface.

Low stone availability:

- Deep alluvial valley soil.
- Wet clay lowland.
- Sandy low-stone plains.
- Marsh and reclaimed wetland.

### 6.2 Wood availability

Wooden fences require posts, rails, stakes, and repair material. Where hedges, coppice, woods, or chestnut/oak resources are available, short wood fences and gates are plausible.

However, long wooden fence networks require constant repair and material. In many regions, a living hedge or stone wall made more long-term sense.

### 6.3 Soil wetness

Wet soils favor ditches, banks, hedges, willow lines, and wooden crossings. Dry-stone walls can exist in wet regions, but drainage and stability matter.

High wetness:

- Prefer ditch + bank + hedge.
- Use timber gates and planks.
- Avoid long dry-stone walls in saturated lowland unless on raised road, village, bridge, or engineered foundation.

### 6.4 Slope

Slope changes the whole boundary system.

Flat arable land:

- Fewer physical boundaries.
- More open-field strips.
- Ditches and tracks matter.

Rolling pasture:

- Hedges, walls, and fences define fields.
- Boundaries often follow ridges, streams, and old tracks.

Steep cultivated slopes:

- Terrace walls follow contours.
- Field access uses steps, ramps, and paths.

Steep uncultivated slopes:

- Boundaries may be rare, broken, or limited to property edges and grazing walls.

### 6.5 Climate and wind

Windy western or upland areas benefit from hedges and tree lines. Dry Mediterranean hills favor stone walls, terraces, and scrub boundaries.

### 6.6 Distance from settlement

Near farms and villages:

- More gates.
- More wooden fences.
- More garden walls.
- More maintained hedges.
- More road walls and yard walls.

Far from settlement:

- Boundaries become rougher, older, lower, less maintained.
- Walls may collapse.
- Hedges may grow out or disappear.
- Open boundaries become more likely.

---

## 7. Data Model for Procedural Generation

Represent every boundary as an object with physical, historical, and gameplay properties.

```yaml
BoundarySegment:
  id: integer
  geometry: polyline
  legal_boundary: true/false
  adjacent_parcels: [parcel_id_a, parcel_id_b]
  adjacent_features: [road, stream, farmyard, woodland, village]
  type: stone_wall | retaining_wall | hedge_bank | wood_fence | ditch_bank | open_boundary | mixed
  material: local_limestone | granite | sandstone | basalt | fieldstone | oak | chestnut | mixed_brush | earth
  age_band: pre_1800 | 1800_1850 | 1850_1914 | 1918_1939 | ww2 | 1945_1950
  condition: intact | worn | overgrown | patched | collapsed | breached | removed
  height_m: float
  width_m: float
  permeability_people: low | medium | high
  permeability_animals: low | medium | high
  permeability_vehicle: none | gate_only | breach_only | passable
  visibility_block: none | low | medium | high
  cover_value: none | low | medium | high
  maintenance_level: abandoned | low | normal | high
  gate_locations: [point]
  ditch_side: none | left | right | both
  vegetation: none | grass | bramble | shrubs | trees | managed_hedge
```

---

## 8. High-Level Algorithm

The algorithm should run in layers:

1. Build terrain analysis maps.
2. Place settlements and farmsteads.
3. Generate old road, lane, track, and path network.
4. Generate land-use zones.
5. Generate legal parcels.
6. Generate physical boundary candidates.
7. Score each candidate by function and terrain.
8. Select boundary types probabilistically.
9. Add gates, breaks, access points, ditches, and vegetation.
10. Apply age, maintenance, and war/postwar modifiers.
11. Validate movement and hydrology.
12. Add local detail and disorder.

---

## 9. Input Layers

Use these normalized maps or variables:

```text
H(x,y)  = elevation
S(x,y)  = slope, 0-1
A(x,y)  = aspect or solar exposure
W(x,y)  = wetness or topographic wetness index, 0-1
R(x,y)  = runoff concentration, 0-1
G(x,y)  = surface stone availability, 0-1
D(x,y)  = soil depth, 0-1
F(x,y)  = forest/wood resource availability, 0-1
L(x,y)  = land use class
V(x,y)  = village/farm proximity, 0-1
Roads   = roads, lanes, tracks, paths
Streams = streams, ditches, ponds, springs
Region  = Normandy_bocage | Brittany_bocage | Massif_Central | Provence_terrace | Openfield | Mixed
Era     = 1800_1850 | 1850_1914 | 1918_1939 | 1939_1945 | 1945_1950
```

Derived maps:

```text
livestock_pressure = pasture * 0.55 + meadow * 0.25 + farm_proximity * 0.15 + water_proximity * 0.05
crop_protection_need = orchard * 0.35 + garden * 0.30 + vineyard * 0.20 + crop_next_to_pasture * 0.15
terrace_need = slope * cultivable_soil * sun_exposure * stone_availability
erosion_risk = slope * runoff * bare_soil
stone_wall_viability = stone_availability * (1 - saturated_wetness) * accessibility
hedge_viability = moist_temperate * soil_depth * (wood_resource + bocage_region) * (1 - extreme_dryness)
wood_fence_viability = wood_resource * farm_proximity * livestock_pressure
open_boundary_preference = openfield_region * arable_land * (1 - livestock_pressure)
```

---

## 10. Parcel Generation

### 10.1 Generate settlement anchors

Place villages, hamlets, farmsteads, mills, churches, and manor/estate centers based on water, road crossings, defensible or dry ground, and historical settlement pattern.

```pseudo
settlement_score =
    0.30 * near_water_but_not_flooded +
    0.20 * road_crossing_potential +
    0.15 * gentle_slope +
    0.15 * cultivable_land_nearby +
    0.10 * dry_ground +
    0.10 * historical_randomness
```

Use nucleated villages in open-field regions; use more scattered hamlets and isolated farms in bocage and upland regions.

### 10.2 Generate road and lane network first

Roads and lanes are older than many field subdivisions and often define them.

Rules:

- Main roads connect towns and villages.
- Country lanes connect village to hamlets, mills, woods, meadows, and market roads.
- Farm tracks connect farmyards to fields and water.
- Roads follow ridges, valley sides, contour benches, or dry ground when possible.
- Avoid steep direct climbs unless old pack routes or mountain lanes.
- In bocage, roads are often narrow, winding, and enclosed.
- In open plains, roads can be straighter and more visible.

### 10.3 Generate land-use zones

Use terrain and settlement distance:

- Village core: houses, gardens, orchards, yards, barns, wells.
- Near village: gardens, orchards, small paddocks, meadows.
- Better flat land: arable fields.
- Wet valley bottom: meadow, pasture, willow, ditch network.
- Stony plateau: rough pasture, stone-walled fields, heath, cleared fields.
- Steep sunny slope: vineyard, orchard, chestnut, terraces.
- Steep shady slope: woodland, scrub, rough grazing.
- Upland common: large open grazing, sparse walls.

### 10.4 Generate legal parcels by region

#### Bocage parcel generator

```pseudo
for each farmstead or hamlet:
    create irregular cells using weighted Voronoi
    bias cell edges to streams, lanes, ridges, old paths
    subdivide near settlement into smaller parcels
    keep pasture/meadow parcels small and irregular
    create lane access to most parcels
    merge cells where slope or woodland makes enclosure unlikely
```

Shape style:

- Irregular polygons.
- Curving edges.
- Fields bounded by lanes, streams, old banks.
- Strong connectivity.

#### Open-field parcel generator

```pseudo
for each village:
    create large open arable blocks around village
    divide blocks into long strips or elongated parcels
    align strips with slope, plough direction, drainage, and access tracks
    mark most internal strip boundaries as open_boundary
    create physical barriers only on block edges, roads, gardens, meadows, and pasture
```

Shape style:

- Long strips.
- Few fences or walls.
- Tracks and crop boundaries more important than barriers.

#### Stone upland parcel generator

```pseudo
for each cleared meadow or pasture zone:
    create parcels along terrain breaks, rock outcrops, and old clearance edges
    use contour-following or ridge-following lines
    place stone walls where G is high and parcel boundary is permanent
    add pierriers in corners and along unused edges
```

Shape style:

- Irregular fields.
- Walls follow contours, ridges, outcrops, and cleared land edges.
- Broken lines and stone piles.

#### Terrace parcel generator

```pseudo
for each cultivable slope:
    if slope between terrace_min and terrace_max and soil_depth adequate:
        generate contour bands
        split bands into ownership strips using access paths and water lines
        place retaining wall on downhill edge of each band
        add steps, ramps, and drainage breaks
```

Shape style:

- Parallel or semi-parallel contour lines.
- Narrow strips.
- Access paths climbing between terraces.

---

## 11. Boundary Type Selection

For every legal parcel edge, compute contextual values:

```text
stone = mean(G along edge)
wet = mean(W along edge)
slope = mean(S along edge)
road_edge = 1 if edge borders road/lane else 0
stream_edge = 1 if edge borders stream else 0
farm_near = mean(V along edge)
pasture_edge = 1 if either adjacent parcel is pasture/meadow
crop_edge = 1 if either adjacent parcel is arable/vine/orchard/garden
openfield = region.openfield_factor
bocage = region.bocage_factor
terrace = edge follows contour and terrace_need high
old_boundary = probability edge existed before 1800 or before cadastre
```

### 11.1 Score formulas

Use softmax or weighted random selection, not a hard maximum. Rural landscapes are inconsistent.

```pseudo
score_stone_wall =
    -0.50 +
    2.20 * stone +
    0.75 * old_boundary +
    0.70 * pasture_edge +
    0.60 * road_edge +
    0.45 * crop_protection_need +
    0.40 * slope -
    1.00 * wet -
    1.10 * openfield

score_retaining_wall =
    -1.20 +
    1.90 * stone +
    2.20 * terrace +
    1.20 * slope +
    0.60 * erosion_risk +
    0.50 * road_edge -
    0.80 * wet

score_hedge_bank =
    -0.35 +
    2.00 * bocage +
    0.85 * hedge_viability +
    0.75 * pasture_edge +
    0.55 * old_boundary +
    0.45 * road_edge +
    0.35 * wind_exposure -
    0.65 * extreme_dryness -
    0.45 * high_stone_dominance

score_wood_fence =
    -0.80 +
    1.10 * farm_near +
    0.90 * livestock_pressure +
    0.80 * wood_resource +
    0.50 * temporary_or_patch_need +
    0.35 * garden_or_yard_edge -
    0.50 * remote_edge -
    0.45 * stone

score_ditch_bank =
    -0.60 +
    1.60 * wet +
    0.75 * road_edge +
    0.70 * drainage_need +
    0.50 * bocage +
    0.35 * pasture_edge -
    0.40 * high_rock

score_open_boundary =
    -0.20 +
    2.00 * openfield +
    0.90 * arable_edge +
    0.60 * low_livestock_pressure +
    0.45 * flat_land -
    0.70 * road_edge -
    0.80 * farm_near -
    0.90 * crop_protection_need
```

Then convert scores to probabilities:

```pseudo
probabilities = softmax(scores / temperature)
selected_type = weighted_random(probabilities)
```

Suggested temperature:

- 0.6 for strong regional identity.
- 1.0 for normal variation.
- 1.4 for messy transitional landscapes.

### 11.2 Mixed boundary logic

Many real boundaries combine features. After selecting a primary type, roll for additions.

```pseudo
if type == hedge_bank:
    if wet > 0.4: add ditch_side
    if stone > 0.5: add stone_base_or_scattered_stones
    if gate_needed: add wooden_gate

if type == stone_wall:
    if bocage > 0.4 or long_abandoned: add shrubs_or_tree_growth
    if livestock_pressure > 0.5: add wooden_gate_at_access
    if wet > 0.5: add drainage_gap_or_adjacent_ditch

if type == ditch_bank:
    if hedge_viability > 0.4: add hedge_on_bank
    if road_edge: add culvert_at_gate

if type == wood_fence:
    if age > 20 years: add broken_rails, patched_sections
    if adjacent_hedge: mark as hedge_repair_segment
```

---

## 12. Stone Wall Placement Rules

### 12.1 Where to place stone walls

Place stone walls along:

- Parcel boundaries in rocky regions.
- Edges of cleared stony fields.
- Pasture boundaries where animals must be contained.
- Road and lane edges on rocky or sloped ground.
- Contour lines on cultivated slopes.
- Farmyard, village, cemetery, manor, and garden boundaries.
- Edges of vineyards and orchards in stone regions.
- Boundaries between cultivated land and rough grazing.

Avoid or reduce stone walls:

- In flat deep-soil open-field arable land.
- In wet marshy lowland.
- Where wood/hedge solutions dominate.
- Across active floodplains unless engineered.
- In very remote commons unless grazing pressure is high.

### 12.2 Geometry

Stone wall lines should rarely be perfectly straight unless:

- They follow a surveyed road.
- They are recent, estate-built, or post-consolidation.
- They run along a vineyard terrace or planned field edge.
- They follow a long property line across open upland.

Natural older walls should:

- Bend around boulders.
- Follow terrain breaks.
- Skirt wet spots.
- Merge with outcrops.
- Step downhill in short angled sections.
- Use field corners that are not exactly 90 degrees.

### 12.3 Wall height by function

```text
low field edge / stone row:       0.25-0.60 m
small boundary muret:             0.60-1.10 m
livestock boundary wall:          0.90-1.40 m
farmyard/garden wall:             1.20-2.00 m
road retaining wall:              0.80-2.50 m
terrace retaining wall:           0.60-3.00 m, depending on slope
```

Use lower walls for old field clearance and higher walls for livestock, yards, roads, and terraces.

### 12.4 Degradation

For each wall segment:

```pseudo
condition_score =
    maintenance_level * 0.40 +
    farm_proximity * 0.20 +
    road_importance * 0.15 +
    livestock_pressure * 0.15 -
    age * 0.10 -
    freeze_thaw_exposure * 0.10 -
    abandonment * 0.25
```

If condition is low, add:

- Collapsed gaps.
- Displaced stones.
- Vegetation on top.
- Reduced height.
- Stone spills downhill.
- Repairs with wood, wire, brush, or newer stone.

---

## 13. Terrace Algorithm

Terraces are not just boundaries. They are terrain engineering. Use them where slope, cultivation value, and stone supply justify the labor.

### 13.1 Terracing suitability

```pseudo
terrace_suitability =
    0.30 * slope_between_8_and_35_degrees +
    0.20 * stone_availability +
    0.15 * soil_depth_moderate +
    0.15 * sun_exposure +
    0.10 * near_village_or_path +
    0.10 * crop_value_vine_orchard_garden
```

Do not terrace:

- Very flat land.
- Bare cliffs.
- Deep ravines.
- Wet unstable landslide zones unless the region specifically has engineered terraces.
- Remote slopes with no access and low crop value.

### 13.2 Contour line generation

For every terraced slope patch:

```pseudo
avg_slope_angle = mean_slope_angle(patch)
target_wall_height = random_range(0.6, 1.8) meters
vertical_interval = target_wall_height * random_range(0.8, 1.3)
horizontal_spacing = vertical_interval / tan(avg_slope_angle)

for elevation from bottom to top step vertical_interval:
    contour = trace_contour(H, elevation)
    smooth contour lightly
    break contour at gullies, cliffs, buildings, roads
    place retaining_wall on downhill side
```

### 13.3 Terrace parcel splitting

After terrace walls are generated, split long bands by ownership and access.

```pseudo
for each terrace_band:
    split_points = access_paths + property_rays + water_channels + random_spacing
    create narrow parcels along band
    place low walls, hedges, or open boundaries between ownership strips depending on region
```

### 13.4 Terrace details

Add:

- Small steps between bands.
- Mule paths or narrow ramps.
- Drainage gaps and stone-lined channels.
- Small huts, tool shelters, or storage niches where regionally appropriate.
- Collapsed walls on abandoned upper terraces.
- Scrub invasion on unused bands.

---

## 14. Wooden Fence Placement Rules

### 14.1 Where wooden fences belong

Use wooden fences:

- At gates in stone walls and hedges.
- Around farmyards.
- Around kitchen gardens and orchards.
- Around pig, poultry, calf, horse, or dairy handling areas.
- Around ponds, wells, or dangerous drops near habitation.
- As temporary subdivision of pasture.
- As repair to broken hedges or walls.
- Along short roadside stretches near farms.

Avoid using long wooden fences as the main rural boundary everywhere unless the map is a very specific wood-rich, stone-poor, pasture-heavy setting.

### 14.2 Fence types by location

```text
Farmyard cattle edge:   heavy post-and-rail, 2-3 rails, 1.1-1.4 m high
Garden edge:            paling, picket, woven stick, 0.8-1.3 m high
Orchard edge:           rail, hedge, paling, or mixed fence, 1.0-1.5 m high
Hedge gap repair:       rough rails, hurdle, brush, dead hedge, 0.8-1.3 m high
Temporary pasture:      posts with rails, wire, or hurdles, variable height
Road gate:              wooden gate with stone or wood posts, 2.5-4 m opening
```

### 14.3 Placement formula

```pseudo
wood_fence_probability =
    0.35 * farm_proximity +
    0.25 * livestock_pressure +
    0.15 * garden_or_orchard_edge +
    0.10 * wood_resource +
    0.10 * hedge_or_wall_gap +
    0.05 * temporary_use -
    0.20 * remote_boundary -
    0.15 * stone_wall_viability
```

Use wooden fences as **short segments**. Randomly cap length:

```pseudo
if type == wood_fence:
    max_length = random_choice([8, 15, 25, 40, 80], weights=[0.25,0.30,0.25,0.15,0.05]) meters
    split long edge into fence + hedge/open/ditch/wall parts
```

---

## 15. Road, Lane, and Track Boundaries

### 15.1 Roads as boundary magnets

Roads are not neutral. They attract walls, hedges, ditches, and gates.

For every road segment, evaluate:

```pseudo
road_boundary_pressure =
    0.30 * livestock_nearby +
    0.20 * road_importance +
    0.15 * slope_or_cut_bank +
    0.15 * farm_density +
    0.10 * wetness_drainage_need +
    0.10 * bocage_or_stone_region
```

If high, place boundaries on one or both sides.

### 15.2 Sunken lane logic

Sunken lanes are especially important in bocage and old rural roads.

Generate sunken lanes where:

- Road is old.
- Road is narrow.
- Banks or hedges exist on both sides.
- Soil is erodible or lane surface has been worn down.
- Water runs along the lane.
- Terrain is rolling.

```pseudo
sunken_lane_score =
    0.30 * road_age +
    0.25 * bocage_factor +
    0.15 * slope +
    0.10 * runoff_along_road +
    0.10 * banks_both_sides +
    0.10 * narrow_width
```

If high:

- Lower the road bed by 0.3-1.5 m.
- Raise or retain banks beside it.
- Put hedges or walls on banks.
- Reduce vehicle passing width.
- Add muddy ruts, puddles, roots, and shadow.

### 15.3 Gates and access gaps

Every enclosed parcel should have at least one plausible access point unless it is abandoned or merged with a neighbor.

Gate placement:

```pseudo
for each parcel:
    nearest_access = nearest(road, lane, track, farmyard)
    gate_point = shortest_path_boundary_intersection(parcel, nearest_access)
    place gate on boundary segment with lowest slope and best road connection
```

Gate rules:

- Wooden gate even in stone or hedge boundaries.
- Wider gate for carts: 2.5-4 m.
- Small pedestrian stile or gap: 0.5-1 m.
- Pasture gate often at field corner or along lane.
- Vineyard/terrace access may be a narrow path or steps rather than a wide gate.
- Gates cluster near farms and lanes.
- Avoid placing gates across streams unless a bridge/culvert exists.

---

## 16. Hydrology and Drainage Rules

### 16.1 Do not block water unrealistically

Walls and fences should not ignore drainage. In dry-stone walls, water can pass through the wall fabric; in hedged banks and ditches, water is directed along or across field edges.

For each boundary crossing a runoff path:

```pseudo
if boundary_type == stone_wall:
    add small drainage gap or lower permeable section
if boundary_type == hedge_bank:
    add ditch crossing, culvert, or wet gap
if boundary_type == wood_fence:
    allow water through, add erosion at posts
if boundary_type == retaining_wall:
    add drainage outlets or permeable joints
```

### 16.2 Wet meadows

Wet meadows should have:

- Ditches.
- Willow or alder lines.
- Low banks.
- Wooden plank crossings.
- Hedges or rails near livestock.
- Fewer dry-stone walls unless the stream edge is rocky or road-supported.

### 16.3 Terraces and water

Terraces should not be perfectly horizontal in hydrological behavior. Add slight drainage direction toward a channel, path, or gap.

```pseudo
terrace_crossfall = random_range(0.5%, 2.0%)
drainage_outlet_interval = random_range(20, 80) meters
```

---

## 17. Era Modifiers

### 17.1 1800-1850

- Local materials dominate.
- Manual labor, animal traction, and small tools shape boundaries.
- Many legal parcels, not all physically enclosed.
- Cadastre records parcels, but terrain still looks old and local.
- Stone walls grow where fields are cleared and stone is abundant.
- Hedges and banks are maintained where livestock and pasture matter.
- Wooden fences exist mostly near farms, gardens, and animals.

Modifiers:

```pseudo
mechanization_removal = 0.00
wire_presence = 0.00 to 0.05
hedge_maintenance = high where labor available
wall_new_building = moderate in stony expansion zones
```

### 17.2 1850-1914

- Population pressure, inheritance, and agriculture can increase parcel subdivision.
- Bocage expansion is strong in some western regions.
- Stone clearance continues in uplands and newly cultivated land.
- Roads improve; railways and market access affect land use.
- Wooden gates and fencing near livestock remain common.

Modifiers:

```pseudo
parcel_subdivision = +0.15 in inheritance/bocage regions
hedge_network_growth = +0.20 in western bocage regions
stone_wall_growth = +0.15 in rocky cultivation expansion zones
wire_presence = 0.05 to 0.15 by late period
```

### 17.3 1918-1939

- Labor loss and rural change affect maintenance.
- Some hedges and walls become overgrown or poorly repaired.
- Wire on wooden posts becomes more plausible in repairs and livestock control.
- Tractors begin to appear but do not yet erase the old mesh everywhere.
- Roads may be improved, but many local lanes remain narrow.

Modifiers:

```pseudo
maintenance_decline = +0.10
wire_presence = 0.10 to 0.30 depending on wealth and region
broken_gate_probability = +0.10
hedge_overgrowth = +0.10
```

### 17.4 1939-1945: World War II

- Civilian boundary system mostly remains.
- Military activity adds damage, wire, trenches, roadblocks, cut gaps, temporary repairs.
- Normandy bocage remains dense and tactically significant in 1944.
- Occupation and war may reduce maintenance.

Modifiers:

```pseudo
battle_damage = based_on_combat_intensity
military_wire = based_on_frontline_or_defense_zone
field_breach_probability = battle_damage * 0.50
gate_damage_probability = battle_damage * 0.35
hedge_crater_probability = battle_damage * 0.20
wall_collapse_probability = battle_damage * 0.25
```

World War II boundary gameplay:

```text
stone wall:        low to medium cover, slows infantry, blocks light vehicles unless breached/gated
retaining wall:    high obstacle depending height, may block vehicles
hedge bank:        high visibility block, strong infantry cover, vehicle obstacle in Normandy bocage
wood fence:        weak obstacle, can be crossed or destroyed, controls animals more than soldiers
ditch/bank:        movement slowdown, prone cover, vehicle hazard if deep
open boundary:     no physical cover, only crop or furrow visibility change
```

### 17.5 1945-1950

- Wartime repairs and reconstruction appear.
- Early land consolidation exists legally, but do not yet make every area look like the late twentieth century.
- Some hedges removed near mechanized farms or road improvements.
- Some walls robbed for reconstruction stone or left unrepaired.

Modifiers:

```pseudo
modernization_pressure = low_to_moderate
large_parcel_creation = localized
hedge_removal = localized, not universal
road_straightening = localized
new_wire_fence = moderate near modernized livestock farms
```

---

## 18. Condition, Age, and Maintenance

### 18.1 Age assignment

Assign age from regional history and boundary importance.

```pseudo
if boundary follows old road, stream, parish line, farmstead core:
    age = pre_1800 or 1800_1850
elif in bocage expansion zone and parcel split:
    age = 1800_1850 or 1850_1914
elif in stony newly cleared field:
    age = 1800_1914 depending land-use expansion
elif wire/wood patch:
    age = 1918_1950
elif war damage repair:
    age = ww2 or 1945_1950
```

### 18.2 Maintenance by function

```pseudo
maintenance_level =
    0.25 * farm_proximity +
    0.20 * livestock_pressure +
    0.15 * road_importance +
    0.15 * crop_value +
    0.10 * owner_wealth +
    0.10 * settlement_visibility -
    0.15 * remoteness -
    0.10 * abandonment
```

High maintenance:

- Farmyard walls.
- Gates.
- Active pasture boundaries.
- Roadside retaining walls.
- Garden fences.

Low maintenance:

- Remote walls.
- Old pierriers.
- Abandoned terraces.
- Woodland-edge boundaries.
- Unused property lines.

### 18.3 Visual condition states

```text
Intact:       continuous, proper height, clear function
Worn:         uneven top, vegetation, minor gaps
Patched:      mixed materials, wood rails in wall gap, wire, brush
Overgrown:    bramble, saplings, tree roots, hidden stones
Collapsed:    stones spilled, boundary still visible but passable
Breached:     intentional gap for gate, cart, tank, animal, drainage, or modern access
Removed:      faint line, crop change, isolated stones, stump line, ditch remnant
```

---

## 19. Local Detail Rules

### 19.1 Corners

Field corners are important. Add:

- Stone piles.
- Gateposts.
- Trees.
- Water troughs.
- Small shrines or crosses near roads in some regions.
- Bramble thickets.
- Widened turning areas near gates.
- Manure heaps or cart ruts near active farms.

### 19.2 Wall and hedge interruptions

Boundaries need interruptions:

- Gates.
- Stiles.
- Culverts.
- Drainage gaps.
- Collapses.
- Animal gaps.
- Cart entrances.
- Military breaches in WWII.

*(Guide truncated here in the original transmission.)*
