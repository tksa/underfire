/**
 * Under Fire — soldier_model.js
 * Shared skinned WW2 soldier model for foot infantry.
 *
 * One GLB (models/soldier.glb) is loaded once and cloned per unit (SkeletonUtils,
 * via Game.loadModel). The source ships a SINGLE baked "Take 001" clip (~46.6s)
 * containing every action; we split it into named sub-clips that the EXISTING
 * animation pipeline already drives:
 *     Game._chooseClip -> picks 'walk'/'run'/'fire_stand'/'idle'/... by name
 *     Game._playClip   -> crossfades, Game._updateModelAnimation advances the mixer
 * Per-faction look is a tint/skin on the body material (German = as-authored).
 *
 * Degradable (golden rule #4): if USE_SOLDIER_MODEL is false or the GLB fails to
 * load, infantry fall back to the procedural mesh (see js/units.js _loadUnitModel).
 */

Game.USE_SOLDIER_MODEL = true;
Game.SOLDIER_MODEL_PATH = 'models/soldier.glb';
Game.SOLDIER_HEIGHT = 1.14;     // target standing height (world units) — tuned
Game.SOLDIER_YAW = -0.502;      // extra yaw (radians) to face the model forward — tuned
Game.SOLDIER_Y_TRIM = 0.05;     // feet-to-ground trim (world units) — tuned
Game.SOLDIER_OFFSET_X = 0.14;   // nudge on top of the (scale-consistent) auto-center — tuned
Game.SOLDIER_OFFSET_Z = 0.04;

// Time ranges [start, end] in seconds within the baked "Take 001" clip. These are
// best-estimate segment boundaries from motion analysis; refine live with
// Game.setSoldierClip('walk', a, b) (no reload needed for newly spawned units).
Game.SOLDIER_CLIP_RANGES = {
    fire_stand: [1.8, 6.4],     // rifle already shouldered + firing (tight loop; avoids the raise/lower at the ends)
    walk:       [10.6, 15.4],   // rifle at port arms, upright stride
    run:        [16.4, 20.0],   // lower/leaning stride
    grenade:    [21.6, 24.2],   // wind up + throw
    idle:       [27.3, 28.1],   // calm standing (near-static -> reads as "at ease")
    fire_prone: [30.0, 33.5],   // lying prone, aiming
    death:      [34.5, 35.7],   // death variant 1 (tune via RAW scrub)
    death2:     [36.0, 37.5],   // death variant 2
    death3:     [38.0, 39.5],   // death variant 3
};
// idle is also the resting fallback for crouch/prone lookups in _chooseClip.

// Build a sub-clip from [a,b] seconds of a source clip, rebased to start at 0.
// Every track is ANCHORED at both window edges with the interpolated value, so a
// bone whose keyframes fall outside the window (a held pose — e.g. prone) still
// holds its correct pose instead of snapping back to bind. (The old version
// dropped such tracks, which left held poses looking like the bind/standing pose.)
Game._subclipByTime = (clip, name, a, b) => {
    const THREE = Game.THREE;
    const tracks = [];
    for (const track of clip.tracks) {
        const times = track.times, values = track.values;
        const stride = values.length / times.length;
        const interp = track.createInterpolant();
        const nt = [], nv = [];
        const sampleAt = (t) => { const v = interp.evaluate(t); nt.push(+(t - a).toFixed(5)); for (let s = 0; s < stride; s++) nv.push(v[s]); };
        sampleAt(a);                                   // anchor start
        for (let i = 0; i < times.length; i++) {       // interior keyframes
            const t = times[i];
            if (t > a + 1e-4 && t < b - 1e-4) { nt.push(+(t - a).toFixed(5)); for (let s = 0; s < stride; s++) nv.push(values[i * stride + s]); }
        }
        sampleAt(b);                                   // anchor end
        tracks.push(new track.constructor(track.name, nt, nv));
    }
    if (!tracks.length) return null;
    return new THREE.AnimationClip(name, Math.max(0.05, b - a), tracks);
};

