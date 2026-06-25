# Player orders & keyboard controls

Two parts: the **order set** a unit can receive (from the engine's command
vocabulary) and the **keyboard map** (`game/Key.map`, copied verbatim to
`raw/Key.map`).

## Order set (commands a unit can be given)

Sourced from the unit attribute/command fields and the `_commands` modules. Which
orders appear for a given unit depend on its type (e.g. only engineers see
`build`/`fixmost`).

| Order | Field(s) | Effect |
|---|---|---|
| Move | `move`, `movespeed` | path to a point |
| Attack-move | `amove` | advance, engaging enemies en route |
| Stop / Hold | `stop`, `stopped`, `cannotmove` | halt; cancel current order |
| Attack unit | `attack_unit`, `attackunit` | target a specific enemy |
| Attack ground / point | `attack_ground`, `attackpoint`, `canattackpoint` | fire at a location |
| Hold fire / Open fire | `AIF_HOLDFIRE` (AI), key `HF` | toggle weapons free/hold |
| Patrol | `planepatrol`; group `add/shift/clear patrol locations` | move between waypoints |
| Siege / deploy | `siegespeed`, `siegesound`, `unsiegesound` | dig-in / set up a towed gun |
| Build | `build`, `build1..4`, `anibuildez1/2`, pontoon `anibuildpont` | construct trench/sandbag/pontoon |
| Repair infra | `fixmost` (bridge), `fixrail` (rail) | engineer repairs |
| Lay / clear mines | `laymine`/`lay_mine`, `get_mine` | mine warfare |
| Heal / Repair units | `heal`, `repair` (medic / supply truck) | restore HP / fix vehicle |
| Give / transfer | `give`, `giveunits`, key `Give` | hand ammo/units over |
| Load / Unload | `load`, `unload`, `unloaddelay`, `pickup` | enter/exit transport, garrison house |
| Throw (grenade) | `throw` | infantry grenade |
| Rotate | `rotate`, `turnspeed` | face a direction |

## Keyboard map (`game/Key.map`)

### Command panel grid (context-sensitive order buttons)
A 4x3 grid; the order on each button changes with the selected unit.
```
 Q(key_00)  W(key_01)  E(key_02)  R(key_03)
 A(key_10)  S(key_11)  D(key_12)  F(key_13)
 Z(key_20)  X(key_21)  C(key_22)  V(key_23)
```

### Direct order keys
| Key | Id | Meaning |
|---|---|---|
| `G` | `key_HM` | order key *(inferred: hold/move-position)* |
| `T` | `key_HF` | *(inferred: Hold Fire toggle - matches `AIF_HOLDFIRE`)* |
| `B` | `key_SS` | order key *(inferred: siege/setup or special stance)* |
| `BackSpace` | `key_Give` | Give / transfer |

### Control groups & locations
- `0`-`9` -> `key_g0`..`key_g9`: assign/select **control groups**.
- `F1`-`F8` -> `key_l0`..`key_l7`: jump to **location/zone markers**.

### View & global
| Key | Id | Meaning |
|---|---|---|
| `Space` | `key_LA` | *(inferred: center camera on selection / "look at")* |
| `Tab` | `key_NU` | *(inferred: next unit)* |
| `Pause` | `key_Pause` | pause |
| `~` | `key_Info` | info overlay |
| `M` | `key_TMap` | tactical map |
| `CapsLock` | `key_TMapA` | tactical map (toggle/alt) |

### Chat
`Enter` begin/send chat (`key_bCHAT`/`key_sCHAT`), `ESC` cancel (`key_cCHAT`),
`S` all-chat (`key_aCHAT`).

### Menu / mission
| Key | Action |
|---|---|
| `ESC` | menu (`key_MENU`) |
| `F9` | briefing (`key_BRIEF`) |
| `F10` | quit (`key_QUIT`) |
| `F11` | save (`key_SAVE`) |
| `F12` | load (`key_LOAD`) |

In-menu letter shortcuts (`key_mn_*`): `S` save, `L` load, `O` sound, `G` graphics,
`P` speed, `J` objectives, `R` restart, `Q` quit, `D` delete, `W` exit to OS,
`M` exit to menu, `Enter` OK, `ESC` cancel.
