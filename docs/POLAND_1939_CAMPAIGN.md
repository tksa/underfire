---
title: "Poland 1939 RTS Battle Design Dossier"
subtitle: "Historically grounded scenario design for Poland versus Germany"
version: "1.1"
date: "2026-07-11"
primary_scenario: "Battle of Mokra — 1 September 1939"
genre_target: "Real-time tactics / RTS in the style of Sudden Strike"
language: "English, with Polish unit names preserved"
---

# Poland 1939 RTS Battle Design Dossier

> **Design purpose:** create historically recognizable countryside battles in which the German side can win by achieving operational objectives and forcing an organized Polish withdrawal, while the Polish side can earn a strong tactical victory by delaying, disrupting, and inflicting heavy combat losses.
>
> **Important scale note:** the force lists labelled **representative game roster** are gameplay abstractions. They are not claims that every listed vehicle or gun stood in the exact square kilometre represented by the map.
>
> **Historical uncertainty note:** September 1939 loss reports often combine destroyed, immobilized, abandoned, recovered, and temporarily disabled vehicles. The game should track those states separately rather than presenting one disputed number as unquestioned fact.
>
> **Current game-menu note (July 2026):** this dossier defines the Poland 1939 campaign target and treats Mokra as its flagship scenario. In the current game build, **Advance to the Dyle Line** remains the first/default battle and **Mokra: Hold the Railway** appears second with **Preview** status. The production recommendations below describe the intended Poland campaign, not the current global menu order.

---

## Contents