// Freeze a single pose (nearest keyframe to time t) as a static 2-key clip. Used
// for idle: the source has no dead-still stance, so any range loops with motion +
// a snap. A frozen pose reads as "standing at the ready" with zero jitter.
Game._freezeClip = (clip, name, t) => {
    const THREE = Game.THREE;
    const tracks = [];
    for (const track of clip.tracks) {
        const stride = track.values.length / track.times.length;
        const v = track.createInterpolant().evaluate(t);   // interpolated pose at t (handles slerp)
        const nv = []; for (let s = 0; s < stride; s++) nv.push(v[s]);
        tracks.push(new track.constructor(track.name, [0, 0.5], nv.concat(nv)));
    }
    return new THREE.AnimationClip(name, 0.5, tracks);
};

// The source has no static stance; freeze this moment (port-arms, feet together)
// as the idle pose.
Game.SOLDIER_IDLE_FREEZE = 10.5;

// Posture poses frozen from the timeline (tune the times with RAW scrub). Stand =
// idle, prone = fire_prone (a real clip). Crouch exists in the source; there is NO
// true sit, so 'sit' uses the nearest compact frame until a proper one is chosen.
Game.SOLDIER_CROUCH_FREEZE = 23.4;  // (swapped: these two were reversed)
Game.SOLDIER_SIT_FREEZE = 17.5;
Game.SOLDIER_POSTURE_FADE = 0.35;   // crossfade seconds for posture/clip changes (smoothness)

// Split the single baked clip into the named sub-clips (called from _loadUnitModel).
Game.splitSoldierAnim = (sourceClips) => {
    if (!sourceClips || !sourceClips.length) return sourceClips;
    const src = sourceClips.find(c => c.duration > 20) || sourceClips[0];
    const out = [];
    const R = Game.SOLDIER_CLIP_RANGES;
    for (const name in R) {
        const c = (name === 'idle')
            ? Game._freezeClip(src, 'idle', Game.SOLDIER_IDLE_FREEZE)
            : Game._subclipByTime(src, name, R[name][0], R[name][1]);
        if (c) out.push(c);
    }
    // Posture freezes (stand=idle already; prone=fire_prone already).
    const cr = Game._freezeClip(src, 'crouch', Game.SOLDIER_CROUCH_FREEZE); if (cr) out.push(cr);
    const si = Game._freezeClip(src, 'sit', Game.SOLDIER_SIT_FREEZE); if (si) out.push(si);
    // Keep the full baked timeline as '_raw' so the debug panel can scrub it to
    // find clip boundaries.
    const raw = Game._subclipByTime(src, '_raw', 0, src.duration);
    if (raw) out.push(raw);
    return out.length ? out : sourceClips;
};

// Live-tune a clip range for soldiers spawned AFTER the call (debug helper).
Game.setSoldierClip = (name, a, b) => {
    Game.SOLDIER_CLIP_RANGES[name] = [a, b];
    console.log(`soldier clip ${name} = [${a}, ${b}]`);
};

// Per-faction skin. German keeps the source feldgrau texture; French gets a
// bleu-horizon tint. Materials are cloned per unit so a faction tint never bleeds
// into clones that share the cached source material. (A painted French texture
// can replace the tint later — swap m.map instead of m.color.)
Game.SOLDIER_SKIN = {
    german: 0xffffff,          // as-authored
    french: 0x93a3b4,          // bleu horizon-ish multiply over the base texture
};
Game.applySoldierSkin = (model, team) => {
    const tint = (team in Game.SOLDIER_SKIN) ? Game.SOLDIER_SKIN[team] : 0xffffff;
    model.traverse(o => {
        if (!o.isMesh || !o.material) return;
        const isGun = /lambert1|mauser|k98|k_98/i.test((o.material.name || '') + ' ' + (o.name || ''));
        const mats = (Array.isArray(o.material) ? o.material : [o.material]).map(m => {
            const c = m.clone();          // own material per unit -> tint won't leak to shared source
            if (!isGun && c.color) c.color.setHex(tint);
            return c;
        });
        o.material = Array.isArray(o.material) ? mats : mats[0];
    });
};

// True when a given model path is the shared soldier model.
Game.isSoldierPath = (p) => p === (Game.SOLDIER_MODEL_PATH || 'models/soldier.glb');

