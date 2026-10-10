/** The replacement infantry rig uses complete, independently authored clips. */
Game.SOLDIER_MODEL_PATH = 'models/infantry/mow-soldier.glb';
Game.soldierModelPath = team => team === 'french' ? 'models/infantry/mow-french.glb'
    : team === 'polish' ? 'models/infantry/mow-polish.glb' : Game.SOLDIER_MODEL_PATH;
Game.isSoldierPath = path => /^models\/infantry\/mow-(soldier|french|polish)\.glb$/.test(path);
Game.SOLDIER_HEIGHT = 1.24;
Game.SOLDIER_YAW = 0;
Game.SOLDIER_PITCH = 0;
Game.SOLDIER_Y_TRIM = 0.035;
Game.SOLDIER_OFFSET_X = 0;
Game.SOLDIER_OFFSET_Z = 0;
Game.SOLDIER_PROC_GAIT = 0;

Game.isMowSoldier = model => !!model?.getObjectByName('mow_infantry');
const _legacySplitSoldier = Game.splitSoldierAnim;
Game.splitSoldierAnim = clips => clips?.some(c => c.name === 'crawl')
    && clips.some(c => c.name === 'aim_stand') ? clips : _legacySplitSoldier(clips);

// A skinned mesh's bind-pose sphere does not enclose running, crawling or death
// poses. Let the existing unit/fog visibility system reject whole units; never
// frustum-cull an animated body against that stale sphere. Attachments are small
// and share this policy, including crew and dismounted cavalry clones.
Game.prepareInfantryVisibility = model => {
    model.traverse(o => {
        if (o.isMesh) o.frustumCulled = false;
    });
};

Game.addFactionHelmet = (model, team) => {
    if (team === 'german' || model.getObjectByName('faction_helmet')) return;
    const T = Game.THREE, head = model.getObjectByName('head');
    if (!head) return;
    const helmet = new T.Group(); helmet.name = 'faction_helmet';
    // GEM head sockets are Z-up, with X along the face.
    helmet.rotation.x = Math.PI / 2; head.add(helmet);
    const material = new T.MeshStandardMaterial({ color: team === 'french' ? 0x62624b : 0x686548, roughness: 0.82, metalness: 0.2 });
    const dome = new T.Mesh(new T.SphereGeometry(0.137, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), material);
    dome.position.y = 0.12; dome.scale.set(1.12, team === 'french' ? 0.82 : 0.95, 0.95); helmet.add(dome);
    const brim = new T.Mesh(new T.SphereGeometry(1, 20, 8), material);
    brim.scale.set(0.175, 0.015, team === 'french' ? 0.153 : 0.158); brim.position.set(0.005, 0.12, 0); helmet.add(brim);
    if (team === 'french') {
        const crest = new T.Mesh(new T.BoxGeometry(0.215, 0.028, 0.018), material);
        crest.position.set(0, 0.228, 0); helmet.add(crest);
    }
};

const _legacyApplySoldierSkin = Game.applySoldierSkin;
Game.applySoldierSkin = (model, team, kind) => {
    if (!Game.isMowSoldier(model)) return _legacyApplySoldierSkin(model, team, kind);
    Game.prepareInfantryVisibility(model);
    Game.addFactionHelmet(model, team);
    const unarmed = kind === 'medic' || kind === 'fieldgun_crew';
    const definition = Game.UNIT_STATS[`${team}_${kind}`];
    const pistol = Game.WEAPONS[definition?.weapon]?.type === 'pistol';
    const weapon = pistol ? (team === 'german' ? 'luger' : team === 'french' ? 'ruby' : 'vis')
        : kind === 'mg34' ? 'mg34' : kind === 'fm24' ? 'fm24' : kind === 'rkm_wz28' ? 'bar'
        : kind === 'at_rifle_wz35' ? 'wz35'
        : ['smg', 'sturmtrupp', 'mp38'].includes(kind) ? (team === 'french' ? 'mas38' : 'smg')
        : team === 'french' ? 'mas36' : 'rifle';
    model.userData.infantryWeapon = unarmed ? null : weapon;
    const tint = team === 'polish' ? 0xb1ad8c : team === 'french' ? 0xb9ad94 : 0xffffff;
    // Role changes load a fresh clone. Detach unused weapon meshes from this
    // figure so scene traversal/hand IK never updates a dozen hidden weapons.
    // Keep the complete source rig, every bone and all clips in modelCache.
    const unused = [];
    model.traverse(o => {
        if (o.userData.equipment && !((o.name === 'equipment_helmet' && team === 'german')
            || (!unarmed && o.name === `equipment_${weapon}`))) unused.push(o);
    });
    unused.forEach(o => o.removeFromParent());
    const materialClones = new Map();
    model.traverse(o => {
        if (!o.isMesh || !o.material) return;
        const materials = (Array.isArray(o.material) ? o.material : [o.material]).map(m => {
            if (materialClones.has(m)) return materialClones.get(m);
            const c = m.clone();
            materialClones.set(m, c);
            c.roughness = m.name === 'mow_uniform' ? 0.9 : 0.65;
            c.metalness = m.name === 'mow_uniform' ? 0 : 0.25;
            if (m.name === 'mow_uniform') c.color.setHex(tint);
            return c;
        });
        o.material = Array.isArray(o.material) ? materials : materials[0];
    });
};