1. [Executive recommendation](#1-executive-recommendation)
2. [Critical geography correction: Mokra is not Mórka](#2-critical-geography-correction-mokra-is-not-mórka)
3. [Campaign-wide design principles](#3-campaign-wide-design-principles)
4. [Flagship scenario: Battle of Mokra](#4-flagship-scenario-battle-of-mokra)
5. [Alternative battle: Jordanów and Wysoka](#5-alternative-battle-jordanów-and-wysoka)
6. [Alternative battle: Mława position](#6-alternative-battle-mława-position)
7. [Alternative battle: Borowa Góra and the Piotrków approaches](#7-alternative-battle-borowa-góra-and-the-piotrków-approaches)
8. [Alternative battle: opening phase of the Bzura counteroffensive](#8-alternative-battle-opening-phase-of-the-bzura-counteroffensive)
9. [Mini-mission: Krojanty](#9-mini-mission-krojanty)
10. [Master equipment reference](#10-master-equipment-reference)
11. [Historical-authenticity rules](#11-historical-authenticity-rules)
12. [Production and scripting checklist](#12-production-and-scripting-checklist)
13. [Polish terminology and abbreviations](#13-polish-terminology-and-abbreviations)
14. [Sources and further reading](#14-sources-and-further-reading)

---

# 1. Executive recommendation

## Best flagship battle: **Battle of Mokra, 1 September 1939**

Mokra is the strongest match for the requested scenario because it combines:

- open agricultural country, woods, small villages, orchards, tracks, ditches, and a railway embankment;
- a recognizable Poland-versus-Germany engagement on the first day of the war;
- repeated German armoured attacks against a smaller Polish force;
- historically effective Polish anti-tank and artillery fire;
- an armoured train that can serve as a memorable timed support asset;
- a legitimate Polish tactical success followed by an organized night withdrawal for operational reasons;
- natural asymmetric objectives that do **not** require the German player to kill every Polish defender.

The core opponent was the German **4. Panzer-Division**, commanded by Generalmajor Georg-Hans Reinhardt. It attacked the reinforced **Wołyńska Brygada Kawalerii** under Colonel Julian Filipowicz. The brigade was supported by elements of the 30th Infantry Division and Polish armoured trains, most prominently Armoured Train No. 53 **Śmiały**. Polish official commemorative accounts describe repeated German attacks being repelled before the brigade withdrew during the night of 1–2 September.[^ipn-mokra-2019]

## Recommended scenario portfolio

| Priority | Battle | Date | Best gameplay identity | Polish success potential | German non-annihilation victory |
|---:|---|---|---|---|---|
| 1 | **Mokra** | 1 Sep | Anti-armour defence, train support, phased withdrawal | Very high | Seize crossings and force withdrawal |
| 2 | **Jordanów–Wysoka** | 1–3 Sep | Mountain-road ambushes by Maczek's motorized brigade | Very high | Clear ridge and open road on schedule |
| 3 | **Mława** | 1–3/4 Sep | Bunkers, anti-tank ditch, engineer breach | High | Breach sectors and compel evacuation |
| 4 | **Borowa Góra** | 2–5 Sep | Low hills, infantry defence, rare 7TP counterattack | High | Open the route toward Piotrków |
| 5 | **Bzura opening phase** | 9–12 Sep | Polish surprise offensive over river crossings | Very high | Delay, preserve division, await relief |
| Tutorial | **Krojanty** | 1 Sep | Mounted shock action against exposed infantry | Localized | Recover and resume pursuit after delay |

---

# 2. Critical geography correction: Mokra is not Mórka

The satellite screenshot showing **Mórka**, **Jezioro Mórka**, Jeleńczewo, Mościszki, and Mełpin depicts a different place in Greater Poland. It is not the battlefield near Kłobuck.

| Feature | Historical Battle of Mokra | Place shown in the satellite screenshot |
|---|---|---|
| Correct spelling | **Mokra** | **Mórka** |
| Region | Kłobuck County, Silesian Voivodeship; about 5 km north of Kłobuck | Śrem/Kościan area, Greater Poland |
| Approximate coordinates | 50.964° N, 18.917° E | 52.014° N, 16.960° E |
| Relevant water | Minor drainage, ditches, and small streams; **no broad lake or major river across the battlefield** | A conspicuous lake system, including Jezioro Mórka |
| Most important linear obstacle | North–south railway embankment and its limited crossings | Lake shore and local roads |
| Historical village pattern | Mokra I, Mokra II, Mokra III, with Izbiska to the north and Kłobuck to the south | Mórka clustered by a lake |

Mórka is documented as a village in Greater Poland near Jezioro Mórka, while the battle site is Mokra in Gmina Miedźno near Kłobuck.[^morka-map][^mokra-location]

## Required correction to the earlier concept art

The revised playable map should:

1. **Remove the broad river or lake completely.**
2. Make the **railway embankment** the dominant north–south landmark.
3. Place the village as several elongated clusters—Mokra I, II, and III—rather than one compact central town.
4. Use open crop fields west of the railway, with irregular woods screening the northern, central, and southern sectors.
5. Add shallow drainage ditches, sunken farm tracks, hedges, and small wet depressions, but no water barrier wide enough to require multiple road bridges.
6. Put Polish reserve, artillery, and withdrawal areas primarily **east** of the railway.
7. Put German entry routes primarily from the **west and southwest**, with a northern approach from the Rębielice/Izbiska direction.

The user's supplied historical situation map is much closer to the correct operational geography: it correctly emphasizes the railway, the three Mokra settlements, the woods, Wilkowiecko to the west, Izbiska to the north, and Polish reserves east of the railway.

---

# 3. Campaign-wide design principles

## 3.1 Victory should be operational, not exterminatory

A German player should normally win by:

- clearing a road or railway crossing;
- occupying a village, ridge, bridgehead, or bunker sector;
- maintaining a timetable;
- preserving enough armour to continue the campaign;
- forcing the Polish command to issue a withdrawal order;
- preventing Polish demolition or evacuation of selected assets.

A Polish player should normally win by:

- holding until a specified time;
- causing a threshold of German **combat losses**;
- delaying German columns;
- preserving command, artillery, and a meaningful proportion of troops;
- conducting local counterattacks;
- withdrawing in good order when ordered.

Neither side should receive a primary objective reading “destroy all enemy units.”

## 3.2 Model combat loss, not only destruction

Use at least four vehicle states:

| State | Definition | Suggested score |
|---|---|---:|
| Damaged | Still mobile or repairable on-map, reduced capability | 1 |
| Immobilized | Cannot move; crew may continue firing or abandon | 2 |
| Abandoned / forced off | Crew exits or vehicle is recovered off-map later | 2 |
| Destroyed / burnt out | Permanent battlefield loss | 3 |

This solves two problems. It better reflects the historical uncertainty surrounding German armoured losses, and it makes Polish anti-tank success visible without requiring inflated numbers of exploding tanks.

## 3.3 Protected withdrawal system

The most respectful and useful design is a **graduated withdrawal**, not instant invulnerability.

1. A withdrawal order activates one or more rear corridors.
2. Polish units must disengage, move, and cross a marked control line.
3. Once a unit is fully inside the protected rear zone and has no enemy within a defined distance, it changes to **exiting** status.
4. Exiting units stop counting as valid targets, fade or leave the map after 15–30 seconds, and count as preserved.
5. The German side gains no score for firing into the final protected exit area and can receive a command-discipline penalty.
6. Units cut off before reaching the corridor remain vulnerable and may surrender, hide, or attempt another route.
7. Wounded or broken formations should retreat automatically toward cover rather than fighting to the last man.

This preserves tension—retreating troops can still be cut off before reaching safety—without turning the final minutes into a pursuit-killing exercise.

## 3.4 Cavalry is mobile infantry

Polish cavalry in 1939 usually moved on horseback and fought dismounted with rifles, light and heavy machine guns, mortars, anti-tank rifles, and 37 mm anti-tank guns. Mounted charges were situational attacks against exposed infantry, not a standard anti-tank method. Modern museum and historical accounts explicitly reject the myth of cavalry charging tanks with sabres.[^cavalry-myth][^national-ww2-polish-cavalry]

For gameplay:

- horses provide strategic and tactical movement;
- cavalry dismounts before sustained fire combat;
- mounted units are vulnerable to automatic weapons and artillery;
- sabre use is limited to a brief shock action against disrupted infantry;
- anti-armour work belongs to Bofors guns, wz. 35 anti-tank rifles, artillery, mines, and ambushes.

## 3.5 Scenario scale convention

A practical convention for a Sudden Strike-like game is:

- one infantry squad icon: 8–12 soldiers;
- one weapons-team icon: one gun or one crew-served weapon;
- one vehicle icon: one vehicle;
- one artillery battery in history: two to four on-map pieces, or one/two on-map pieces plus off-map fire;
- one historical battalion/regiment: represented by selected companies, platoons, and support weapons.

This provides recognizable equipment without attempting to simulate several thousand soldiers individually.

---

# 4. Flagship scenario: Battle of Mokra

## 4.1 Scenario identity

**Title:** *Mokra: Hold the Railway*  
**Date:** 1 September 1939  
**Location:** Mokra–Wilkowiecko–Izbiska sector, north of Kłobuck  
**Weather:** warm late-summer day; morning haze, dry fields, smoke increasing through the battle  
**Recommended play time:** 75–110 minutes  
**Recommended map:** approximately 6 km west–east by 7 km north–south, compressed to engine scale  
**Primary theme:** repeated armoured assault against a layered defence, followed by an organized Polish withdrawal  
**Playable sides:** Poland and Germany

## 4.2 Short history

At the start of the German invasion, the Wołyńska Cavalry Brigade formed part of Army Łódź's Piotrków Operational Group and guarded the seam between Polish formations north of Częstochowa. Colonel Julian Filipowicz selected a defensive position around Mokra in which woods, broken agricultural ground, village buildings, ditches, and the north–south railway embankment limited German observation and channelled armour.

The German 4th Panzer Division attacked from the west in several waves, supported by artillery and Ju 87 dive bombers. Polish uhlans fought mainly dismounted. Their 37 mm Bofors anti-tank guns, wz. 35 anti-tank rifles, heavy machine guns, and horse artillery repeatedly disrupted German columns. Armoured Train No. 53 **Śmiały** used the railway to provide direct fire and to help cover threatened crossings. Polish tankettes and mounted reserves also made local counterattacks amid smoke and confusion.

The Polish force held long enough to upset the German timetable and inflict serious losses. It did not remain indefinitely. German movement on neighboring axes threatened the brigade's flanks, so the formation withdrew during the night of 1–2 September to a new line. That combination—tactical success followed by an operational withdrawal—is ideal for the requested two-sided mission structure.[^ipn-mokra-2019][^ipn-mokra-2008]

## 4.3 Command structure and historical units

### Polish command

| Level | Formation | Commander / role |
|---|---|---|
| Army | **Armia “Łódź”** | Defended the central-western approach to Warsaw |
| Operational group | **Grupa Operacyjna “Piotrków”** | Mobile/defensive grouping under Gen. Wiktor Thommée |
| Main formation | **Wołyńska Brygada Kawalerii** | Colonel Julian Filipowicz |
| Supporting infantry | Elements of **30th Infantry Division**, especially **IV Battalion, 84th Infantry Regiment** | Held the southern part of the forward position |
| Rail support | Armoured Train No. 53 **Śmiały**; some Polish official accounts also credit No. 52 **Piłsudczyk** | Mobile direct-fire support and covering action |

### Reinforced Wołyńska Cavalry Brigade

| Unit | Battlefield role | Typical equipment relevant to the game |
|---|---|---|
| **19 Pułk Ułanów Wołyńskich** | Northern forward sector; dismounted defence and local withdrawal near Izbiska | kb/kbk rifles, Browning wz. 28 LMGs, ckm wz. 30 HMGs, wz. 35 AT rifles, 37 mm Bofors AT guns, horses and bicycles |
| **21 Pułk Ułanów Nadwiślańskich** | Central defence around Mokra I–III | Same cavalry-regiment weapons; strong use of concealed AT guns and HMGs |
| **12 Pułk Ułanów Podolskich** | Reserve and counterattack force east of the railway | Dismounted rifle squadrons, HMGs, AT rifles, limited AT guns, mounted mobility |
| **2 Pułk Strzelców Konnych** | Mobile reserve; reinforced gaps and supported counterattacks | Dismounted rifle squadrons, LMG/HMG, AT rifles, horses |
| **2 Dywizjon Artylerii Konnej** | Direct and indirect fire from behind/near railway | 75 mm wz. 1902/26 horse-artillery guns, HMG defence, horse limbers |
| **21 Dywizjon Pancerny** | Reconnaissance, liaison, and local counterattack | Primarily MG-armed TKS/TK-3 tankettes and wz. 34-II armoured cars |
| **11 Batalion Strzelców** | Rear/eastern infantry support in the wider brigade grouping | Infantry rifles, LMG/HMG, mortars |
| **82 Motorized AA Battery** | Air defence | 40 mm Bofors AA guns; best represented as a limited or scripted asset |
| **8 Engineer Squadron** | Fieldworks, obstacles, demolition, repair | Mines, wire, tools, explosives, rifles |
| **4 Bicycle Squadron / signals elements** | Reconnaissance, liaison, message traffic | Bicycles, rifles, radios/field telephones in limited numbers |
| **IV/84 Infantry Regiment** | Southern forward sector | Standard infantry weapons, 81 mm mortars, 37 mm Bofors AT guns, wz. 35 AT rifles |
| **7 Heavy Machine-Gun Battalion elements** | Additional fixed fire support | ckm wz. 30 HMGs and associated transport |

A standard Polish cavalry brigade in 1939 contained three or four cavalry regiments, horse artillery, an armoured unit with a tankette squadron, an infantry battalion, 37 mm anti-tank guns, 40 mm AA guns, engineers, signals, bicycles, and extensive horse transport. Published organizational summaries give approximately 12–16 75 mm guns, 14–18 37 mm AT guns, 13 tankettes, and roughly a dozen armoured vehicles for a full brigade, although actual strength and attachments varied.[^polish-cavalry-org]

### German command

| Level | Formation | Commander / role |
|---|---|---|
| Army group | **Heeresgruppe Süd** | Main German southern grouping |
| Army | **10. Armee** | Operational force advancing through central Poland |
| Corps | **XVI. Armeekorps (mot.)** | Armoured corps commanded by Erich Hoepner |
| Main battlefield formation | **4. Panzer-Division** | Generalmajor Georg-Hans Reinhardt |
| Air support | Luftwaffe tactical aviation | Ju 87 dive-bomber attacks and reconnaissance |

### 4. Panzer-Division, 1939 divisional structure

| Formation | Function | Usual equipment |
|---|---|---|
| Division headquarters | Command and signals | Command cars, PzBef command tanks, radios |
| **5. Panzer-Brigade** | Armoured striking force | Panzer-Regiments 35 and 36 |
| **Panzer-Regiment 35** | Tank regiment | Mostly Panzer I and II; a small number of short-barrel Panzer IV and command tanks at divisional level |
| **Panzer-Regiment 36** | Tank regiment | Same general mix |
| **4. Schützen-Brigade / Schützen-Regiment 12** | Motorized infantry | Kar98k rifles, MG34s, 5 cm and 8 cm mortars, trucks and motorcycles |
| **Artillerie-Regiment 103** | Motorized artillery | 10.5 cm leFH 18 light howitzers; heavier assets off-map or limited |
| **Aufklärungs-Abteilung 7** | Reconnaissance | Motorcycles, light and heavy armoured cars, radios |
| **Panzerabwehr-Abteilung 49** | Anti-tank defence | 3.7 cm PaK 36, truck/motorcycle transport |
| **Pionier-Bataillon 79** | Engineers | Explosives, bridging tools, mines, flamethrowers in limited issue |
| **Nachrichten-Abteilung 79** | Signals | Radio trucks, cable teams, command vehicles |

The division is commonly listed with roughly 341 tanks at the start of the campaign: about 183 Panzer I, 130 Panzer II, 12 Panzer IV, and 16 command tanks. This is a **whole-division starting strength**, not the number that should appear simultaneously on a Mokra game map.[^german-tank-strength][^4pz-oob]

## 4.4 Equipment notes specific to Mokra

### Polish equipment that belongs on this map

| Equipment | Include? | Historical/gameplay note |
|---|---:|---|
| kbk wz. 29 / kb wz. 98-type rifles | Yes | Standard individual weapons |
| Browning rkm wz. 28 | Yes | Main squad automatic weapon |
| ckm wz. 30 | Yes | Water-cooled HMG; strong prepared-position weapon |
| wz. 35 “Ur” anti-tank rifle | Yes | Concealed close-range anti-armour team; 4-round magazine |
| 46 mm wz. 36 grenade launcher | Yes | Light company-level indirect fire |
| 81 mm wz. 31 mortar | Yes | Battalion/attached infantry support |
| 37 mm Bofors wz. 36 AT gun | Essential | Principal tank-killing weapon against Panzer I/II |
| 75 mm wz. 1902/26 | Essential | Horse artillery; direct fire can be lethal but crews are exposed |
| TKS/TK-3 tankette with 7.92 mm MG | Yes | Reconnaissance and confusion/counterattack role |
| TKS with 20 mm cannon | **No in strict mode** | Rare overall and not appropriate as a routine Mokra asset |
| wz. 34 armoured car | Yes, few | Reconnaissance; lightly armoured |
| 7TP tank | **No** | Use at Borowa Góra/Piotrków, not Mokra |
| Armoured Train No. 53 Śmiały | Essential scripted asset | Timed railway pass, direct fire, withdrawal cover |
| 40 mm Bofors AA | Optional/limited | One scripted emplacement or off-map air-defence effect |

The 37 mm wz. 36 could penetrate approximately 25 mm of armour at 1,000 metres under cited test conditions and was widely issued to Polish infantry and cavalry formations. It is therefore appropriate for it to be highly effective against early German light tanks, especially from flank ambush positions.[^bofors-37]

The usual TKS armament was a 7.92 mm Hotchkiss machine gun. A 20 mm variant existed, but was rare, so the default Mokra roster should use MG-armed tankettes.[^tks-museum]

### German equipment that belongs on this map

| Equipment | Include? | Historical/gameplay note |
|---|---:|---|
| Kar98k | Yes | Main infantry rifle |
| MG34 | Essential | Centre of German squad firepower |
| MP38 | Limited | Leaders, vehicle crews, and selected assault personnel; no mass SMG squads |
| 5 cm leGrW 36 | Yes | Light platoon/company mortar |
| 8 cm GrW 34 | Yes | Battalion mortar |
| 3.7 cm PaK 36 | Yes | German AT gun; useful against tankettes and armoured cars |
| 7.5 cm leIG 18 | Yes | Direct infantry support |
| 10.5 cm leFH 18 | Mostly off-map | Pre-attack and suppression fire |
| 2 cm FlaK 30 | Limited | AA and emergency ground fire |
| 8.8 cm FlaK 18 | Rare/optional | Not a routine front-line solution for this mission |
| Panzer I | Essential | Most numerous; twin MG armament |
| Panzer II | Essential | 20 mm cannon and MG; main light combat tank |
| Panzer III | **Normally omit** | Not part of the commonly cited 4th Panzer Division campaign-start mix |
| Panzer IV | Very few | Short 75 mm support tank; use 0–2 in standard roster |
| PzBef command tank | Yes, few | Radio command/control objective |
| Sd.Kfz. 221/222/231-type armoured cars | Yes | Reconnaissance, flank scouting |
| Half-tracks | Very limited | Do not portray every motorized infantry squad as half-track mounted |
| Trucks and motorcycles | Essential | Normal transport for much of the division |
| Ju 87 B | Scripted | Suppression and disruption, not constant player-spammable bombing |

## 4.5 Approximate battle rhythm

The exact timing and local sequence vary by account. Use this as a scenario rhythm rather than a minute-perfect reconstruction.

| Phase | Historical inspiration | Gameplay event |
|---|---|---|
| Dawn | Border crossing and German reconnaissance | German motorcycle/armoured-car probes; Polish player sets final ambush arcs |
| Early morning | First attacks against northern and southern outposts | Limited Panzer I/II groups test the line; prisoners and disabled vehicles become possible |
| Mid-morning | Wider attacks against 19th and 21st Uhlans and IV/84 Infantry | Three German approach lanes activate; first artillery and air support |
| Late morning | Threat to railway crossings and arrival of Śmiały | Armoured train enters for a short fire mission; Polish northern units may cross under cover |
| Noon | Renewed large armoured thrust through Mokra | Village fighting, smoke, burning buildings, AT positions revealed |
| Afternoon | Further concentrated attack and local Polish counterattacks | Reserve uhlans, mounted rifles, and tankettes enter; German command must reorganize disabled columns |
| Late afternoon | Polish ammunition and formation cohesion deteriorate | Optional “hold one more hour” decision; artillery evacuation begins |
| Dusk/night | Flank threat makes continued defence untenable | Polish withdrawal order; German terrain objective converts to pursuit-control objective |

## 4.6 Correct map layout

### Map dimensions and orientation

- **North is up.**
- Recommended historical footprint: roughly **6 km west–east by 7 km north–south**.
- For engine compression, a playable 4 km × 4.5 km space can preserve the essential relationships.
- Keep the central railway visually continuous from south edge near Kłobuck/Brody to north edge near Izbiska.
- Avoid a perfectly flat board. Use low rises, shallow hollows, field banks, and woods to break lines of sight.

### Sector plan

| Sector | Terrain | Main historical/gameplay use |
|---|---|---|
| Northwest | Rębielice-facing tracks, open fields, broken woods | German northern flanking route; 19th Uhlans' screen |
| West-central | Wilkowiecko, broad fields, farm roads | Main Panzer assembly and entry area |
| Southwest | Walenczów/Brody approaches, woods and road bends | German southern thrust against IV/84 Infantry |
| Centre | Mokra I, II, III; orchards, farms, smoke-prone village strips | Main fighting and concealment |
| North-central | Izbiska road and railway crossing | Critical crossing, armoured-train intervention point |
| East-central | Railway embankment, reserve woods, Wapiennik/Wiktorów direction | Polish second line, artillery, command, reserves |
| Southeast | Kołaczkowice/Łobodno withdrawal routes | Organized Polish exit corridor |
| South | Brody and Kłobuck-facing road/rail line | Strategic context, optional map-edge events |

### ASCII planning diagram

```text
                                      NORTH
        RĘBIELICE / KRÓLEWSKIE WOODS                  IZBISKA
     [German north entry]  --->              road --- [rail crossing]
             \             19th Uhlans               ||
              \        woods / ditches               ||  Armoured train route
               \                                      ||
 WILKOWIECKO ---> open fields ---> MOKRA I            || ---> WAPIENNIK
 [main German]                    orchards             ||
 assembly]       --->            MOKRA II             || ---> WIKTORÓW
                 21st Uhlans     village strip        ||  Polish reserves
                 --->            MOKRA III            ||
 WALENCZÓW  ---> woods / fields / IV-84 Infantry      || ---> KOŁACZKOWICE
 [south entry]                                             2nd Mounted Rifles
                         BRODY                           \
                           \                              \ ---> ŁOBODNO
                            \                                  withdrawal zone
                             KŁOBUCK / SOUTH
```

### Terrain percentage target

| Terrain family | Approximate map share | Notes |
|---|---:|---|
| Cultivated fields and meadows | 45–55% | Mixed crop heights; some fields conceal prone infantry but not vehicles |
| Woods and forest margins | 20–28% | Irregular edges; not solid rectangular blocks |
| Village/orchard/farm plots | 8–12% | Mokra should be several strips, not a dense urban centre |
| Roads, tracks, railway, embankment | 5–8% | Railway should constrain crossings and line of fire |
| Ditches, wet hollows, hedges, field banks | 5–10% | Slow tanks, conceal AT teams, channel movement |
| Major open water | **0%** | No lake or broad river |

### Railway implementation

The railway must matter tactically:

- embankment blocks or reduces direct fire across it except at high points;
- tracked vehicles cross only at road crossings, shallow cuts, or engineer-prepared points;
- infantry can climb it slowly almost anywhere;
- the train occupies a physical rail block and must have a clear route;
- a German unit on the track triggers warning signals and may force the train to stop early;
- the Polish player can use the embankment as a fallback line, but it should not be an impenetrable wall.

## 4.7 Deployment

### Polish initial deployment

**Forward concealed line west of the railway**

- 19th Uhlans: north and northwest woods;
- 21st Uhlans: Mokra I–III and central forest edge;
- IV/84 Infantry: southern woods and Brody-facing sector;
- distributed 37 mm AT guns covering roads, field gaps, and village approaches;
- HMGs positioned to separate German infantry from tanks;
- AT-rifle teams in close ambush lanes.

**Second line/east of railway**

- selected 2nd Horse Artillery batteries;
- 12th Uhlans and 2nd Mounted Rifles as reserves;
- 21st Armoured Battalion;
- brigade HQ, signals, medical and supply points;
- final reserve AT guns;
- protected exit routes toward Kołaczkowice and Łobodno.

### German initial deployment

- reconnaissance group on western roads;
- one northern armour group facing Rębielice/Izbiska;
- main armour group near Wilkowiecko;
- southern combined-arms group near Walenczów;
- motorized infantry held behind armour until Polish firing positions are identified;
- artillery observers and a limited Ju 87 support schedule;
- repair/recovery point at the western edge.

## 4.8 Mission structure

### Phase 1 — **Find the line**

**German tasks**

- scout three likely crossing routes;
- identify at least two Polish AT positions;
- avoid losing more than a small number of vehicles before infantry support arrives.

**Polish tasks**

- remain hidden until good shots are available;
- preserve at least half of the forward AT guns through the first probe;
- capture or repel German reconnaissance patrols.

**Trigger to advance:** one German reconnaissance marker reaches the Mokra outer fields, or ten minutes elapse.

### Phase 2 — **First armoured push**

Three German approach lanes activate. The German player may concentrate two and leave one as a feint.

**Dynamic effect:** tanks that outrun supporting infantry suffer a command penalty, reduced spotting, and higher chance of ambush.

**Polish bonus:** simultaneous hits on a column leader and a command vehicle create a temporary “column confusion” debuff.

### Phase 3 — **Śmiały on the line**

Armoured Train No. 53 enters from the south or northeast, depending on map scripting.

The train should be powerful but constrained:

- 90–150 seconds of effective firing in the central sector;
- vulnerable to track obstruction and air attack;
- cannot reverse instantly;
- must leave before the line is cut;
- awards a Polish preservation bonus if it exits intact;
- awards Germany a major achievement for forcing it to withdraw early, not necessarily destroying it.

### Phase 4 — **Mokra burns**

A renewed German attack enters the village. Buildings catch fire from artillery and tank fire, producing smoke that:

- breaks long-range sight;
- lets Polish squads disengage;
- also allows German armour to penetrate between positions;
- makes command and unit identification harder.

Civilians should be absent from the active combat space after the opening cinematic or represented only through pre-battle evacuation. They should never be targets or score objects.

### Phase 5 — **Local Polish counterattack**

The Polish player receives a limited choice:

- counterattack with dismounted 12th Uhlans;
- use 2nd Mounted Rifles to restore the southern gap;
- use tankettes and armoured cars for a fast disruption raid;
- hold reserves for withdrawal protection.

Using all reserves may earn more German combat-loss points but make the final retreat harder.

### Phase 6 — **Break contact**

At dusk, a flank-threat message arrives. The Polish command must withdraw.

- northern units use Izbiska/railway cover;
- central units fall back through Mokra III and the railway cuts;
- southern units disengage through woods toward Kołaczkowice;
- artillery must limber and leave in sequence;
- one rearguard remains active until a minimum percentage has crossed the exit line.

The German objective changes from “break the line” to “secure Mokra and the railway crossings before night.” Chasing into the protected rear edge is unnecessary and penalized.

## 4.9 Objectives

### German objectives

**Primary**

1. Secure Mokra I–III and at least one railway crossing.
2. Open a continuous west–east route for the division before the time limit.
3. Force the Polish brigade to issue a withdrawal order.
4. Finish with a minimum armour-readiness percentage.

**Secondary**

- capture or silence two Polish artillery positions;
- keep one Panzer command vehicle operational;
- recover at least four immobilized tanks;
- clear the Izbiska crossing;
- prevent Polish demolition of a selected culvert or track section.

**Do not use**

- “Destroy every Polish unit.”
- “Kill retreating troops.”
- “Destroy the Polish medical station.”
- body-count scoring as the principal German victory metric.

### Polish objectives

**Primary**

1. Hold the railway line until the withdrawal order.
2. Cause a specified number of German combat-loss points.
3. Preserve brigade command and at least one artillery battery.
4. Evacuate 60–75% of surviving manpower and crews.
5. Keep one withdrawal corridor open.

**Secondary**

- preserve Armoured Train No. 53;
- capture a German command map or radio vehicle;
- recover the crew of a disabled AT gun;
- carry out one successful local counterattack;
- evacuate wounded from a forward aid post.

## 4.10 Scoring model

### Suggested 100-point allocation

| Category | Poland | Germany |
|---|---:|---:|
| Terrain/timetable objectives | 20 | 45 |
| Enemy combat losses | 35 | 15 |
| Own-force preservation | 30 | 25 |
| Command/artillery/train special objectives | 15 | 15 |

### Example combat-loss values

| Target | Damaged | Immobilized/abandoned | Destroyed |
|---|---:|---:|---:|
| Panzer I | 1 | 2 | 3 |
| Panzer II | 1 | 3 | 4 |
| Panzer IV | 2 | 4 | 6 |
| Command tank | 2 | 5 | 7 |
| Polish tankette/armoured car | 1 | 2 | 3 |
| 37 mm AT gun | — | captured: 2 | destroyed: 2 |
| 75 mm artillery gun | — | captured: 4 | destroyed: 3 |

Germany should receive more value for capturing terrain, forcing withdrawal, and keeping the division mobile than for Polish casualties. Poland should receive more value for combat losses and preservation.

## 4.11 Representative game rosters

### Standard-size Polish roster

| Category | Suggested quantity | Notes |
|---|---:|---|
| Brigade HQ / command team | 1 | Withdrawal and reserve-control aura |
| Dismounted cavalry rifle squads | 14–18 | Split among 19th, 21st, 12th Uhlans and 2nd Mounted Rifles |
| Attached infantry squads | 4–6 | IV/84 Infantry and/or 11th Rifle Battalion |
| Mounted cavalry groups | 2–4 | Mobility/redeployment; normally dismount before combat |
| Browning wz. 28 LMG teams | Integrated or 4 | Avoid excessive standalone LMG clutter |
| ckm wz. 30 HMG teams | 5–7 | Strong prepared fire, slow to move |
| 46 mm grenade-launcher teams | 2–3 | Light indirect support |
| 81 mm mortar teams | 2–3 | Limited ammunition |
| wz. 35 AT-rifle teams | 5–8 | Concealed close-range attacks |
| 37 mm Bofors AT guns | 5–7 | Principal anti-tank arm |
| 75 mm wz. 1902/26 guns | 4–6 | Some direct-fire, some indirect-fire |
| MG-armed TKS/TK-3 tankettes | 5–7 | Reconnaissance and disruption |
| wz. 34 armoured cars | 2–3 | Light recon |
| 40 mm Bofors AA | 0–1 on-map | Optional; otherwise scripted air-defence effect |
| Engineers/pioneers | 2 teams | Mines, obstacles, extraction of guns |
| Medics/aid post | 1–2 | Preservation objective |
| Armoured Train No. 53 | 1 scripted asset | Limited window, cannot be treated as a normal tank |

### Standard-size German roster

| Category | Suggested quantity | Notes |
|---|---:|---|
| Division/battle-group command vehicles | 2–3 | Include one PzBef or radio armoured car |
| Panzer I | 18–24 | Numerous but vulnerable to 37 mm fire |
| Panzer II | 10–15 | More dangerous, still vulnerable |
| Panzer IV | 0–2 | Rare support assets |
| Armoured cars | 3–5 | Sd.Kfz. 221/222/231 family as available in asset set |
| Motorcycle reconnaissance squads | 3–5 | Fast, fragile |
| Motorized infantry squads | 11–15 | Truck-borne or on foot after deployment |
| MG34 teams | 3–5 | Suppression and base of fire |
| 5 cm mortar teams | 2–3 | Light support |
| 8 cm mortar teams | 2–3 | Main indirect infantry support |
| 3.7 cm PaK 36 | 2–4 | Defence against Polish armoured cars/tankettes |
| 7.5 cm leIG 18 | 2–3 | Building/woodline suppression |
| Engineer squads | 2–3 | Obstacles and railway crossing |
| Recovery/repair vehicles | 1–2 | Enable recovery objective |
| 10.5 cm artillery missions | 3–5 salvos | Off-map, observer dependent |
| Ju 87 attacks | 1–2 scripted strikes | Telegraph clearly; avoid repeated unavoidable strikes |

### Large-map variant

For a larger Sudden Strike-style battle, increase infantry by 50–75% and vehicles by 40–60%, but do **not** place the division's full historical tank strength on the map. Use staggered waves and off-map reserves so the Polish player can defeat local groups without annihilating an entire division.

## 4.12 AI behaviour

### Polish AI when Germany is the player

Use five morale states:

1. **Concealed:** holds fire until armour is within a chosen kill zone.
2. **Engaged:** fires from cover, shifts HMGs and AT rifles locally.
3. **Threatened:** withdraws one position while another unit covers.
4. **Ordered withdrawal:** moves by route groups toward the railway and rear corridors.
5. **Exiting:** despawns safely after crossing the final line.

Key behaviours:

- AT guns fire at lead/command vehicles, then attempt displacement.
- Infantry avoids standing in open fields against tanks.
- artillery crews limber if threatened rather than fighting to death;
- isolated squads may surrender if surrounded and out of ammunition;
- units do not counterattack merely because the German player is nearby—the counterattacks are tied to historical triggers and local opportunities.

### German AI when Poland is the player

- probes before committing full columns;
- initially risks overextension to create historical opportunities;
- later coordinates armour, infantry, artillery, and air support more effectively;
- attempts northern and southern outflanking moves rather than endless frontal spawning;
- uses smoke/suppression before crossing the railway;
- recovers immobilized tanks if the battlefield is secured.

## 4.13 Balance controls

| Control | Easier for Poland | Harder for Poland |
|---|---|---|
| German wave spacing | Longer pauses | Overlapping attacks |
| Polish concealment | Strong camouflage | Faster German spotting |
| Bofors ammunition | More AP rounds | Strict ammunition scarcity |
| Armoured train | Longer firing window | Track threatened earlier |
| Air power | One telegraphed strike | Two or three strikes |
| Railway crossings | Fewer | More engineer-created crossings |
| Withdrawal deadline | Later and flexible | Fixed and early |
| German recovery | Slow | Efficient repair/recovery teams |
| Polish reserve | Full 12th Uhlans/2nd Mounted Rifles slice | One reserve group withheld |

## 4.14 Suggested briefing text

### Polish briefing

> Dawn has brought war to the Mokra line. The German armoured division is approaching from Wilkowiecko and the western roads. Our brigade cannot stop the entire invasion, but it can ruin the enemy timetable. Hold the fields and woods before the railway, conceal the Bofors guns, and strike the leading tanks at close range. When the order comes, save the brigade for the next battle.

### German briefing

> The road east runs through Mokra and across the railway. Reconnaissance reports cavalry and light infantry, but the ground is broken and the defenders have anti-tank guns. Open the crossings before nightfall, preserve enough armour to continue the advance, and force the Polish brigade off the position. Do not waste the division in unsupported charges.

## 4.15 Historical outcome and how to report it in-game

Use wording such as:

> “The Polish defence repeatedly checked the 4th Panzer Division and put dozens of German tanks and armoured vehicles out of action for varying periods. Exact permanent losses remain disputed because damaged and immobilized vehicles could sometimes be recovered. With neighboring German advances threatening its position, the Wołyńska Cavalry Brigade withdrew in good order during the night.”

Avoid a result screen that confidently states one very high number of permanently destroyed tanks. A detailed after-action report can show:

- destroyed;
- abandoned;
- recovered by Germany;
- repaired after the battle;
- crew casualties;
- Polish guns and vehicles evacuated.

---

# 5. Alternative battle: Jordanów and Wysoka

## 5.1 Scenario identity

**Title:** *Black Brigade at Wysoka*  
**Date:** 2–3 September 1939, within the wider Jordanów fighting of 1–3 September  
**Location:** Wysoka–Jordanów–Krzeczów approaches in the Beskid foothills  
**Map character:** steep ridges, narrow roads, villages, wooded slopes, rail line, defiles  
**Recommended play time:** 70–100 minutes  
**Theme:** motorized delaying action and anti-tank ambush against a much larger mobile corps

## 5.2 Short history

The German XVIII Corps advanced from Slovakia through mountain routes to turn the southern flank of Army Kraków. Colonel Stanisław Maczek's **10th Motorized Cavalry Brigade**—the “Black Brigade”—was sent to block the Jordanów and Rabka approaches. Supported by Border Protection Corps troops, National Defence elements, and Armoured Train No. 51, the brigade fought delaying actions around Wysoka and Jordanów against the German 2nd Panzer Division, 4th Light Division, and 3rd Mountain Division.

The Polish force could not hold every ridge indefinitely, but its anti-tank ambushes imposed serious delays and losses while the brigade retained cohesion and continued fighting. IPN material describes the brigade as a fully motorized but relatively small formation designed more for mobile defence than a heavy armoured breakthrough.[^ipn-maczek][^ipn-jordanow]

## 5.3 Historical units and usual equipment

### Polish

| Unit | Role | Usual equipment |
|---|---|---|
| **10 Brygada Kawalerii** | Main mobile defence | Motorized infantry, tankettes, light tanks, AT guns, motorized artillery |
| **24 Pułk Ułanów** | Motorized infantry regiment | kbk rifles, wz. 28 LMGs, wz. 30 HMGs, mortars, trucks |
| **10 Pułk Strzelców Konnych** | Motorized infantry regiment | Same general infantry weapons, trucks/motorcycles |
| **Dywizjon przeciwpancerny 10 BK** | Concentrated anti-tank arm | 37 mm Bofors wz. 36; commonly listed at 18 guns for the brigade |
| **Dywizjon rozpoznawczy** | Reconnaissance | Motorcycles, armoured cars/tankettes depending detachment |
| **101st Reconnaissance Tank Company** | Light reconnaissance | TK-3/TKS tankettes; only a very small number of 20 mm TKS should be considered, depending chosen date/source interpretation |
| **121st Light Tank Company** | Mobile armoured reserve | Vickers E light tanks, including twin-MG and 47 mm variants |
| **16th Motorized Artillery Battalion** | Mobile fire support | 75 mm field guns and 100 mm howitzers, usually represented by 2–4 on-map pieces plus off-map fire |
| **71st Motorized AA Battery** | Air defence | 40 mm Bofors AA guns |
| **90th Motorized Engineer Battalion/elements** | Roadblocks, demolitions, fieldworks | Explosives, mines, engineering tools |
| **1st KOP Infantry Regiment** | Ridge and village defence | Standard Polish infantry arms, HMGs, mortars, AT rifles |
| National Defence / local detachments | Secondary positions | Rifles, limited LMG/HMG and support weapons |
| Armoured Train No. 51 | Rail fire support and withdrawal cover | Armoured locomotive/wagons, 75 mm guns, HMGs |

### German

| Formation | Role | Usual equipment |
|---|---|---|
| **2. Panzer-Division** | Principal armoured attack | Panzer I/II with limited Panzer III/IV and command tanks; motorized infantry, artillery, engineers |
| **4. leichte Division** | Mobile flank and reconnaissance formation | Light tanks/armoured cars, motorized infantry, motorcycles, artillery |
| **3. Gebirgs-Division** | Mountain infantry pressure | Kar98k, MG34, mortars, mountain artillery, pack transport |
| XVIII Corps support | Operational artillery and air support | 10.5/15 cm artillery and Luftwaffe strikes |

## 5.4 Map design

Build one focused sector rather than the entire corps front.

### Key terrain

- Wysoka ridge as the dominant high ground;
- village streets on the slope, with stone/wood buildings and orchards;
- wooded reverse slopes allowing Polish displacement;
- the main Chabówka–Jordanów road as the German timetable objective;
- one rail segment for Armoured Train No. 51;
- narrow side roads suitable for mines and roadblocks;
- steep or boggy ground that tanks can cross only slowly;
- a Polish rear road toward Krzeczów/Myślenice.

### Recommended flow

1. German reconnaissance tests roadblocks.
2. Polish AT guns engage from reverse-slope or village-edge positions.
3. First German armour wave is checked.
4. Artillery and mountain infantry clear a flank.
5. Polish Vickers/TKS reserve launches a limited counterattack.
6. Armoured train covers a staged withdrawal.
7. Germany occupies the ridge and opens the road; Poland preserves the brigade.

## 5.5 Objectives

### German

- seize Wysoka ridge and the road junction before a fixed hour;
- clear two roadblocks;
- keep a viable armoured column moving east;
- prevent demolition of the main bridge/culvert;
- optional: force the armoured train to retire.

### Polish

- delay the road opening for 45–60 minutes;
- inflict a high number of armoured combat-loss points;
- preserve the motorized brigade's two main regimental groups;
- evacuate artillery and at least half of the mobile armour;
- withdraw by successive ridge lines rather than hold to destruction.

## 5.6 Representative game roster

### Poland

- 10–14 motorized infantry squads;
- 4–6 HMG/LMG support teams;
- 2–3 mortar teams;
- 5–7 37 mm Bofors AT guns;
- 2 × 75 mm guns;
- 1–2 × 100 mm howitzers or off-map missions;
- 3–5 Vickers E tanks;
- 5–8 TK-3/TKS tankettes;
- 1–2 armoured cars;
- 1–2 40 mm Bofors AA guns;
- 2 engineer teams;
- one timed armoured-train pass.

### Germany

- 16–24 Panzer I/II;
- 2–5 Panzer III/IV combined, depending strictness and asset availability;
- 10–14 motorized infantry or mountain-infantry squads;
- 3–4 MG34 teams;
- 2–3 mortar teams;
- 2–4 PaK 36;
- 2 leIG 18;
- 2–4 armoured cars/motorcycle groups;
- engineer platoon;
- limited corps artillery and one/two air strikes.

---

# 6. Alternative battle: Mława position

## 6.1 Scenario identity

**Title:** *The Ditch at Uniszki*  
**Date:** 1–3 September 1939; withdrawal ordered early 4 September  
**Location:** Uniszki Zawadzkie–Mława fortified sector  
**Map character:** low glacial ridge, open approaches, concrete shelters, trenches, anti-tank ditch, marshy flank  
**Recommended play time:** 80–120 minutes  
**Theme:** prepared defence against tanks, infantry, engineers, and artillery

## 6.2 Short history

Army Modlin defended the northern approach from East Prussia toward Warsaw. The 20th Infantry Division occupied a partly completed fortified position north of Mława. The terrain included a low ridge overlooking the Mławka valley, concrete shelters, trenches, anti-tank obstacles, and the difficult Niemyje marsh area. Construction was incomplete when the invasion began.

German infantry divisions and the mixed **Panzer-Division Kempf** attacked from 1 September. Early assaults at Uniszki Zawadzkie were stopped by Polish fieldworks and 37 mm Bofors guns, with the anti-tank ditch disrupting German armour. German engineers and attacks on the flanks gradually made the position untenable. The Polish 20th Division withdrew when penetration elsewhere threatened encirclement. The battle delayed the German northern drive on Warsaw.[^mlawa-overview][^kempf-org]

## 6.3 Historical units and usual equipment

### Polish

| Formation | Main units | Usual equipment |
|---|---|---|
| **Armia “Modlin”** | Army command and reserves | Standard Polish army support |
| **20 Dywizja Piechoty** | 78th, 79th, 80th Infantry Regiments | kbk rifles, wz. 28 LMG, wz. 30 HMG, 46 mm grenade launchers, 81 mm mortars, wz. 35 AT rifles, 37 mm Bofors |
| Divisional artillery | Light and heavy artillery regiments/battalions | 75 mm field guns, 100 mm howitzers, limited 105 mm and 155 mm heavy pieces |
| Engineers | Fortification and obstacle troops | Anti-tank ditch, mines, wire, demolitions |
| **8 Dywizja Piechoty** | Reserve and counterattack elements | Standard infantry-division equipment |
| Nowogródzka and Mazowiecka Cavalry Brigades | Flank screening in wider battle | Dismounted cavalry, AT guns, horse artillery, tankettes in brigade reconnaissance |

A notional Polish active infantry division had three infantry regiments, 27 × 37 mm AT guns, 20 × 81 mm mortars, 92 AT rifles, 24 × 75 mm field guns, 12 × 100 mm howitzers, and small heavy-artillery and AA components, though actual availability varied.[^polish-infantry-org]

### German

| Formation | Main elements | Usual equipment |
|---|---|---|
| **Panzer-Division Kempf** | Panzer-Regiment 7; SS-Regiment Deutschland (mot.); artillery, recon, AT, engineers | Panzer I/II with limited heavier tanks; Kar98k, MG34, mortars, PaK 36, leIG 18, 10.5 cm artillery |
| **11. Infanterie-Division** | Infantry regiments and artillery | Foot/horse-drawn infantry division equipment |
| **61. Infanterie-Division** | Infantry regiments and artillery | Standard German infantry equipment |
| **1. and 12. Infanterie-Divisionen** | Wodrig Corps attack on adjacent sectors | Standard infantry, artillery, engineers |
| Luftwaffe | Tactical support | Reconnaissance and bombing |

The Kempf formation combined Army armour with SS motorized infantry. Its published organization included Panzer-Regiment 7, SS Deutschland, a substantial 3.7 cm anti-tank component, engineers, reconnaissance, and motorized 10.5 cm artillery.[^kempf-org]

## 6.4 Focused map layout

Do not attempt the entire Mława line. Focus on a 3.5–5 km sector around Uniszki Zawadzkie.

### Required features

- low ridge running laterally across the Polish position;
- one 5–6 m anti-tank ditch segment with prepared crossings;
- 8–14 concrete bunkers, some incomplete or lacking ideal fields of fire;
- communication trenches and foxholes;
- wire and mine belts with gaps;
- open northern approaches exposing attackers;
- one marshy/soft-ground flank that is almost impassable to tanks;
- one village cluster and orchard;
- southern evacuation road toward Mława;
- German artillery observation points on northern rises.

### Breach mechanics

- tanks cannot cross the main ditch until engineers fill, bridge, or widen a lane;
- bunkers suppress infantry but have limited rear arcs;
- smoke and artillery can blind positions;
- Polish defenders can counterattack a newly opened lane;
- captured bunkers should yield local spotting or command benefits, not merely points.

## 6.5 Objectives

### German

- open two anti-tank-ditch lanes;
- capture a designated bunker cluster;
- secure the road toward Mława;
- keep engineers alive;
- preserve enough tanks for the next phase;
- force a withdrawal by threatening the rear, not killing every bunker crew.

### Polish

- hold the main line until the reserve/withdrawal message;
- destroy or immobilize German armour at the ditch;
- prevent two simultaneous breach lanes;
- evacuate artillery observers and AT guns;
- withdraw at least 65% of surviving infantry through the southern exits.

## 6.6 Representative game roster

### Poland

- 14–20 infantry squads;
- 6–8 HMG teams;
- 3–4 46 mm grenade-launcher teams;
- 3–4 81 mm mortar teams;
- 5–8 wz. 35 AT-rifle teams;
- 5–7 37 mm Bofors AT guns;
- 2–4 75 mm guns;
- 1–2 100 mm howitzers or off-map missions;
- 2 engineer teams;
- 8–14 bunker positions;
- one small counterattack reserve.

### Germany

- 14–22 Panzer I/II;
- 2–5 Panzer III/IV or support tanks according to chosen Kempf roster;
- 14–18 infantry/motorized infantry squads;
- 4–6 MG34 teams;
- 3–4 mortar teams;
- 3–5 PaK 36;
- 2–3 leIG 18;
- 3–4 engineer teams;
- 10.5 cm artillery missions;
- 1–2 air strikes.

---

# 7. Alternative battle: Borowa Góra and the Piotrków approaches

## 7.1 Scenario identity

**Title:** *Three Hills before Piotrków*  
**Date:** 2–5 September 1939  
**Location:** Góry Borowskie–Rozprza–Wola Krzysztoporska sector  
**Map character:** three low hills, broad fields, scattered villages, wooded folds, stream crossings and roads  
**Recommended play time:** 75–110 minutes  
**Theme:** stubborn infantry defence with a rare Polish 7TP counterattack

## 7.2 Short history

The three hills known as Góry Borowskie formed an important defensive position southwest of Piotrków Trybunalski. Polish troops, particularly the **2nd Legions Infantry Regiment** under Colonel Ludwik Czyżewski, fought to delay German XVI Panzer Corps. The broader defensive grouping included other infantry elements and the Polish light-tank battalion equipped with 7TP tanks operating on the Piotrków approaches.

Polish government commemorative material names the 2nd Legions Infantry Regiment, the **301st Tank Battalion** designation used in that account, and Piotrków Operational Group troops as defenders of the hills.[^borowa-gov] Detailed unit histories commonly identify the operational tank formation as the **2nd Light Tank Battalion** under Major Edmund Karpów, equipped with 7TP tanks. It fought counterattacks around Prudka, Wola Krzysztoporska, Jeżów, and the Piotrków approaches.[^2-light-tank]

For game purposes, label the armoured formation:

> **2nd Light Tank Battalion (also identified as “301st” in some commemorative sources)**

This acknowledges the naming variation without silently mixing two formations.

## 7.3 Historical units and usual equipment

### Polish

| Unit | Role | Usual equipment |
|---|---|---|
| **2 Pułk Piechoty Legionów** | Core hill defence | Standard infantry rifles, wz. 28 LMG, wz. 30 HMG, mortars, AT rifles, 37 mm Bofors |
| Elements of **146th Infantry Regiment / 44th Reserve Infantry Division** | Reinforcement and adjacent defence | Standard/reserve infantry equipment, fewer motor vehicles |
| Piotrków Operational Group elements | Local reserves and heavy weapons | HMG battalion, artillery, engineers |
| **2nd Light Tank Battalion / “301st”** | Mobile counterattack | 7TP light tanks with 37 mm Bofors gun; command and support vehicles |
| 2nd Horse Artillery Battalion elements / nearby artillery | Fire support in wider operation | 75 mm horse artillery |
| 11th Rifle Battalion elements in wider Piotrków fighting | Infantry counterattack support | Standard infantry weapons |

### German

| Formation | Role | Usual equipment |
|---|---|---|
| **1. Panzer-Division** | Main armoured breakthrough on Piotrków axis | Panzer I/II, some III/IV, motorized infantry, artillery, engineers |
| **4. Panzer-Division** | Adjacent/overlapping pressure | Mainly Panzer I/II and limited Panzer IV |
| **14. and 31. Infanterie-Divisionen** | Infantry support and widening of breach | Standard German infantry division equipment |
| XVI Panzer Corps support | Artillery, engineers, air | 10.5/15 cm guns and Luftwaffe support |

## 7.4 Map design

### Layout

- three distinct but mutually supporting hills, not mountains;
- crest lines with reverse-slope trenches;
- villages/farms at hill bases;
- open fields exposing tank approaches;
- wooded ravines or folds that hide reserves;
- a stream or drainage line such as Prudka/Luciąża represented as a **small tactical obstacle**, not a broad river;
- road network leading east/northeast toward Piotrków;
- Polish rear exit toward Dłutów/Tuszyn direction;
- German entry from west/southwest.

### Unique mechanic: limited 7TP counterattack

The Polish 7TP is the strongest Polish tank in this portfolio, but it should remain rare and logistically constrained.

- 7TP can defeat early German tanks at practical combat ranges.
- Ammunition and fuel are limited.
- Radio command works better than in tankette units but is not perfect.
- Mechanical/recovery constraints matter.
- The player should be rewarded for a short, concentrated counterattack and withdrawal, not for leaving tanks exposed until destroyed.

## 7.5 Objectives

### German

- capture two of the three hills;
- open the Piotrków road by the deadline;
- suppress Polish artillery observers;
- prevent the 7TP unit from disrupting the main column;
- preserve a designated armoured battle group.

### Polish

- hold at least two hills until the withdrawal order;
- launch one successful local counterattack;
- disable/destroy a set number of German vehicles;
- preserve at least half of the 7TP force;
- evacuate regimental command and surviving guns.

## 7.6 Representative game roster

### Poland

- 14–18 infantry squads;
- 5–7 HMG teams;
- 3 mortar teams;
- 5–7 wz. 35 AT-rifle teams;
- 4–6 37 mm Bofors AT guns;
- 2–4 75 mm guns;
- 4–8 7TP tanks;
- 2 engineer teams;
- one limited off-map artillery schedule.

### Germany

- 20–28 Panzer I/II;
- 3–6 Panzer III/IV across the attacking groups;
- 12–16 infantry/motorized infantry squads;
- 4 MG34 teams;
- 3 mortar teams;
- 3 PaK 36;
- 2 leIG 18;
- 2–3 engineer teams;
- artillery and one/two air strikes.

---

# 8. Alternative battle: opening phase of the Bzura counteroffensive

## 8.1 Scenario identity

**Title:** *Across the Bzura: The Road to Piątek*  
**Date:** 9–12 September 1939  
**Location:** Łęczyca–Piątek–Góra Świętej Małgorzaty sector  
**Map character:** real river crossings, flat fields, orchards, villages, bridges, causeways, road junctions  
**Recommended play time:** 90–130 minutes  
**Theme:** Polish surprise offensive against a stretched German infantry division, followed by withdrawal before armoured reinforcements close the trap

## 8.2 Short history

The Bzura battle was the largest Polish counteroffensive of the campaign. On 9 September, General Tadeusz Kutrzeba's Army Poznań struck the exposed flank of the German 8th Army. The opening assault was led by General Edmund Knoll-Kownacki's operational group of **14th, 17th, and 25th Infantry Divisions**, supported on the flanks by cavalry formations. The initial German defender was principally the stretched **30th Infantry Division**, with other divisions and armoured forces arriving as the battle expanded.

Polish Army material explicitly describes the opening force as three divisions—14th, 17th, and 25th—supported on the flanks by cavalry.[^polish-army-bzura] Polish attacks captured ground including Łęczyca and Piątek and imposed substantial losses before the Germans concentrated reinforcements and air power.[^ipn-bzura][^mhp-bzura]

Unlike Mokra, this map **should** contain a genuine river. The Bzura is the central operational obstacle, but the playable sector should use one or two crossings rather than model the entire campaign.

## 8.3 Historical units and usual equipment

### Polish

| Formation | Role | Usual equipment |
|---|---|---|
| **14 Dywizja Piechoty** | Main attack toward Piątek | Standard Polish infantry-division weapons and artillery |
| **17 Dywizja Piechoty** | Main/adjacent attack | Same |
| **25 Dywizja Piechoty** | Attack from Łęczyca sector | Same |
| **Wielkopolska Cavalry Brigade** | Flank movement and exploitation | Dismounted cavalry, 37 mm AT guns, horse artillery, tankettes/armoured cars |
| **Podolska Cavalry Brigade** | Opposite flank and mobile action | Similar cavalry-brigade equipment |
| Army artillery/engineers | Crossing and preparatory support | 75/100 mm artillery, bridging tools, limited heavy guns |

### German

| Formation | Role | Usual equipment |
|---|---|---|
| **30. Infanterie-Division** | Initial stretched defender | Kar98k, MG34, 5/8 cm mortars, PaK 36, leIG 18, 10.5 cm artillery; much horse-drawn transport |
| **24. and 17. Infanterie-Divisionen** | Reinforcement in expanding battle | Standard German infantry-division equipment |
| Later panzer/motorized reinforcements | Counterattack and encirclement threat | Panzer I/II/III/IV depending division, armoured cars, motorized infantry |
| Luftwaffe | Increasing air superiority | Reconnaissance, interdiction, bombing |

## 8.4 Map design

### Recommended focused sector

Choose one:

1. **Piątek approach:** Polish infantry attack over fields and villages into a German road junction.
2. **Góra Świętej Małgorzaty:** high ground and village objective after crossing.
3. **Łęczyca bridgehead:** more river-focused, with Polish engineers and German delaying demolitions.

### Required features

- a realistically scaled Bzura channel;
- one intact road bridge and one ford/engineer crossing;
- low floodplain and wet meadows that slow vehicles;
- raised roads/causeways;
- orchards and long strip fields;
- villages with church towers/observation points;
- German artillery and supply areas vulnerable to surprise;
- eastern/southern map edge from which reinforcements eventually arrive.

## 8.5 Two-sided structure

### Poland as player

**Phase 1:** infiltrate and seize crossings.  
**Phase 2:** break the 30th Division's forward companies.  
**Phase 3:** capture the road junction, guns, and supply park.  
**Phase 4:** exploit briefly with cavalry/tankettes.  
**Phase 5:** intelligence reports German armoured reinforcements; withdraw selected formations before the exit closes.

**Victory:** capture objectives, take prisoners, destroy/capture artillery, and withdraw in time.

### Germany as player

The first mission is not to destroy the Polish offensive outright.

- hold one bridge or causeway;
- evacuate artillery and supply vehicles;
- delay the Polish advance for a defined period;
- conduct staged withdrawals through village lines;
- preserve divisional command;
- counterattack only after reinforcement arrival.

A German major victory comes from keeping the retreat route open and preventing the Polish player from achieving full surprise—not from killing the attacking divisions.

## 8.6 Representative game roster

### Poland

- 18–26 infantry squads;
- 6–8 HMG teams;
- 4 mortar teams;
- 5–7 37 mm Bofors AT guns;
- 4–6 75 mm guns and 1–2 100 mm howitzers/off-map missions;
- 4–6 cavalry squads, some initially mounted;
- 4–7 TK-3/TKS tankettes;
- 1–3 armoured cars;
- 3 engineer/bridging teams;
- limited reconnaissance aircraft or off-map spotting.

### Germany

**Initial**

- 12–16 infantry squads;
- 5 MG34 teams;
- 3 mortar teams;
- 3 PaK 36;
- 2 leIG 18;
- 2–4 10.5 cm guns or off-map battery;
- engineers and supply vehicles;
- few/no tanks.

**Reinforcement phase**

- 8–14 Panzer I/II and a small number of III/IV depending selected supporting division;
- 5–8 motorized infantry squads;
- 2–3 armoured cars;
- artillery and air support.

---

# 9. Mini-mission: Krojanty

## 9.1 Scenario identity

**Title:** *Krojanty: Cover the Retreat*  
**Date:** evening, 1 September 1939  
**Map character:** Pomeranian woodland, heath/clearing, railway, low ridge, forest road  
**Recommended play time:** 15–25 minutes  
**Theme:** mounted surprise attack against exposed infantry, followed by immediate disengagement when armoured reconnaissance appears

## 9.2 Short history

The **18th Pomeranian Uhlan Regiment** under Colonel Kazimierz Mastalerz was covering the withdrawal of Polish forces near Chojnice. Elements of the regiment found German infantry from the **76th Infantry Regiment, 20th Motorized Infantry Division**, exposed or resting in a clearing. About two squadrons conducted a mounted charge that dispersed the infantry. German armoured reconnaissance vehicles then arrived and opened fire, forcing the uhlans to disengage.

This event was later distorted into the false story that Polish cavalry deliberately charged tanks. Official Polish remembrance and museum material describe the action as a manoeuvre against infantry that helped cover other Polish units' withdrawal.[^krojanty-ipn][^cavalry-myth]

## 9.3 Units and equipment

### Polish

- 18th Pomeranian Uhlan Regiment;
- two mounted squadron groups for the charge;
- limited dismounted rifle/LMG support;
- reserve tankettes may appear off to the side but should not participate in the charge;
- rifles, sabres for close shock action, Browning wz. 28 LMGs, limited HMG/AT assets in reserve.

### German

- exposed infantry elements of 76th Infantry Regiment;
- MG34 teams;
- later armoured reconnaissance vehicles, represented by 1–3 light/heavy armoured cars;
- supporting motorized infantry arriving after a delay.

## 9.4 Objectives

### Polish

1. Scout the clearing without alerting the infantry.
2. Charge and break the exposed German formation.
3. Hold for only a brief time.
4. Withdraw behind the ridge when armoured cars appear.
5. Keep the Czersk Group withdrawal route open for a fixed number of minutes.

### German

1. Rally scattered infantry.
2. Bring armoured reconnaissance forward.
3. Recover the clearing and railway crossing.
4. Resume pursuit by the deadline.
5. Do not receive points for chasing Polish cavalry beyond the rear control line.

## 9.5 Authenticity restrictions

- no German tanks are present at the moment of the charge;
- no Polish “lance versus tank” animation;
- the charge succeeds tactically against infantry but cannot hold exposed ground;
- the Polish objective is delay and disengagement;
- casualties are not the sole result metric.

---

# 10. Master equipment reference

This section documents the weapons and vehicles most useful across the proposed scenario set. “Usual issue” describes common or doctrinal use, not a guarantee that every squad carried every item.

## 10.1 Polish small arms and infantry support weapons

| Weapon | Calibre | Usual users | Suggested game role |
|---|---:|---|---|
| **kb wz. 98 / kbk wz. 98 / kbk wz. 29** | 7.92 mm | Infantry and cavalry | Standard bolt-action rifle; accurate, moderate rate of fire |
| **Browning rkm wz. 28** | 7.92 mm | Rifle squads | 20-round magazine LMG; mobile squad firepower |
| **ckm wz. 30** | 7.92 mm | HMG companies/squadrons | Water-cooled sustained fire; tripod, slow relocation |
| **Pistolet Vis wz. 35** | 9 mm | Officers, NCOs, specialists | Short-range sidearm |
| **wz. 35 “Ur” anti-tank rifle** | 7.92 mm | Selected concealed AT teams | Close-range penetration/module damage against early tanks |
| **46 mm granatnik wz. 36** | 46 mm | Rifle-company support | Light indirect fire, smoke/HE, limited range |
| **moździerz wz. 31** | 81 mm | Battalion support | HE and smoke; useful against woods and gun crews |
| Hand grenades | Various | Infantry/cavalry | Trench, building, and close anti-vehicle attacks |
| Rifle grenades / signals | Limited | Selected troops | Utility, not mass-issued superweapon |

The wz. 35 used a four-round magazine and could penetrate roughly 15 mm armour at 300 m in cited museum material. In-game it should be dangerous to Panzer I/II flanks and running gear at close range, but less decisive than the 37 mm Bofors.[^ur-museum]

## 10.2 Polish anti-tank, artillery, and anti-aircraft weapons

| Weapon | Usual unit | Battlefield role | Game modelling |
|---|---|---|---|
| **37 mm armata ppanc. wz. 36 Bofors** | Infantry-regiment AT companies and cavalry formations | Main dedicated AT gun | Excellent against early light armour; low silhouette; concealment bonus |
| **75 mm armata wz. 1902/26** | Horse artillery and infantry artillery | Direct/indirect support | Powerful direct shot, narrow traverse, horse-limber delay |
| **75 mm armata wz. 1897** | Light artillery and some motorized formations | Divisional/brigade fire support | Better as battery/off-map or limited on-map gun |
| **100 mm haubica wz. 14/19** | Divisional/motorized artillery | Medium howitzer | High explosive and smoke; slower response |
| **105 mm gun / 155 mm howitzer** | Divisional heavy artillery | Long-range support | Off-map only in most maps |
| **40 mm Bofors wz. 36 AA** | Divisional or brigade AA battery | Air defence, emergency ground fire | Limited ammunition and very scarce on-map |

The 75 mm wz. 1902/26 equipped horse-artillery battalions and infantry-artillery platoons; a cavalry battery normally had four guns. Museum material notes that it could also be effective in direct anti-tank fire when well handled.[^75mm-1902]

## 10.3 Polish armoured vehicles

| Vehicle | Main armament | Usual employment | Scenario use |
|---|---|---|---|
| **TK-3** | 7.92 mm MG | Reconnaissance tankette | Mokra, cavalry-brigade and Bzura reconnaissance |
| **TKS** | Usually 7.92 mm Hotchkiss MG | Reconnaissance, liaison, infantry support | Mokra/Jordanów/Bzura; vulnerable to all proper AT weapons |
| **TKS 20 mm** | 20 mm cannon | Very rare anti-armour variant | Use only where specifically justified; not routine Mokra equipment |
| **samochód pancerny wz. 34** | MG or short 37 mm depending variant | Cavalry armoured-car squadron | Reconnaissance, screening; weak armour and cross-country limits |
| **Vickers E Type A** | Twin MG turrets | Light tank | Jordanów/10th Brigade scenario |
| **Vickers E Type B** | 47 mm gun | Light tank | Jordanów; limited numbers |
| **7TP single-turret** | 37 mm Bofors gun + MG | Light tank battalions | Borowa Góra/Piotrków; can defeat early German tanks |
| **7TP twin-turret** | Twin MGs | Older light-tank variant | Only if the selected unit/date warrants it |
| Armoured train | 75 mm guns, HMGs, AA weapons depending train | Rail-mobile fire support | Scripted asset, constrained by track |

## 10.4 Polish mobility, command, and logistics

| Asset | Typical use | Gameplay implication |
|---|---|---|
| Horses | Cavalry movement, artillery and supply haulage | Fast road/field movement for cavalry; vulnerable horse lines; guns require limbering |
| Horse-drawn wagons and limbers | Ammunition, food, artillery | Logistics objective; slower than trucks |
| Polski Fiat 508/518 staff cars | Command and liaison | Mobile command bonus, fragile |
| Polski Fiat 621 and other trucks | Motorized brigades and supply | Important at Jordanów; not universal in ordinary infantry divisions |
| Motorcycles | Reconnaissance and liaison | Fast scouts |
| Bicycles | Cavalry/infantry reconnaissance and messages | Quiet movement, low logistical burden |
| Field telephone | Main reliable local command link | Cable cuts reduce artillery/command efficiency |
| Radio | More common in armoured/motorized assets than ordinary infantry | Command radius and spotting link, but not universal |

## 10.5 German small arms and infantry support weapons

| Weapon | Calibre | Usual users | Suggested game role |
|---|---:|---|---|
| **Karabiner 98k** | 7.92 mm | Most infantry | Standard rifle |
| **MG34** | 7.92 mm | Squad and heavy-MG roles | Core German firepower; bipod or tripod modes |
| **MP38** | 9 mm | Leaders, vehicle crews, assault specialists | Rare close-range weapon; do not equip whole squads |
| Pistole 08 / 38 | 9 mm | Officers and specialists | Sidearm |
| **5 cm leGrW 36** | 50 mm | Platoon/company support | Light, quick mortar |
| **8 cm GrW 34** | 81 mm | Battalion support | Main German mortar |
| Hand grenades | — | Infantry/engineers | Assault and close combat |
| Flamethrower | — | Engineers, limited | Bunker/fortification tool; scarce |

## 10.6 German anti-tank, artillery, and AA weapons

| Weapon | Usual unit | Battlefield role | Game modelling |
|---|---|---|---|
| **3.7 cm PaK 36** | Infantry/panzer anti-tank units | Standard 1939 AT gun | Strong against tankettes/armoured cars; modest against 7TP front |
| **7.5 cm leIG 18** | Infantry-gun company | Direct HE support | Useful against villages, woods, bunkers |
| **10.5 cm leFH 18** | Divisional artillery | Main light howitzer | Off-map or limited on-map battery |
| **15 cm sFH 18** | Corps/divisional heavy artillery | Heavy bombardment | Rare, mostly off-map |
| **2 cm FlaK 30** | AA units | Light AA / ground suppression | Dangerous to light armour and infantry |
| **8.8 cm FlaK 18** | Heavy AA | Long-range AA and exceptional AT use | Rare special asset, not routine on every 1939 map |

## 10.7 German tanks and reconnaissance vehicles

| Vehicle | Main armament | Role in 1939 | Scenario use |
|---|---|---|---|
| **Panzer I** | Twin 7.92 mm MGs | Training-origin light tank used in large numbers | Suppression and exploitation; vulnerable to AT rifles/guns |
| **Panzer II** | 20 mm cannon + MG | Main light combat/scout tank | More lethal to infantry/tankettes, still lightly armoured |
| **Panzer III early** | 37 mm gun + MGs | Tank-fighting type, still limited in number | Jordanów/Mława/Borowa depending formation; generally omit at Mokra |
| **Panzer IV early** | Short 75 mm gun + MGs | Close-support tank | Scarce, strong HE, not a long-range late-war tank |
| **PzBef command tank** | Usually MG or dummy/main command fit | Radio command | High-value command target, not front-line brawler |
| **Sd.Kfz. 221** | MG | Light reconnaissance | Fast, thin armour |
| **Sd.Kfz. 222** | 20 mm cannon + MG | Armed reconnaissance | Strong against infantry/tankettes |
| **Sd.Kfz. 231 family** | 20 mm cannon + MG | Heavy wheeled reconnaissance | Fast on roads, less agile in soft fields |
| Motorcycles | MG/sidearms by crew | Reconnaissance and messengers | Fragile, high spotting |
| Trucks | Transport | Main motorized-infantry movement | Infantry dismounts before close action |
| Half-tracks | Limited | Specialized transport | Do not represent all German motorized infantry with them |

## 10.8 Air support

| Aircraft/support | Side | Best scenario role |
|---|---|---|
| **Ju 87 B Stuka** | Germany | Scripted dive-bombing against artillery, rail, or strongpoint; clearly telegraphed |
| **Hs 123** | Germany | Optional close-support attack where historically appropriate |
| Reconnaissance aircraft | Both | Temporary spotting, artillery correction |
| Polish PZL.23 Karaś | Poland | Limited scripted strike in Jordanów-area scenario, not routine close-air spam |
| Light AA | Both | Reduces accuracy or aborts strikes rather than always shooting aircraft down |

---

# 11. Historical-authenticity rules

## 11.1 Non-negotiable corrections

1. **Mokra is near Kłobuck; Mórka by Jezioro Mórka is a different location.**
2. Remove the large watercourse from the Mokra map.
3. The Polish commander at Mokra was **Colonel Julian Filipowicz**, not General Władysław Sikorski.
4. The main German opponent was the **4th Panzer Division** under Georg-Hans Reinhardt.
5. Polish cavalry fought mainly dismounted.
6. Do not portray a sabre charge against tanks at Mokra or Krojanty.
7. Do not place 7TP tanks at Mokra.
8. Do not fill Mokra with 20 mm-armed TKS tankettes; use MG-armed vehicles.
9. Do not saturate German infantry with MP40s; in September 1939 use Kar98k and MG34 as the norm, with limited MP38s.
10. Do not put every German infantry squad in a half-track.
11. Do not treat a disabled tank as automatically destroyed.
12. Do not use late-war camouflage, equipment, Panzerfausts, Tigers, Panthers, or late-war uniforms.

## 11.2 Visual direction

### Polish

- khaki uniforms and wz. 31 helmets for infantry;
- cavalry uniforms with unit distinctions kept subtle at game camera distance;
- horse furniture, limbers, wagons, bicycles, and field telephones;
- vehicles in 1939 Polish camouflage appropriate to the asset;
- AT guns low and well camouflaged with vegetation;
- villages with wooden and plaster farmhouses, barns, orchards, fences, wells, and roadside shrines.

### German

- field-grey uniforms and early-war equipment;
- Panzer crews in black uniforms where visible;
- grey/brown early-war vehicle finish and correct 1939 markings where possible;
- motorcycles, trucks, horse-drawn elements for ordinary infantry divisions;
- early Panzer silhouettes and short-barrel Panzer IV.

## 11.3 Polish unit-name accuracy

Keep original names in the detailed UI, with English tooltips.

Examples:

- `21 Pułk Ułanów Nadwiślańskich` — 21st Vistula Uhlan Regiment
- `2 Dywizjon Artylerii Konnej` — 2nd Horse Artillery Battalion/Group
- `21 Dywizjon Pancerny` — 21st Armoured Battalion/Detachment
- `4/84 pp` — IV Battalion, 84th Infantry Regiment
- `2 psk` — 2nd Mounted Rifles Regiment

A Polish `dywizjon` is not a division. Depending on arm, it is approximately a battalion/group. A `pułk` is a regiment, while a cavalry regiment in manpower could be closer to an infantry battalion than to a large infantry regiment.

## 11.4 Sensitive portrayal

- Do not make civilians destructible score objects.
- Avoid celebratory kill language in briefings.
- Use “combat loss,” “disabled,” “forced to abandon,” “captured,” and “withdrew” precisely.
- Include wounded evacuation and surrender where the engine permits.
- Avoid framing Polish operational withdrawals as cowardice or rout.
- Avoid framing German success as effortless technological inevitability.
- Keep victory text focused on military tasks, time, terrain, and preservation.

---

# 12. Production and scripting checklist

## 12.1 Mokra map art checklist

- [ ] North–south railway and embankment
- [ ] Limited crossings at Izbiska and central/southern points
- [ ] Mokra I, II, III as separated village strips
- [ ] Wilkowiecko western assembly area
- [ ] Rębielice/northern approach
- [ ] Walenczów/southern approach
- [ ] Woods around northern, central, and southern sectors
- [ ] Open fields with crop-height variation
- [ ] Orchards, farmyards, fences, haystacks
- [ ] Ditches, wet hollows, sunken tracks
- [ ] No broad river or lake
- [ ] Eastern artillery/reserve positions
- [ ] Withdrawal routes to Kołaczkowice/Łobodno
- [ ] Armoured-train path and exit triggers
- [ ] German recovery area at west edge
- [ ] Polish aid post and ammunition points

## 12.2 Mokra scripting checklist

- [ ] Three German approach lanes
- [ ] Reconnaissance phase
- [ ] Concealed Polish AT opening fire rules
- [ ] German command/confusion effect
- [ ] Armoured Train No. 53 timed arrival
- [ ] Smoke and village-fire escalation
- [ ] Polish reserve-choice event
- [ ] German air-support telegraph
- [ ] Armour recovery mechanic
- [ ] Polish artillery limber/evacuation
- [ ] Dusk withdrawal order
- [ ] Protected exit-state logic
- [ ] No points for fire into final withdrawal zone
- [ ] Multi-state tank after-action report
- [ ] Historical epilogue explaining tactical success and withdrawal

## 12.3 Asset priorities across all maps

### Highest priority

1. Polish 37 mm Bofors AT gun
2. Panzer I and II
3. Polish cavalry infantry set, mounted and dismounted
4. ckm wz. 30 and Browning wz. 28 teams
5. TKS/TK-3
6. 75 mm wz. 1902/26 with horse limber
7. early German motorized infantry, trucks, and motorcycles
8. railway embankment and armoured train
9. Polish wz. 35 AT-rifle team
10. rural Polish village and orchard kit

### Second priority

- wz. 34 armoured car;
- Panzer IV early;
- 7TP;
- Vickers E;
- 40 mm Bofors AA;
- German PaK 36 and leIG 18;
- concrete bunker kit for Mława;
- river/bridge kit for Bzura;
- mountain-road and ridge kit for Jordanów.

## 12.4 Recommended campaign order

1. **Krojanty — tutorial:** movement, mounted/dismounted control, shock and withdrawal.
2. **Mokra — core defensive mission:** concealment, anti-tank ambush, train, phased retreat.
3. **Jordanów — mobile defence:** trucks, ridge ambushes, roadblocks.
4. **Mława — fortified line:** bunkers, engineers, ditch crossing.
5. **Borowa Góra — combined arms:** infantry hills and 7TP counterattack.
6. **Bzura — Polish offensive:** river crossing, surprise, prisoners, exploitation, timed withdrawal.

This order introduces mechanics gradually while showing that the Polish Army of 1939 was not one uniform force: it included horse-mobile cavalry, motorized troops, fortified infantry, armoured units, and large infantry formations.

---

# 13. Polish terminology and abbreviations

| Abbreviation / term | Full Polish | Practical English rendering |
|---|---|---|
| BK | Brygada Kawalerii | Cavalry Brigade |
| BK Zmot. | Brygada Kawalerii Zmotoryzowanej | Motorized Cavalry Brigade |
| DP | Dywizja Piechoty | Infantry Division |
| DPanc. | Dywizja Pancerna | Panzer/Armoured Division |
| puł. / p.uł. | Pułk Ułanów | Uhlan Regiment |
| psk | Pułk Strzelców Konnych | Mounted Rifles Regiment |
| pp | Pułk Piechoty | Infantry Regiment |
| bsp / bs | Batalion Strzelców | Rifle Battalion |
| dak | Dywizjon Artylerii Konnej | Horse Artillery Battalion/Group |
| dywizjon pancerny | — | Armoured battalion/detachment; not a division |
| ckm | ciężki karabin maszynowy | Heavy machine gun |
| rkm | ręczny karabin maszynowy | Light machine gun |
| ppanc. | przeciwpancerny | Anti-tank |
| plot. | przeciwlotniczy | Anti-aircraft |
| wz. | wzór | Model/pattern |
| kb | karabin | Rifle |
| kbk | karabinek | Carbine/short rifle |
| GO | Grupa Operacyjna | Operational Group |
| KOP | Korpus Ochrony Pogranicza | Border Protection Corps |
| ON | Obrona Narodowa | National Defence |

---

# 14. Sources and further reading

The sources below support the historical framework and equipment guidance. Exact losses and some detailed subunit locations remain debated; scenario text should acknowledge that uncertainty.

## Battle of Mokra and geography

[^ipn-mokra-2019]: Instytut Pamięci Narodowej, “Obchody 80. rocznicy wybuchu II wojny światowej i bitwy pod Mokrą,” noting the Wołyńska Cavalry Brigade under Julian Filipowicz, support from 30th Infantry Division elements and armoured trains, attacks by 4th Panzer Division with Ju 87 support, and the night withdrawal. <https://wroclaw.ipn.gov.pl/wro/aktualnosci/76762%2CObchody-80-rocznicy-wybuchu-II-wojny-swiatowej-i-bitwy-od-Mokra-1-wrzesnia-2019.html>

[^ipn-mokra-2008]: Instytut Pamięci Narodowej, “Obchody 69. rocznicy bitwy pod Mokrą.” <https://ipn.gov.pl/pl/aktualnosci/2393%2CObchody-69-rocznicy-bitwy-pod-Mokra-Mokra-31-sierpnia-2008-r.html>

[^mokra-location]: Śląskie Travel, “The Memorial of the Battle of Mokra,” identifying Mokra in Kłobuck County as the battle site; coordinate cross-checks place the village at approximately 50.964 N, 18.917 E. <https://www.slaskie.travel/en-US/Poi/Pokaz/2891/528/the-memorial-of-the-battle-of-mokra>

[^morka-map]: Mapcarta/OpenStreetMap-derived entries for Mórka and Jezioro Mórka in Greater Poland, near 52.01 N, 16.95–16.96 E. <https://mapcarta.com/18528566> and <https://mapcarta.com/W267760328>

[^4pz-oob]: Leo Niehorster, “4. Panzer-Division, German Army Organizations, 1.09.1939,” showing the divisional headquarters, 4th Schützen Brigade/Schützen Regiment 12, 5th Panzer Brigade with Panzer Regiments 35 and 36, Artillery Regiment 103, Reconnaissance Battalion 7, Anti-Tank Battalion 49, Engineer Battalion 79, Signals Battalion 79, and support services. <https://www.niehorster.org/011_germany/39_organ_army/39_pz-04.html> See also Samuel W. Mitcham, *The Panzer Legions*.

[^german-tank-strength]: Leo Niehorster, “German Tank Strengths, 01.09.1939,” and commonly cited 4th Panzer Division campaign-start figures. <https://www.niehorster.org/011_germany/afv-strengths/_afv_39-09-01.htm>

## Polish organization and equipment

[^polish-cavalry-org]: George F. Nafziger organizational chart, “Polish Cavalry Brigade, 1939,” based on Eugeniusz Kozłowski, *Wojna Obronna Polski 1939*. <https://www.generalstaff.org/NAF/Pt_I_1939-1940/939pxpf.pdf>

[^polish-infantry-org]: George F. Nafziger organizational chart, “Polish Infantry Division, 1939,” based on Eugeniusz Kozłowski. <https://www.generalstaff.org/NAF/Pt_I_1939-1940/939pxpg.pdf>

[^bofors-37]: Muzeum Wojska Polskiego, “Armata przeciwpancerna wz. 36 kal. 37 mm,” including penetration, towing, and issue information. <https://muzeumwp.pl/mwpedia/armata-przeciwpancerna-wz-36-kal-37-mm/>

[^ur-museum]: Muzeum II Wojny Światowej, “Karabin przeciwpancerny Ur wz. 35,” including 7.92 mm calibre, four-round magazine, and cited penetration performance. <https://www.muzeum1939.pl/aktualnosci/-poznajwystaweglowna--karabin-przeciwpancerny-ur-wz-35-11466>

[^tks-museum]: Muzeum Broni Pancernej w Poznaniu, “TKS,” noting that TK-3/TKS were common Polish armoured vehicles and were usually armed with a 7.92 mm Hotchkiss MG, while a 20 mm variant existed. <https://muzeumbronipancernej.pl/eksponaty/tks/>

[^75mm-1902]: Muzeum Ziemi Sochaczewskiej i Pola Bitwy nad Bzurą, “Armata lekka 75 mm wz. 1902/26,” including cavalry-battery organization and use in direct anti-tank fire. <https://www.muzeumsochaczew.pl/armata-lekka-75-mm-wz-1902_26-dak-i-pp/>

## Cavalry doctrine and Krojanty

[^cavalry-myth]: Muzeum II Wojny Światowej, “Kawaleria przeciw czołgom — kłamstwo, które stało się mitem.” <https://www.muzeum1939.pl/aktualnosci/kawaleria-przeciw-czolgom--klamstwo-ktore-stalo-sie-mitem-m2wswirtualnie-11310>

[^national-ww2-polish-cavalry]: The National WWII Museum, “The Invasion of Poland,” discussing Polish cavalry as troops armed with rifles, machine guns, and anti-tank rifles rather than an anti-tank sabre force. <https://www.nationalww2museum.org/war/articles/invasion-poland-september-1939>

[^krojanty-ipn]: Instytut Pamięci Narodowej, “84. rocznica wybuchu II wojny światowej i szarży 18. Pułku Ułanów Pomorskich,” describing the regiment's role in covering the Chojnice sector and delaying the German 76th Regiment. <https://ipn.gov.pl/pl/aktualnosci/190137%2C84-rocznica-wybuchu-II-wojny-swiatowej-i-szarzy-18-Pulku-Ulanow-Pomorskich-z-109.html>

## Jordanów and Maczek

[^ipn-jordanow]: Instytut Pamięci Narodowej, “Piknik historyczny i rekonstrukcja bitwy pod Jordanowem,” identifying the 10th Cavalry Brigade, 1st KOP Regiment, Armoured Train No. 51, and opposing XVIII Corps forces. <https://ipn.gov.pl/pl/aktualnosci/149669%2CPiknik-historyczny-i-rekonstrukcja-bitwy-pod-Jordanowem.html>

[^ipn-maczek]: Instytut Pamięci Narodowej, Jerzy Kirszak, material on Stanisław Maczek and the 10th Cavalry Brigade, describing it as fully motorized, relatively small, mobile, machine-gun-rich, and oriented toward defensive action. <https://wroclaw.ipn.gov.pl/wro/aktualnosci/233569%2CDr-hab-Jerzy-Kirszak-Najskuteczniejszy-polski-dowodca-w-II-wojnie-swiatowej-Gene.html>

## Mława

[^mlawa-overview]: Polish Armed Forces, “81. rocznica bitwy pod Mławą,” identifying the battle north of Mława in the opening days of September 1939. <https://www.wojsko-polskie.pl/articles/tym-zyjemy-v/2020-09-04q-81-rocznica-bitwy-pod-mawa/> For the fortification landscape, see Muzeum Ziemi Zawkrzeńskiej and the broader literature by Ryszard Juszkiewicz.

[^kempf-org]: George F. Nafziger, “Organization of the Kempf Panzer Division, August 1939,” listing Panzer Regiment 7, SS Deutschland, AT, engineer, reconnaissance, artillery, signals, and support elements. <https://www.generalstaff.org/NAF/Pt_I_1939-1940/939ghpz.pdf>

## Borowa Góra and 7TP operations

[^borowa-gov]: Ministry of National Defence, Republic of Poland, “Uroczystości bohaterskiej obrony Gór Borowskich,” identifying the three hills, 2nd Legions Infantry Regiment, the tank battalion designation used in the commemoration, and Piotrków Operational Group. <https://www.gov.pl/web/obrona-narodowa/uroczystosci-bohaterskiej-obrony-gor-borowskich-2>

[^2-light-tank]: *Polska Zbrojna*, “Siedmiotonowy polski w boju,” describing the 2nd Light Tank Battalion, its 7TP equipment, Major Edmund Karpów, and its movement into the Army Łódź area. <https://www.polska-zbrojna.pl/home/articleshow/25385?t=Siedmiotonowy-polski-w-boju> A detailed unit summary with specialist bibliography is available at <https://pl.wikipedia.org/wiki/2_Batalion_Czo%C5%82g%C3%B3w_Lekkich>.

## Bzura

[^polish-army-bzura]: Polish Armed Forces, “Bitwa nad Bzurą,” stating that Knoll-Kownacki's group began the attack with the 14th, 17th, and 25th Infantry Divisions, supported on the flanks by cavalry. <https://www.wojsko-polskie.pl/bitwa-nad-bzura/>

[^ipn-bzura]: Instytut Pamięci Narodowej, September 1939 calendar/history material on the Polish attack beginning 9 September. <https://polskiemiesiace.ipn.gov.pl/mie/wszystkie-wydarzenia/wrzesien-1939/kalendarium/poczatek-ii-wojny-swiat/118438%2C9-wrzesnia-1939-sobota.html>

[^mhp-bzura]: Muzeum Historii Polski, “Bitwa nad Bzurą.” <https://muzhp.pl/wiedza-on-line/bitwa-nad-bzura>

## German equipment background

A useful period reference is the U.S. War Department's wartime handbook on German infantry weapons, **Special Series No. 14, German Infantry Weapons**: <https://www.bulletpicker.com/pdf/Special-Series-14.pdf>

For German campaign organization and strengths, see Leo Niehorster's organizational series:

- <https://www.niehorster.org/011_germany/39_organ_army/_39_org_army.html>
- <https://www.niehorster.org/011_germany/39-oob/_39-oob.html>
- <https://www.niehorster.org/011_germany/afv-strengths/_afv_39-09-01.htm>

---

## Final one-page implementation summary

### Build Mokra first within the Poland 1939 campaign

- Correct place: Mokra near Kłobuck, not Mórka by the lake.
- Remove all major water.
- Centre the map on Mokra I–III and the north–south railway.
- Use 4th Panzer Division versus the reinforced Wołyńska Cavalry Brigade.
- Make Polish 37 mm Bofors guns, 75 mm horse artillery, wz. 35 AT rifles, and Armoured Train No. 53 the defining assets.
- Use mostly Panzer I and II for Germany, very few Panzer IV, and no routine Panzer III at Mokra.
- Give Germany terrain, timetable, crossing, and armour-preservation objectives.
- Give Poland delay, combat-loss, counterattack, and organized-evacuation objectives.
- End with a protected Polish withdrawal toward Kołaczkowice/Łobodno.
- Report destroyed, immobilized, abandoned, and recovered vehicles separately.
- Preserve the historical conclusion: a costly German check and a Polish tactical success, followed by a deliberate withdrawal because the wider front had moved.