// ════════════════════════════════════════════════════════════════════════════
//  LIVE TUNING  (debug panel + copy-config)  — see Game._soldierControlDefs
// ════════════════════════════════════════════════════════════════════════════
// Extra transform offsets applied to every soldier's model wrapper. Yaw fixes
// "faces slightly off the target"; pitch/roll fix lean; height/trim fix scale +
// ground contact. All live-tunable and dumped by the copy-config.
Game.SOLDIER_PITCH = 0.26;          // radians (nose-down +) — tuned
Game.SOLDIER_ROLL  = 0;             // radians — tuned
Game.SOLDIER_WALK_TIMESCALE = 1.0;  // leg-cycle speed multiplier (higher = less foot slide)
Game.SOLDIER_RUN_TIMESCALE  = 1.0;
Game.SOLDIER_MOVE_SYNC = 1;         // 1 = scale walk/run playback by unit speed (kills sliding)
Game.SOLDIER_FORCE_CLIP = '';       // '' = auto (state driven); else force this clip on ALL soldiers
Game.SOLDIER_SCRUB_T = 0;           // when force clip == '_raw', hold the timeline at this second

const _SOLDIER_CLIP_LIST = ['', 'idle', 'walk', 'run', 'fire_stand', 'fire_prone', 'grenade', 'death', '_raw'];

// Apply the transform offsets to one soldier (or all if no unit passed).
Game.applySoldierTransforms = (only) => {
    const list = only ? [only] : Game.units;
    for (const u of list) {
        const ud = u && u.mesh && u.mesh.userData;
        if (!ud || !ud.isSoldier || !ud.modelWrapper) continue;
        const w = ud.modelWrapper;
        w.rotation.order = 'YXZ';
        w.rotation.y = (ud.soldierBaseYaw || 0) + (Game.SOLDIER_YAW || 0);
        w.rotation.x = (Game.SOLDIER_PITCH || 0);
        w.rotation.z = (Game.SOLDIER_ROLL || 0);
        const m = ud.soldierModel || w.children[0];
        if (m && ud.soldierNativeTall && ud.soldierBaseScale) {
            const s = (Game.SOLDIER_HEIGHT || 2.45) / ud.soldierNativeTall;
            const sr = s / ud.soldierBaseScale;   // scale ratio vs load — keeps everything proportional
            m.scale.set(s, s, s);
            // ground snap + auto-center both scale with the model, so changing the
            // height slider re-centers instead of drifting off the ring. The offset
            // is then a pure, scale-independent nudge on top.
            w.position.y = (ud.soldierBaseY || 0) * sr + (Game.SOLDIER_Y_TRIM || 0);
            m.position.x = (ud.soldierBaseModelX || 0) * sr + (Game.SOLDIER_OFFSET_X || 0);
            m.position.z = (ud.soldierBaseModelZ || 0) * sr + (Game.SOLDIER_OFFSET_Z || 0);
        } else if (m) {
            m.position.x = (ud.soldierBaseModelX || 0) + (Game.SOLDIER_OFFSET_X || 0);
            m.position.z = (ud.soldierBaseModelZ || 0) + (Game.SOLDIER_OFFSET_Z || 0);
        }
        if (Game._soldierFrontArrow) Game._soldierFrontArrow(u);   // keep the front line in sync
    }
};

// Front indicator: a red arrow on the unit's mesh group pointing along the game's
// "forward" (local +Z — where it orients the unit to aim). The model is a child
// that Yaw rotates within the group, so spin Yaw until the soldier's FACE lines up
// with the arrow. In world the arrow points wherever the unit is facing/aiming,
// so "face matches arrow" == "looks at the target".
Game.SOLDIER_SHOW_FRONT = 0;
Game._soldierFrontArrow = (unit) => {
    const THREE = Game.THREE;
    const mesh = unit && unit.mesh; if (!mesh) return;
    const ud = mesh.userData;
    if (Game.SOLDIER_SHOW_FRONT) {
        if (!ud._frontArrow) {
            const h = (Game.SOLDIER_HEIGHT || 2.45) * 0.55;
            const arr = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, h, 0), 3.4, 0xff2a2a, 0.8, 0.5);
            arr.name = 'soldierFront';
            arr.userData.isIndicator = true;       // spared by model-swap cleanup
            if (arr.line && arr.line.material) arr.line.material.depthTest = false;
            if (arr.cone && arr.cone.material) arr.cone.material.depthTest = false;
            arr.renderOrder = 999;
            mesh.add(arr);
            ud._frontArrow = arr;
        }
        ud._frontArrow.visible = true;
    } else if (ud._frontArrow) {
        ud._frontArrow.visible = false;
    }
};
Game.applySoldierFront = () => {
    for (const u of Game.units) {
        const ud = u.mesh && u.mesh.userData;
        if (ud && ud.isSoldier) Game._soldierFrontArrow(u);
    }
    console.log('soldier front line =', Game.SOLDIER_SHOW_FRONT ? 'ON (red arrow = game forward; spin Yaw so the face matches it)' : 'off');
};