// Role clips retain the shared action names consumed by the renderer. No frame
// windows, synthetic leg swings or clips from the legacy timeline are involved.
Game.prepareInfantryClips = (model, kind) => {
    const clips = Game.splitSoldierAnim(model.animations || []);
    if (!Game.isMowSoldier(model)) return clips;
    const mg = ['mg34', 'fm24', 'rkm_wz28'].includes(kind);
    const unarmed = kind === 'medic';
    const pistol = ['luger', 'ruby', 'vis'].includes(model.userData.infantryWeapon);
    return clips.filter(c => !/^(mg_|unarmed_|pistol_)/.test(c.name)).map(c => {
        const roleClip = clips.find(v => v.name === `${unarmed ? 'unarmed_' : pistol ? 'pistol_' : mg ? 'mg_' : 'rifle_'}${c.name}`);
        if (!roleClip) return c;
        const copy = roleClip.clone(); copy.name = c.name; return copy;
    });
};

const _legacyLegBones = Game._soldierLegBones;
Game._soldierLegBones = unit => {
    const data = unit.mesh?.userData, model = data?.soldierModel;
    if (!Game.isMowSoldier(model)) return _legacyLegBones(unit);
    if (data._legBones) return data._legBones;
    const get = name => model.getObjectByName(name);
    return data._legBones = { hipL: get('foot1l'), kneeL: get('foot2l'),
        hipR: get('foot1r'), kneeR: get('foot2r'), torso: get('ik_updown'),
        shoulderL: get('hand1l'), shoulderR: get('hand1r'), armL: get('hand2l'), armR: get('hand2r') };
};

const _legacyTimeScale = Game._soldierTimeScale;
// The imported body is scaled from metres to the game's smaller figures. Use
// that same scale for the with/without-run hysteresis, as for stride playback.
// Normal foot travel is only ~2 u/s; the old 3.6 threshold was never reached.
Game.soldierRunThreshold = unit => {
    const data = unit.mesh?.userData;
    if (!Game.isMowSoldier(data?.soldierModel)) return data?._runOn ? 2.8 : 3.6;
    return (data._runOn ? 1.65 : 2.15) * Math.abs(data.soldierModel.scale.x);
};

Game._soldierTimeScale = unit => {
    const data = unit.mesh?.userData;
    if (!Game.isMowSoldier(data?.soldierModel)) return _legacyTimeScale(unit);
    const strideSpeed = { walk: 1.15, run: 2.75, crawl: 0.55, crouch_walk: 1.6 }[data._activeClip];
    const action = data.actions?.[data._activeClip];
    if (!strideSpeed || !action) return;
    const speed = unit._dispSpeed ?? unit.currentSpeed ?? 0;
    const scale = data.soldierModel.scale.x;
    action.setEffectiveTimeScale(Game.clamp(speed / (strideSpeed * scale), 0, 3));
};

const _legacyWeaponMotion = Game._soldierWeaponMotion;
Game._soldierWeaponMotion = unit => {
    if (!Game.isMowSoldier(unit.mesh?.userData.soldierModel)) return _legacyWeaponMotion(unit);
    if (!unit.alive || Game.SOLDIER_FORCE_CLIP || unit._lastShotAt == null) return;
    const age = unit._shotAge ?? Game.gameClock - unit._lastShotAt;
    if (age < 0 || age > 0.18) return;
    const torso = Game._soldierLegBones(unit)?.torso;
    if (torso) torso.rotation.z += 0.035 * Math.sin(age / 0.18 * Math.PI) * Math.exp(-age * 8);
};

const _legacyRestoreMotion = Game._restoreSoldierMotion;
const _legacyCaptureMotion = Game._captureSoldierMotion;
Game._restoreSoldierMotion = unit => {
    if (unit.mesh?.userData.isFieldGunCrewman && Game.isMowSoldier(unit.mesh.userData.soldierModel)) return;
    _legacyRestoreMotion(unit);
};
Game._captureSoldierMotion = unit => {
    if (unit.mesh?.userData.isFieldGunCrewman && Game.isMowSoldier(unit.mesh.userData.soldierModel)) return;
    _legacyCaptureMotion(unit);
};
