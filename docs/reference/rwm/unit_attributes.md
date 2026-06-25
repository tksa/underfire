# Unit attribute schema

The engine (`n2Game_Dll.dll`) defines units as records of named attributes. The
complete list of 593 attribute identifiers is in `raw/unit_attribute_fields.txt`;
below they are grouped by system with their meaning. Per-unit **values** (e.g. a
specific tank's speed/armor numbers) live in the climate stats archives
(`rwm_*_stats.sue`); this document is the **schema** - what each knob does - which
is what you need to model the same behavior in a new engine.

Field names are verbatim from the binary; descriptions are *(inferred)* from the
name + the engine module that uses it unless obvious.

## Movement
`movespeed`, `backmovespeed`, `crouchmovespeed`, `siegespeed` (deploy/dig-in move),
`speed`, `speedfactor`, `turnspeed`, `turndelay`, `gunturndelay` (turret/gun
traverse), `amove` (attack-move), `move`, `stop`, `stopped`, `cannotmove`,
`canmovebackward`, `walkonground`, `walkonshallows`, `walkonwater` (terrain
passability), `marchenabled`, `marchsightbonus` (road-march speed/sight),
`falldownspeed`/`fallspeed`/`falldownspeed`, `longunit` (multi-cell footprint),
`track`/`groundtrace`/`watertrace`/`doubletrace` (movement tracks left on ground),
`ignoremines`, `rotate`, `soldtomove`.

Stopping is an explicit state (`stop`/`stopped`/`cannotmove`); units also auto-stop
to fire if `crouchtofire` and turn the hull/turret using `turnspeed`/`turndelay`/
`gunturndelay` before a shot.

## Weapons & firing
`fire`, `startattack`, `shotauto`/`shots`/`shotsold`, `accuracy`,
`addshot`/`addshotnum`/`addshotdelay`/`addshotdmg`/`addshotaccuracy`/`addshotrnd`
(secondary/extra shots), `burstshots`/`burstreload`/`burstreloadtime`,
`reload`/`reload1`/`reload2`/`reloadtime`/`anireload`, `gunshotwait`,
`range`/`maxdistance`/`maxgund`, `deadzone`/`bonus_shotdeadzone` (minimum range),
`alarmrange` (open-fire range), `bigpressrange`, `davirange`, `scanrange`,
`bonus_shotrange`/`bonus_sight`, `pierce`/`shot_armor`/`shot_damage`/`shot_delta`,
`shotanimation`, `attack_ground`/`attack_move`/`attack_unit`/`attackpoint`/
`attackunit`/`attackcrew`/`canattackpoint`, `attackpref` (target preference),
`crouchtofire`, `canfirefrominside`/`passcanfire` (fire from transport/house),
`turret`/`turret_type`/`onturretanitime`.

Weapon classes referenced by name: `gun`, `gaub`/`gaubfire`/`newtypegaub`
(howitzer), `katya`/`katyafire`/`katyatypegaub` (Katyusha rocket), `zenit`/`mzenit`/
`szenit`/`atg_zenit` (AA), `atg`/`atg_gaub` (anti-tank gun), `planebomb`/`bombid`.

## Ammunition
`ammo1`, `ammo2` (two ammo pools, e.g. AP/HE), `useammo`, `outofammo`,
`ammoregendelay` (infantry ammo regen), `preload`, `mineammo`, `cratereload`,
`crate` (ammo crate). Running dry (`outofammo`) disables `fire`; supply trucks
(`gruz`) replenish via `reload`/`crate`.

## Armor, health, damage
`armor`, `shot_armor`, `protection`, `tanksonarmorprotection` (riders' protection),
`health`, `damage`, `nodamage`, `movedamagehp` (engine/track damage state),
`closetodeath`, `unloadhp`, `hitid`/`hitsnames`/`onhit_`/`ondmg_` (hit reaction
tables), `dieexplosion`/`collisionexplosion`/`crashtime`, `destroyland`/
`destroyobjs` (terrain/object destruction on impact), `ruinedname` (wreck name).

## Sight & detection (scan)
`sight`, `crouchsight`, `scanrange`, `scandelay`, `airscandelay`, `enemyinsight`,
`camouflage`/`invis` (concealment), `binocular`, `officerradius`/`soldradius`
(command/aura radius), `captivevisradius`/`captivevistime` (spotting captives),
`fogvisibility`/`fogrgbc` (fog of war). Handled by the `scan`/`scaner` modules.

## Crew, passengers & transport (container)
`crew_number`/`crew_unit`/`crewunit`/`crew_ver`, `canbecrew`, `crewcanbehealed`,
`crewpickupdir`, `movecrew`, `cont_crew`/`cont_pass`/`cont_targets`/`cont_fires`/
`cont_animdirs`/`cont_animshots` (container contents/behavior), `passcanfire`/
`passpickupdir`/`canfirefrominside`, `load`/`unload`/`unloaddelay`/`unloadhp`,
`pickup`/`transport`/`transferdelay`, `canbetowed`/`canbecrushed`/`canbepara`
(towable / crushable / para-droppable), `soldonarmor`/`twosoldbonus` (tank riders).

## Engineering & support
Build: `build`/`build1..build4`, `anibuildez1`/`anibuildez2` (build trench/sandbag),
`ez1buildcost`/`ez1buildtime`/`ez2buildcost`/`ez2buildtime`, `anibuildpont`/
`pontbuildcost`/`pontbuildtime` (pontoon bridge). Repair infrastructure:
`fixmost`/`fixmostcost`/`anifixmost` (bridge), `fixrail`/`fixrailcost`/`fixrailtime`/
`fixrailradius`/`anifixrail` (railway). Mines: `laymine`/`laymineti me`/`lay_mine`/
`mines`/`mineammo`, `get_mine`/`getminetime` (defuse). Logistics/medical:
`repair`, `heal`/`healdelay`, `give`/`giveunits`, `depot`, `support`/`idsupport`.

## Morale
`moralemax`, `moraleautoincrease`, `moralenoattack` (won't attack below threshold),
`moralerage` (berserk), `moraleresist`, `moralerndmove` (panic wander). Drives
infantry willingness to advance/fire vs. flee.

## Per-unit AI tuning (state-machine timers)
`ai_soldwaitstartattack`, `ai_soldwaitrndmove`, `ai_soldwaittozonemove`,
`ai_soldwaitgoin`/`ai_soldwaitagoin`/`ai_soldwaitnzgoin` (enter house/cover),
`ai_tankwaitstartattack`/`ai_tankwaitrndmove`/`ai_tankwaittozonemove`,
`ai_katyawaitfire`/`ai_katyaminfireunits`/`ai_katyawaitrndmove`/
`ai_katyawaittozonemove`, `ai_planewaittozonemove`, `ai_trainwaitrndmove`,
`ai_domwaitunload`, `ai_waitleavegun`, `delaybeforefight`, `kamikazepctg`,
`hell_maxgointime`/`hell_maxpickuptime`/`helltimefactor`. These are the delays/
thresholds that pace the autonomous combat loop (see `ai_and_scripting.md`).

## Aviation
`plane`/`playerplane`/`spyplane`, `bomber`/`interceptor`/`transport`/`avia`,
`planemove`/`planepatrol`/`planespy`/`planekill`/`planecmd`/`planeform`/
`planechangeaf` (change airfield)/`planedescent`, `altitude`/`dropaltitude`/
`bombaltitude`, `flyspeed`/`bombflyspeed`/`spyflyspeed`/`dropflyspeed`,
`bombaccuracy`/`bombdamage`/`bombdistance`/`bombsnumber`/`bombstartdistance`/
`bombreloadtime`/`bombspeed`, `dropship`, `kamikazepctg`.

## Animation & audio (presentation, but tied to logic timing)
Animation: `animat`/`animation`/`animats`/`aninum`/`anidata`/`anipal`/
`anicolorpal`/`anispeed`/`anireload`/`animaterun`, `permanentani`/
`permanentanimask`, `miniani`, `paraani`/`paraframedelay`, weather `rainani`/
`snowani`/`smokeani`, `onarmoranitime`/`onturretanitime`.
Audio: `idlesound`/`idlesnd_idle`/`idlesnd_move`/`idlesnd_reload`/`idlesnd_buildez`/
`idlesnd_buildpont`/`idlesnd_fixmost`, `diesound`/`fallsound`/`cracksound`/
`bombsound`/`siegesound`/`unsiegesound`/`startburstsound`/`endburstsound`/
`movesmokesound`/`clicksound`/`scream`. Voice lines: `sayack`/`sayselect`/
`sayunderattack`/`sayaviation`/`sayplanes_sel`/`sayplanes_go`/`sayspy_nextwp`/
`saychatmessage`.

## Identity, economy, meta
`name`/`shortname`/`ruinedname`/`icon`/`type`/`level`/`mapack`/`mapacklevel`,
nationality flags (`american`/`british`/`german`/`russian`/`japanese`/`french`(via
`france`)/`italian`/`polish`/… see field list), pricing/score
`pricep`/`priceptypes`/`pricepspeed`/`pricepaspickup`/`havepricep`/`scorevalue`/
`scoretype`/`starscore`/`winscore`/`loosescore`, `fuel`/`engine`/`body`,
`targettype`/`targettypes`/`seltype`/`selunittypes`, `reinfor`/`reinforcement`/
`reinfzone` (reinforcement system).