// Force a clip on all soldiers ('' = resume auto). '_raw' enters scrub mode.
Game.setSoldierForce = (name) => {
    Game.SOLDIER_FORCE_CLIP = name || '';
    // Do NOT null _activeClip: _chooseClip already re-picks from SOLDIER_FORCE_CLIP
    // every frame, and _playClip needs the current _activeClip to crossFADE from it.
    // Nulling it left the previous action running at full weight, so clips stacked
    // and blended into a frozen/garbled pose (looked like "animations don't play").
    console.log('soldier force clip =', name || '(auto)');
};

// Play a random death variant on a killed soldier once, holding the final frame
// (so the corpse stays collapsed). Called from the dead-unit branch in renderer.js.
Game.playSoldierDeath = (unit) => {
    const ud = unit.mesh && unit.mesh.userData;
    if (!ud || !ud.actions) return;
    const THREE = Game.THREE;
    const opts = ['death', 'death2', 'death3'].filter(n => ud.actions[n]);
    if (!opts.length) return;
    const name = opts[Math.floor(Math.random() * opts.length)];
    const act = ud.actions[name];
    Object.values(ud.actions).forEach(a => { if (a !== act) { a.stop(); a.enabled = false; } });
    act.reset();
    act.setLoop(THREE.LoopOnce, 1);
    act.clampWhenFinished = true;
    act.enabled = true;
    act.setEffectiveWeight(1);
    act.setEffectiveTimeScale(1);
    act.play();
    ud._activeClip = name;
};

// Hold the raw timeline at time t on every soldier (scrub to find ranges).
Game.soldierScrub = (t) => {
    Game.SOLDIER_SCRUB_T = t;
    if (Game.SOLDIER_FORCE_CLIP !== '_raw') return;
    for (const u of Game.units) {
        const ud = u.mesh && u.mesh.userData;
        if (!ud || !ud.isSoldier || !ud.actions || !ud.actions._raw) continue;
        Game._playClip(u, '_raw', 0);
        ud.actions._raw.time = t;
        ud.mixer.update(0);
    }
    console.log('soldier scrub t =', t.toFixed(2));
};

// Re-split the cached source with the current ranges and rebuild every soldier's
// action set live (so edited clip ranges take effect without a reload).
Game.rebuildSoldierClips = () => {
    const src = Game.modelCache && Game.modelCache[Game.SOLDIER_MODEL_PATH || 'models/soldier.glb'];
    if (!src) { console.warn('no cached soldier model yet'); return; }
    const clips = Game.splitSoldierAnim(src.animations || []);
    let n = 0;
    for (const u of Game.units) {
        const ud = u.mesh && u.mesh.userData;
        if (!ud || !ud.isSoldier || !ud.mixer) continue;
        ud.mixer.stopAllAction();
        ud.actions = {};
        ud.clipNames = clips.map(c => c.name);
        clips.forEach(c => { ud.actions[c.name] = ud.mixer.clipAction(c); });
        ud._activeClip = null;
        n++;
    }
    console.log(`rebuilt ${clips.length} clips on ${n} soldiers`);
};

// Per-frame hooks (called from Game._updateModelAnimation for soldier units).
// Returns true if it fully handled animation this frame (raw scrub freeze).
Game._soldierAnimOverride = (unit, dt) => {
    const ud = unit.mesh.userData;
    if (Game.SOLDIER_FORCE_CLIP === '_raw' && ud.actions && ud.actions._raw) {
        Game._playClip(unit, '_raw', 0);
        ud.actions._raw.time = Game.SOLDIER_SCRUB_T;
        ud.mixer.update(0);
        return true;
    }
    return false;
};
// Sync walk/run playback speed to how fast the unit is actually moving.
Game._soldierTimeScale = (unit) => {
    const ud = unit.mesh.userData;
    const clip = ud._activeClip;
    if (clip !== 'walk' && clip !== 'run') return;
    const act = ud.actions[clip];
    if (!act) return;
    const base = clip === 'run' ? (Game.SOLDIER_RUN_TIMESCALE || 1) : (Game.SOLDIER_WALK_TIMESCALE || 1);
    let ts = base;
    if (Game.SOLDIER_MOVE_SYNC) {
        const spd = unit.currentSpeed || unit.speed || 0;
        ts *= Game.clamp(spd / 2.2, 0.35, 2.5);   // 2.2 ~ the clip's authored stride speed
    }
    act.setEffectiveTimeScale(ts);
};

