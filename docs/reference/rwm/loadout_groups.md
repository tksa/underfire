# Pre-built loadout / squad groups (LOKA table)

Composite groups the editor/game offers, each defined per nation (the same group
maps to each country's equivalent units). Source: `rwm_lang.sue` / `rwm_desc_common.sue`.
Format: `<nation> <unitid> <count> [+addon count ...]`.

### Truck to tow a gun (2 slots free)
- `russian zis-5 1 +rguner 8`
- `german maultier 1 +dguner 8`
- `american gmc.cckw.353 1 +aguner 8`
- `british bedford 1 +eguner 8`
- `japanese 2598.so-da 2 +jguner 8`

### Jeep with snipers
- `russian gaz.67.jeep 1 +sniper 3`
- `german vwcubel.jeep 1 +sniper 3`
- `american wyllis.mb.jeep 1 +sniper 3`
- `british humber 1 +sniper 3`
- `japanese kurogan 1 +sniper 3`

### Truck with a machinegun
- `russian zis-5 1 +ds39 1 +rguner 1 +ds39 1 +rguner 3`
- `german maultier 1 +mg34 1 +dguner 1 +mg34 1 +dguner 3`
- `american gmc.cckw.353 1 +mg40 1 +aguner 1 +mg40 1 +aguner 3`
- `british bedford 1 +vickers.f 1 +eguner 1 +vickers.f 1 +eguner 3`
- `japanese 2598.so-da 1 +mg34 1 +jguner 1 +mg34 1 +jguner 3`

### Truck with a 160mm mortal
- `russian zis-5 1 160mm.mortar 1 +rguner 4`
- `german maultier 1 160mm.mortar 1 +dguner 4`
- `american gmc.cckw.353 1 160mm.mortar 1 +aguner 4`
- `british bedford 1 160mm.mortar 1 +eguner 4`
- `japanese 2598.so-da 1 160mm.mortar 1 +jguner 4`

### Support (single unit)
- `russian m5 1`
- `german sdkfz.11 1`
- `american m4 1`
- `british morris.c8 1`
- `japanese ss 1`

### Ammo + Medic in truck
- `russian zis-5.med 1 +cmedic 2 +ammo.box 4 +spare.parts 1`
- `german maultier.med 1 +cmedic 2 +ammo.box 4 +spare.parts 1`
- `american gmc.353.med 1 +cmedic 2 +ammo.box 4 +spare.parts 1`
- `british bedford 1 +cmedic 2 +ammo.box 4 +spare.parts 1`
- `japanese type.94 1 +cmedic 3 +ammo.box 4 +spare.parts 1`

### 16 men, running free
- `russian rguner 11 rsmguner 4 rofficer 1`
- `german dguner 11 dsmguner 4 dofficer 1`
- `american aguner 11 asmguner 4 aofficer 1`
- `british eguner 11 esmguner 4 eofficer 1`
- `japanese jguner 11 jsmguner 4 jofficer 1`

### Special force,4 men
- `russian sniper 1 eminer 1 cmedic 1 rofficer 1`
- `german sniper 1 eminer 1 cmedic 1 dofficer 1`
- `american sniper 1 eminer 1 cmedic 1 aofficer 1`
- `british sniper 1 eminer 1 cmedic 1 eofficer 1`
- `japanese sniper 1 eminer 1 cmedic 1 jofficer 1`

### 60 men in trucks
- `russian zis-5 6 +rguner 32 +rsmguner 12 +sniper 2 +eminer 2 +rhmg 4 +rats 2 +rmortar 2 +rofficer 4`
- `german maultier 6 +dguner 32 +dsmguner 12 +sniper 2 +eminer 2 +dhmg 4 +gats 2 +panzerfaust 2 +dofficer 4`
- `american gmc.cckw.353 5 +aguner 30 +asmguner 10 +sniper 2 +eminer 4 +ahmg 4 +bazooka 4 +aofficer 4`
- `british bedford 6 +eguner 32 +esmguner 12 +sniper 2 +eminer 2 +ahmg 4 +piat 4 +eofficer 4`
- `japanese type1.kho-ki 6 2598.so-da 2 +jguner 30 +jsmguner 10 +sniper 2 +eminer 4 +jhmg 4 +jmortar 2 +jats 2 +jofficer 4`

### 60 men running free
- `russian rguner 32 rsmguner 12 sniper 2 eminer 2 rhmg 4 rats 2 rmortar 2 rofficer 4`
- `german dguner 32 dsmguner 12 sniper 2 eminer 2 dhmg 4 gats 2 panzerfaust 2 dofficer 4`
- `american aguner 30 asmguner 10 sniper 2 eminer 4 ahmg 4 bazooka 4 aofficer 4`
- `british eguner 32 esmguner 12 sniper 2 eminer 2 ahmg 4 piat 4 eofficer 4`
- `japanese jguner 30 jsmguner 10 sniper 2 eminer 4 jhmg 4 jmortar 2 jats 2 jofficer 4`

### AT gun
- `russian 53-k 1 +rguner 2`
- `german pak38l-60 1 +dguner 2`
- `american m3a1 1 +aguner 2 +asmguner 1`
- `british m3a1 1 +eguner 2 +esmguner 1`
- `japanese type.01 1 +jguner 2`

### Medium AT gun
- `russian zis-3 1 +rguner 2`
- `german pak40 1 +dguner 2`
- `american 17p 1 +aguner 2`
- `british 17p 1 +eguner 2`
- `japanese 77fieldgun 1 +jguner 2`

### Heavy AT gun/howitzer
- `russian d-1 1 +rguner 2`
- `german feldhaubitze.18 1 +dguner 2 feldhaubitze.18 1 +dguner 2`
- `american 25p 1 +aguner 2 25p 1 +aguner 2`
- `british 25p 1 +eguner 2 25p 1 +eguner 2`
- `japanese 150mm.japanese 1 +jguner 2`

### AT squad - Bazooka or AT rifle
- `russian rats 4`
- `german panzerfaust 2`
- `american bazooka 3`
- `british piat 3`
- `japanese jats 4`

### AT squad (1942-1943)
- `russian zis-5 1 +ammo.box 5 +spare.parts 1 zis-3 1 +rguner 2`
- `german maultier 1 +ammo.box 5 +spare.parts 1 pak40 1 +dguner 2`
- `american gmc.cckw.353 1 +ammo.box 5 +spare.parts 1 +bazooka 2 17p 1 +aguner 2`
- `british bedford 1 +ammo.box 5 +spare.parts 1 17p 1 +eguner 2`
- `japanese 2598.so-da 1 +ammo.box 5 +spare.parts 1 type1.kho-ki 1 +jats 1 77fieldgun 1 +jguner 2`

### Light tank (Pz II class) <not ballanced perfect>
- `russian	t-70 1`
- `german	pzkpfw.ll 1`
- `american stuart 1`
- `british valentine 1`
- `japanese 2597.sinkhoto 1`

### Light tank platoon  (1939-1941)
- `russian	t-26 2 t-70 2`
- `german	pzkpfw.ll 3 pzkpfw.l 1`
- `american stuart 3 chaffee 1`
- `british valentine 2 tetrarch 3`
- `japanese 2597.sinkhoto 4`

### Medium tank ( Pz IV class) <not ballanced perfect>
- `russian t-34 1`
- `german pzkpfw.lv.f 1`
- `american sherman.lll 1`
- `british matilda 1`
- `japanese type1.chi-khe 1`

### Medium tank platoon (1943-1944)
- `russian t-34 2 ot-34 1 t-34-85 2`
- `german pzkpfw.lv.f 2 pzkpfw.lv.j 2 panther 1`
- `american sherman.lll 2 sherman.v 2 wolverine 1`
- `british matilda 3 churchill 2`
- `japanese type1.chi-khe 6`

### Medium tank platoon + AT SPG unit (1943-1944)
- `russian t-34-85 4 su-85 1`
- `german panther 3 stug40g 1`
- `american sherman.v 4 hellcat 1`
- `british comet 3 matilda 1 churchill 1 bishop 1`
- `japanese type3.chi-noo 5 ho-ni.ll 1`

### Heavy tank (Panther class)
- `russian kv 1`
- `german panther 1`
- `american pershing 1`
- `british comet 2`
- `japanese type3.chi-noo 3`

### Heavy tank (Tiger class)
- `russian kv-2 1`
- `german tiger 1`
- `american pershing 1`
- `british comet 2 churchill 1`
- `japanese type3.chi-noo 8`

### Heavy tank (IS-2 class)
- `russian is-2 1`
- `german koenigstiger 1`
- `american pershing 2`
- `british comet 3 bishop 1`
- `japanese type3.chi-noo 15`

### Medium SPG unit (SU-85/Hetzer/Stug III class)
- `russian su-85 1`
- `german stug40g 1`
- `american wolverine 1`
- `british hellcat 1`
- `japanese ho-ni 2`

### Heavy SPG unit (Ferdinand class)
- `russian su-85 2`
- `german ferdinand 1`
- `american wolverine 2`
- `british hellcat 2`
- `japanese ho-ni 4`

### Featured squad
- `russian isu-152 2 is-2 3`
- `german sturmtiger 1 jagdtiger 1 jagdpanther 1 koenigstiger 1`
- `american wolverine 3 sherman.lll 3 sherman.v 3`
- `british comet 5 sherman.lll 3 hellcat 3`
- `japanese type3.chi-noo 4 2597.chi-kha 4 2597.sinkhoto 6 2597.te-ke 6`

### Long range mobile artillery(1941-1945)
- `russian bm-31 2 m5 2 zis-5 1 +ammo.box 4 +spare.parts 2 wmb_leased.jeep 1 +rofficer 1 +rsmguner 3`
- `german nebelwerfer.42 2 sdkfz.11 2 maultier 1 +ammo.box 4 +spare.parts 2 vwcubel.jeep 1 +dofficer 1 +dsmguner 3`
- `american calliope 1 m4 2 gmc.cckw.353 1 +ammo.box 4 +spare.parts 2 wyllis.mb.jeep 1 +aofficer 1 +asmguner 3`
- `british bedford 2 +ammo.box 4 +spare.parts 2 dingo.jeep 1 +eofficer 1 m59 1 +esmguner 2 m59 1 +esmguner 2`
- `japanese kha-to 1 ss 2 2598.so-da 2 +ammo.box 4 +spare.parts 2 kurogan 1 +jofficer 1 +jsmguner 3`

### Anti-Aircraft Squad
- `russian zis-5 1 52-k 1 +rguner 2`
- `german maultier 1 88mmflak 1 +dguner 2`
- `american m16 2`
- `british crus_aa.mkll 2`
- `japanese 2598.so-da 1 type.88 1 +jguner 2`

### Anti-Aircraft Defense
- `russian t-90 2`
- `german sdkfz.7.flak 2`
- `american m16 2`
- `british crus_aa.mkl 2`
- `japanese ki-to 2`

### Crew in truck
- `russian zis-5.med 1 +rtankist 6`
- `german maultier.med 1 +dtankist 6`
- `american gmc.353.med 1 +atankist 6`
- `british bedford 1 +etankist 6`
- `japanese type.94 1 +jtankist 6`

### Pilots in truck
- `russian zis-5.med 1 +rpilot 6`
- `german maultier.med 1 +dpilot 6`
- `american gmc.353.med 1 +apilot 6`
- `british bedford 1 +epilot 6`
- `japanese type.94 1 +jpilot 6`