// ── Procedural walk: the baked clip has NO leg stride (legs are static), so when
// a soldier moves we swing the hip/knee bones in a gait cycle ON TOP of whatever
// clip is playing (port-arms upper body + striding legs). Additive over the
// mixer's output each frame, blended in/out by movement. Axis is tunable because
// the swing axis depends on the rig's bone orientation.
Game.SOLDIER_PROC_GAIT = 1;
Game.SOLDIER_GAIT_AMP  = -0.76; // hip swing amplitude (radians; sign flips swing direction) — tuned
Game.SOLDIER_GAIT_FREQ = 1.4;   // cadence (scaled by speed, clamped)
Game.SOLDIER_GAIT_KNEE = 1.14;  // knee flexion during swing (sign flips fold direction) — tuned
Game.SOLDIER_GAIT_AXIS = 'x';   // 'x' | 'y' | 'z' — swing axis (depends on the rig)
Game.SOLDIER_RUN_LEAN  = 0.35;  // torso forward pitch at full speed (radians; sign = lean direction)
const _GAIT_AXES = ['x', 'y', 'z'];

Game._soldierLegBones = (unit) => {
    const ud = unit.mesh.userData;
    if (ud._legBones !== undefined) return ud._legBones;
    const m = ud.soldierModel;
    if (!m) { ud._legBones = null; return null; }
    const find = (n) => { let r = null; m.traverse(o => { if (o.name === n) r = o; }); return r; };
    ud._legBones = { hipL: find('hip_left_06'), kneeL: find('knee_left_07'), hipR: find('hip_right_02'), kneeR: find('knee_right_03'), torso: find('torso_010') };
    return ud._legBones;
};

// Called AFTER mixer.update so it drives the legs over the clip's (static) legs.
// Proper FK gait: hip swings sinusoidally; the knee flexes once per stride, phase-
// led so it bends as the foot lifts/swings and straightens at contact; left/right
// are 180° apart; cadence scales with speed but is CLAMPED so fast movement doesn't
// make the legs flail. Angles are absolute from the captured bind pose (not added
// to the clip's already-bent legs), blended in/out by movement.
Game._soldierProceduralLegs = (unit, dt) => {
    if (!Game.SOLDIER_PROC_GAIT) return;
    const ud = unit.mesh.userData;
    const b = Game._soldierLegBones(unit);
    const rest = ud.soldierLegRest;
    if (!b || !b.hipL || !rest) return;
    const spd = unit.currentSpeed || 0;
    // Debug: a forced walk/run clip strides in place even when the unit is parked.
    const forcedLoco = Game.SOLDIER_FORCE_CLIP === 'walk' || Game.SOLDIER_FORCE_CLIP === 'run';
    const moving = forcedLoco || (!!unit.moving && spd > 0.05);
    ud._gaitBlend = Game.lerp(ud._gaitBlend || 0, moving ? 1 : 0, Math.min(1, dt * 8));
    const bl = ud._gaitBlend;
    if (bl < 0.02) return;                                   // idle: clip owns the legs
    // cadence tracks speed but clamped to a sane band (no flailing at a run)
    const sf = Game.clamp(spd / 2.2, 0.55, 1.5);
    ud._gaitPhase = (ud._gaitPhase || 0) + dt * (Game.SOLDIER_GAIT_FREQ || 1.6) * Math.PI * 2 * sf;
    const ph = ud._gaitPhase;
    const ax = Game.SOLDIER_GAIT_AXIS || 'x';
    const amp = (Game.SOLDIER_GAIT_AMP || 0.5);
    const knee = (Game.SOLDIER_GAIT_KNEE || 0.7);
    const leg = (hip, kn, hipName, knName, phase) => {
        const hipSwing = amp * Math.sin(phase);
        const kneeBend = knee * Math.max(0, Math.sin(phase + Math.PI * 0.5)); // flex during swing
        if (hip && rest[hipName]) {
            const r = rest[hipName];
            hip.rotation.x = Game.lerp(hip.rotation.x, r.x, bl);
            hip.rotation.y = Game.lerp(hip.rotation.y, r.y, bl);
            hip.rotation.z = Game.lerp(hip.rotation.z, r.z, bl);
            hip.rotation[ax] = r[ax] + hipSwing * bl;
        }
        if (kn && rest[knName]) {
            const r = rest[knName];
            kn.rotation.x = Game.lerp(kn.rotation.x, r.x, bl);
            kn.rotation.y = Game.lerp(kn.rotation.y, r.y, bl);
            kn.rotation.z = Game.lerp(kn.rotation.z, r.z, bl);
            kn.rotation[ax] = r[ax] + kneeBend * bl;
        }
    };
    leg(b.hipL, b.kneeL, 'hip_left_06', 'knee_left_07', ph);
    leg(b.hipR, b.kneeR, 'hip_right_02', 'knee_right_03', ph + Math.PI);

    // Torso lean: the upper body pitches forward with speed (slight at a walk,
    // pronounced at a run), on the same swing axis, from the captured rest pose.
    if (b.torso && rest.torso_010) {
        const r = rest.torso_010;
        const lean = (Game.SOLDIER_RUN_LEAN || 0) * Game.clamp(spd / 3.0, 0, 1) * bl;
        b.torso.rotation.x = Game.lerp(b.torso.rotation.x, r.x, bl);
        b.torso.rotation.y = Game.lerp(b.torso.rotation.y, r.y, bl);
        b.torso.rotation.z = Game.lerp(b.torso.rotation.z, r.z, bl);
        b.torso.rotation[ax] = r[ax] + lean;
    }
};

// Debug-panel controls (merged into the shared panel via _postfxControlDefs).
Game._soldierControlDefs = () => {
    const R = Game.SOLDIER_CLIP_RANGES;
    const range = (name) => ([
        { group: 'Soldier Ranges', key: name + 'A', label: name + ' start (s)', min: 0, max: 46.6, step: 0.05,
          apply: v => { R[name][0] = v; Game.rebuildSoldierClips(); } },
        { group: 'Soldier Ranges', key: name + 'B', label: name + ' end (s)', min: 0, max: 46.6, step: 0.05,
          apply: v => { R[name][1] = v; Game.rebuildSoldierClips(); } },
    ]);
    return [
        { group: 'Soldier Xform', key: 'solYaw', label: 'Yaw (face L/R)', min: -3.1416, max: 3.1416, step: 0.01, apply: v => { Game.SOLDIER_YAW = v; Game.applySoldierTransforms(); } },
        { group: 'Soldier Xform', key: 'solPitch', label: 'Pitch (lean fwd/back)', min: -0.9, max: 0.9, step: 0.01, apply: v => { Game.SOLDIER_PITCH = v; Game.applySoldierTransforms(); } },
        { group: 'Soldier Xform', key: 'solRoll', label: 'Roll (tilt L/R)', min: -0.9, max: 0.9, step: 0.01, apply: v => { Game.SOLDIER_ROLL = v; Game.applySoldierTransforms(); } },
        { group: 'Soldier Xform', key: 'solHeight', label: 'Height (world u)', min: 0.8, max: 3.6, step: 0.02, apply: v => { Game.SOLDIER_HEIGHT = v; Game.applySoldierTransforms(); } },
        { group: 'Soldier Xform', key: 'solYTrim', label: 'Ground Y trim', min: -0.6, max: 0.6, step: 0.01, apply: v => { Game.SOLDIER_Y_TRIM = v; Game.applySoldierTransforms(); } },
        { group: 'Soldier Xform', key: 'solOffX', label: 'Center X (ring)', min: -3, max: 3, step: 0.02, apply: v => { Game.SOLDIER_OFFSET_X = v; Game.applySoldierTransforms(); } },
        { group: 'Soldier Xform', key: 'solOffZ', label: 'Center Z (ring)', min: -3, max: 3, step: 0.02, apply: v => { Game.SOLDIER_OFFSET_Z = v; Game.applySoldierTransforms(); } },
        { group: 'Soldier Xform', key: 'solFront', label: 'Front line (0/1)', min: 0, max: 1, step: 1, apply: v => { Game.SOLDIER_SHOW_FRONT = v; Game.applySoldierFront(); } },

        { group: 'Soldier Anim', key: 'solForce', label: '0auto 1idle 2walk 3run 4fireS 5fireP 6nade 7die 8RAW', min: 0, max: 8, step: 1, apply: v => Game.setSoldierForce(_SOLDIER_CLIP_LIST[v] || '') },
        { group: 'Soldier Anim', key: 'solScrub', label: 'RAW scrub (s) [force=8]', min: 0, max: 46.6, step: 0.05, apply: v => Game.soldierScrub(v) },
        { group: 'Soldier Anim', key: 'solMoveSync', label: 'Speed-sync walk (0/1)', min: 0, max: 1, step: 1, apply: v => { Game.SOLDIER_MOVE_SYNC = v; } },
        { group: 'Soldier Anim', key: 'solWalkTS', label: 'Walk speed x', min: 0.2, max: 3, step: 0.05, apply: v => { Game.SOLDIER_WALK_TIMESCALE = v; } },
        { group: 'Soldier Anim', key: 'solRunTS', label: 'Run speed x', min: 0.2, max: 3, step: 0.05, apply: v => { Game.SOLDIER_RUN_TIMESCALE = v; } },
        { group: 'Soldier Anim', key: 'solIdleFreeze', label: 'Idle/Stand freeze @ (s)', min: 0, max: 46.6, step: 0.05, apply: v => { Game.SOLDIER_IDLE_FREEZE = v; Game.rebuildSoldierClips(); } },
        { group: 'Soldier Anim', key: 'solCrouchFreeze', label: 'Crouch freeze @ (s)', min: 0, max: 46.6, step: 0.05, apply: v => { Game.SOLDIER_CROUCH_FREEZE = v; Game.rebuildSoldierClips(); } },
        { group: 'Soldier Anim', key: 'solSitFreeze', label: 'Sit freeze @ (s)', min: 0, max: 46.6, step: 0.05, apply: v => { Game.SOLDIER_SIT_FREEZE = v; Game.rebuildSoldierClips(); } },
        { group: 'Soldier Anim', key: 'solPostureFade', label: 'Transition smoothness (s)', min: 0, max: 1.5, step: 0.05, apply: v => { Game.SOLDIER_POSTURE_FADE = v; } },

        { group: 'Soldier Walk (procedural)', key: 'solGait', label: 'Enable proc walk (0/1)', min: 0, max: 1, step: 1, apply: v => { Game.SOLDIER_PROC_GAIT = v; } },
        { group: 'Soldier Walk (procedural)', key: 'solGaitAxis', label: 'Swing axis 0x 1y 2z', min: 0, max: 2, step: 1, apply: v => { Game.SOLDIER_GAIT_AXIS = _GAIT_AXES[v] || 'x'; } },
        { group: 'Soldier Walk (procedural)', key: 'solGaitAmp', label: 'Hip swing (+/- flips dir)', min: -1.6, max: 1.6, step: 0.02, apply: v => { Game.SOLDIER_GAIT_AMP = v; } },
        { group: 'Soldier Walk (procedural)', key: 'solGaitKnee', label: 'Knee bend (+/- flips fold)', min: -1.6, max: 1.6, step: 0.02, apply: v => { Game.SOLDIER_GAIT_KNEE = v; } },
        { group: 'Soldier Walk (procedural)', key: 'solGaitFreq', label: 'Cadence', min: 0.4, max: 4, step: 0.05, apply: v => { Game.SOLDIER_GAIT_FREQ = v; } },
        { group: 'Soldier Walk (procedural)', key: 'solRunLean', label: 'Run lean fwd (+/-)', min: -1.0, max: 1.0, step: 0.02, apply: v => { Game.SOLDIER_RUN_LEAN = v; } },

        ...range('fire_stand'), ...range('walk'), ...range('run'), ...range('grenade'), ...range('fire_prone'),
        ...range('death'), ...range('death2'), ...range('death3'),
    ];
};

// Clickable animation checklist injected into the debug panel: press a button and
// every soldier plays that clip (radio-style; the active one stays highlighted).
Game.buildSoldierAnimUI = () => {
    const panel = document.getElementById('debugPanel');
    if (!panel || document.getElementById('dbgSoldierAnim')) return;
    const wrap = document.createElement('div');
    wrap.id = 'dbgSoldierAnim';
    const title = document.createElement('div');
    title.className = 'dbg-title';
    title.style.marginTop = '8px';
    title.textContent = 'Soldier Animations (click to play)';
    wrap.appendChild(title);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;margin-top:3px';
    const clips = [['Auto', ''], ['Stand', 'idle'], ['Walk', 'walk'], ['Run', 'run'],
        ['Fire', 'fire_stand'], ['Crouch', 'crouch'], ['Sit', 'sit'], ['Prone', 'fire_prone'],
        ['Grenade', 'grenade'], ['Die1', 'death'], ['Die2', 'death2'], ['Die3', 'death3'], ['RAW', '_raw']];
    const btns = {};
    const setActive = (name) => { for (const k in btns) btns[k].style.background = (k === name) ? '#3a6ea5' : '#2a2e35'; };
    clips.forEach(([label, name]) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'background:#2a2e35;color:#cdd3da;border:1px solid #454b55;border-radius:3px;padding:3px 7px;font-size:11px;cursor:pointer';
        b.addEventListener('click', () => { Game.setSoldierForce(name); setActive(name); });
        btns[name] = b;
        row.appendChild(b);
    });
    setActive('');
    wrap.appendChild(row);
    const hint = document.createElement('div');
    hint.style.cssText = 'color:#7a8a96;font-size:10px;margin-top:3px';
    hint.textContent = 'RAW = scrub the full timeline with the "RAW scrub (s)" slider above.';
    wrap.appendChild(hint);
    panel.appendChild(wrap);
};

// Copy-config output (appended to the debug panel's "Copy values" box).
Game._soldierValuesText = () => {
    const f = (n) => { const t = (+n).toFixed(3).replace(/\.?0+$/, ''); return t === '' || t === '-' ? '0' : t; };
    const R = Game.SOLDIER_CLIP_RANGES;
    const rng = Object.keys(R).map(k => `${k}: [${f(R[k][0])}, ${f(R[k][1])}]`).join(', ');
    return [
        '',
        '// js/soldier_model.js — soldier animation config (paste over the matching lines)',
        `SOLDIER_YAW = ${f(Game.SOLDIER_YAW)}; SOLDIER_PITCH = ${f(Game.SOLDIER_PITCH)}; SOLDIER_ROLL = ${f(Game.SOLDIER_ROLL)};`,
        `SOLDIER_HEIGHT = ${f(Game.SOLDIER_HEIGHT)}; SOLDIER_Y_TRIM = ${f(Game.SOLDIER_Y_TRIM)}; SOLDIER_OFFSET_X = ${f(Game.SOLDIER_OFFSET_X)}; SOLDIER_OFFSET_Z = ${f(Game.SOLDIER_OFFSET_Z)};`,
        `SOLDIER_WALK_TIMESCALE = ${f(Game.SOLDIER_WALK_TIMESCALE)}; SOLDIER_RUN_TIMESCALE = ${f(Game.SOLDIER_RUN_TIMESCALE)}; SOLDIER_MOVE_SYNC = ${Game.SOLDIER_MOVE_SYNC ? 1 : 0};`,
        `SOLDIER_IDLE_FREEZE = ${f(Game.SOLDIER_IDLE_FREEZE)}; SOLDIER_CROUCH_FREEZE = ${f(Game.SOLDIER_CROUCH_FREEZE)}; SOLDIER_SIT_FREEZE = ${f(Game.SOLDIER_SIT_FREEZE)}; SOLDIER_POSTURE_FADE = ${f(Game.SOLDIER_POSTURE_FADE)};`,
        `SOLDIER_PROC_GAIT = ${Game.SOLDIER_PROC_GAIT ? 1 : 0}; SOLDIER_GAIT_AMP = ${f(Game.SOLDIER_GAIT_AMP)}; SOLDIER_GAIT_KNEE = ${f(Game.SOLDIER_GAIT_KNEE)}; SOLDIER_GAIT_FREQ = ${f(Game.SOLDIER_GAIT_FREQ)}; SOLDIER_GAIT_AXIS = '${Game.SOLDIER_GAIT_AXIS}'; SOLDIER_RUN_LEAN = ${f(Game.SOLDIER_RUN_LEAN)};`,
        `SOLDIER_CLIP_RANGES = { ${rng} }`,
    ].join('\n');
};
