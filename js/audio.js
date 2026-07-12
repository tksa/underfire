/**
 * Under Fire — audio.js
 * Lightweight pooled SFX player for battlefield sound.
 * Samples are CC0 from OpenGameArt (see CREDITS.md). Volume attenuates with
 * distance from the camera focus and per-category rate-limits avoid spam.
 */

Game.Audio = (() => {
    // Authentic WW2 SFX extracted from RWM (RWM-Zero public-domain dedication);
    // CC0 OpenGameArt samples kept as variations. See CREDITS.md.
    const FILES = {
        rifle: ['sounds/rwm/rifle1.ogg', 'sounds/shot_02.ogg'],
        mg: ['sounds/rwm/mg_tank_burst.ogg', 'sounds/rwm/mg_heavy.ogg', 'sounds/rwm/smg_burst.ogg'],
        // Tank/AT/field-gun report. RWM: explo_tankdir = tank direct fire, gunshot =
        // field-gun/cannon report. The panzerfaust whoosh + AT-rifle crack lived here
        // before and made tank guns sound wrong, so they're out of the cannon pool.
        cannon: ['sounds/rwm/explo_tankdir.ogg', 'sounds/rwm/gunshot.ogg',
            'sounds/rwm/gunshot.1.ogg', 'sounds/rwm/gunshot.2.ogg'],
        explosion: ['sounds/rwm/smallexplosion.ogg', 'sounds/rwm/defaultexplosion.ogg',
            'sounds/rwm/howitzerexplosion.ogg', 'sounds/bang_05.ogg'],
    };
    // Looping beds: ambience (always-on) + engine layer (tracks moving armor)
    // + fighter prop loop (RWM fly_small — follows the friendly plane overhead)
    const LOOP_FILES = {
        ambWind: 'sounds/rwm/wind_forest_loop.ogg',
        ambBirds: 'sounds/rwm/birds.ogg',
        engine: 'sounds/rwm/diesel_move.ogg',
        fighter: 'sounds/rwm/fly_small.ogg',
    };
    // Unit voice barks (French = f_/player, German = d_/enemy) + ricochet, pooled by file
    // Voice barks: every recorded TAKE of each phrase is listed, and voicePick
    // chooses one at random — one pooled take per phrase made every order sound
    // identical ("says the same thing"). French f_*, German d_*.
    const VOICE_TAKES = {
        f_sold_select: ['f_sold_select', 'f_sold_select.1'],
        f_sold_move: ['f_sold_move', 'f_sold_move.1'],
        f_sold_attack: ['f_sold_attack', 'f_sold_attack.1', 'f_sold_attack.2'],
        f_tank_select: ['f_tank_select', 'f_tank_select.1'],
        f_tank_move: ['f_tank_move', 'f_tank_move.1'],
        f_tank_attack: ['f_tank_attack', 'f_tank_attack.1'],
        f_tank_stop: ['f_tank_stop'],
        d_select: ['d_select', 'd_select.1', 'd_select.2', 'd_select.3', 'd_select.4'],
        d_move: ['d_move', 'd_move.1', 'd_move.2', 'd_move.3'],
        d_attack: ['d_attack', 'd_attack.1', 'd_attack.2', 'd_attack.3'],
        d_tank_select: ['d_tank_select', 'd_tank_select.1'],
        d_tank_move: ['d_tank_move', 'd_tank_move.1', 'd_tank_move.2', 'd_tank_move.3', 'd_tank_move.4'],
        d_tank_attack: ['d_tank_attack', 'd_tank_attack.1'],
    };
    // Reserved Polish acknowledgement slots. Keep these arrays empty until the
    // user-provided recordings exist in sounds/rwm/. An empty slot is a deliberate
    // no-op: Poland must never fall through to French or German dialogue.
    // Add extension-free basenames (for example 'p_sold_move') to enable a slot.
    const VOICE_PL = {
        f_sold_select: [],
        f_sold_move: [],
        f_sold_attack: [],
        f_tank_select: [],
        f_tank_move: [],
        f_tank_attack: [],
        f_tank_stop: [],
    };
    const EXTRA = [
        ...Object.values(VOICE_TAKES).flat(),
        ...Object.values(VOICE_PL).flat(),
        'ricochet', 'ricochet_ground',
        'fly_heavy', 'fly_small',
    ].map(n => 'sounds/rwm/' + n + '.ogg');

    const loops = {};               // key -> HTMLAudioElement (loop=true)
    const loopVol = { ambWind: 0, ambBirds: 0, engine: 0, fighter: 0 };
    let loopsStarted = false;
    let lastVoice = -10;            // gameClock of last voice bark (throttle)

    const POOL = 4;                 // simultaneous voices per sample file
    const MIN_GAP = { rifle: 0.05, mg: 0.08, cannon: 0.12, explosion: 0.07 }; // seconds between plays per category
    const BASE_VOL = { rifle: 0.4, mg: 0.45, cannon: 0.75, explosion: 0.95 };

    const pools = {};               // src -> [HTMLAudioElement]
    const cursor = {};              // src -> round-robin index
    const lastPlay = {};            // category -> gameClock of last play
    let ready = false, enabled = true, master = 0.6;

    const mkPool = (src) => {
        pools[src] = [];
        cursor[src] = 0;
        for (let i = 0; i < POOL; i++) {
            const a = new Audio(src);
            a.preload = 'auto';
            pools[src].push(a);
        }
    };

    const preload = () => {
        for (const cat in FILES) FILES[cat].forEach(mkPool);
        EXTRA.forEach(mkPool);
        for (const key in LOOP_FILES) {
            const a = new Audio(LOOP_FILES[key]);
            a.loop = true;
            a.preload = 'auto';
            a.volume = 0;
            loops[key] = a;
        }
        ready = true;
    };

    // Start the looping beds (needs a user gesture; the Start-Mission click
    // qualifies). The FIGHTER loop is deliberately NOT started here — it only
    // plays while a sortie is airborne (fighterDrone.start/stop), so no plane
    // hum can ever leak in at mission start.
    const startLoops = () => {
        if (loopsStarted || !enabled) return;
        loopsStarted = true;
        for (const key in loops) {
            if (key === 'fighter') continue;
            const p = loops[key].play();
            if (p && p.catch) p.catch(() => { loopsStarted = false; });
        }
    };

    // Volume from distance to camera focus; audible radius grows with zoom-out
    const distVol = (x, z) => {
        if (x == null) return 1;
        const d = Math.hypot(x - Game.cam.x, z - Game.cam.z);
        const r = (Game.cam.zoom || 30) * 3.4;
        return Game.clamp(1 - d / r, 0, 1);
    };

    const play = (cat, x, z) => {
        if (!enabled || !ready) return;
        const t = Game.gameClock || 0;
        if (lastPlay[cat] != null && t - lastPlay[cat] < (MIN_GAP[cat] || 0.05)) return;
        const dv = distVol(x, z);
        if (dv <= 0.03) return;       // inaudible — skip
        lastPlay[cat] = t;
        const list = FILES[cat];
        const src = list[Math.floor(Math.random() * list.length)];
        const pool = pools[src];
        if (!pool) return;
        const a = pool[cursor[src]];
        cursor[src] = (cursor[src] + 1) % pool.length;
        try {
            a.currentTime = 0;
            a.volume = Game.clamp(master * (BASE_VOL[cat] || 0.5) * dv, 0, 1);
            a.playbackRate = 0.9 + Math.random() * 0.2; // pitch variation
            const p = a.play();
            if (p && p.catch) p.catch(() => { });
        } catch (e) { /* ignore */ }
    };

    // Soft synthesized UI click (no sample needed)
    let actx = null;
    const click = () => {
        if (!enabled) return;
        try {
            actx = actx || new (window.AudioContext || window.webkitAudioContext)();
            if (actx.state === 'suspended') actx.resume();
            const o = actx.createOscillator(), g = actx.createGain();
            o.type = 'square';
            o.frequency.value = 520;
            g.gain.value = 0.04 * master;
            o.connect(g); g.connect(actx.destination);
            o.start();
            g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.06);
            o.stop(actx.currentTime + 0.07);
        } catch (e) { /* ignore */ }
    };

    // Synthesized aircraft drone for an inbound air strike (no sample needed).
    // Two detuned sawtooth "engines" with vibrato, pitch rising as it nears, and
    // a swell-then-fade gain so it reads as a flight passing overhead.
    const plane = (dur = 3.4) => {
        if (!enabled) return;
        try {
            actx = actx || new (window.AudioContext || window.webkitAudioContext)();
            if (actx.state === 'suspended') actx.resume();
            const now = actx.currentTime;
            const out = actx.createGain();
            out.gain.setValueAtTime(0.0001, now);
            out.gain.exponentialRampToValueAtTime(0.22 * master, now + dur * 0.45);
            out.gain.exponentialRampToValueAtTime(0.0001, now + dur);
            out.connect(actx.destination);
            [68, 70].forEach((f, i) => {
                const o = actx.createOscillator();
                o.type = 'sawtooth';
                o.frequency.setValueAtTime(f * 0.85, now);
                o.frequency.linearRampToValueAtTime(f * 1.3, now + dur); // approach Doppler rise
                const lfo = actx.createOscillator(), lfoG = actx.createGain();
                lfo.frequency.value = 10 + i * 2.5;   // prop beat
                lfoG.gain.value = 7;
                lfo.connect(lfoG); lfoG.connect(o.frequency);
                o.connect(out);
                o.start(now); o.stop(now + dur);
                lfo.start(now); lfo.stop(now + dur);
            });
        } catch (e) { /* ignore */ }
    };

    // Positional prop-engine loop for a fighter overhead — the real RWM
    // fly_small sample, looped, volume riding distance to the camera with an
    // audible floor (you HEAR the sortie coming from far off). During a crash
    // the loop pitch-dives like a falling plane. start() when the sortie is
    // called, setPos() each frame, stop() when the sky is clear.
    const fdrState = { active: false, x: null, z: null, crash: false };
    const fighterDrone = {
        start() {
            fdrState.active = true;
            fdrState.crash = false;
            fdrState.x = fdrState.z = null;
            if (loops.fighter) {
                // Fade in from TRUE silence at the start of the engine take.
                loopVol.fighter = 0;
                try {
                    loops.fighter.volume = 0;
                    loops.fighter.currentTime = 0;
                    loops.fighter.playbackRate = 1;
                    const p = loops.fighter.play();
                    if (p && p.catch) p.catch(() => { });
                } catch (e) { }
            }
        },
        setPos(x, z) { fdrState.x = x; fdrState.z = z; },
        setCrash(v) { fdrState.crash = !!v; },
        stop() {
            // Fade handled by updateAmbient; once it reaches silence the
            // element is PAUSED outright so nothing lingers.
            fdrState.active = false;
            fdrState.crash = false;
        },
    };

    // Per-frame mix of the looping beds. Ambience is constant; the engine
    // layer follows the loudest moving vehicle near the camera.
    const updateAmbient = (dt) => {
        if (!ready || !loopsStarted) return;
        let engineAct = 0;
        for (const u of Game.units) {
            if (!u.alive || !Game.isTank(u.kind) || (u.currentSpeed || 0) < 0.4) continue;
            engineAct = Math.max(engineAct, distVol(u.x, u.z));
            if (engineAct >= 1) break;
        }
        // Fighter loop: audible floor at distance, swells as the plane nears;
        // a crashing plane's engine pitch-dives.
        let fighterVol = 0;
        if (fdrState.active) {
            const dv = (fdrState.x == null) ? 0.3 : Math.max(0.12, distVol(fdrState.x, fdrState.z));
            fighterVol = 0.8 * dv * master;
            try {
                const pr = loops.fighter.playbackRate || 1;
                const want = fdrState.crash ? 1.45 : 1.0;
                loops.fighter.playbackRate = pr + (want - pr) * Math.min(1, (dt || 0.016) * 2);
            } catch (e) { }
        }
        const target = {
            ambWind: 0.14 * master,
            ambBirds: 0.06 * master,
            engine: engineAct * 0.5 * master,
            fighter: fighterVol,
        };
        const k = Math.min(1, (dt || 0.016) * 3);
        for (const key in loops) {
            loopVol[key] = loopVol[key] + (target[key] - loopVol[key]) * k;
            try { loops[key].volume = Game.clamp(loopVol[key], 0, 1); } catch (e) { }
        }
        // Fighter loop: the exponential fade never quite reaches zero — once
        // the sortie is over and the volume is effectively silent, STOP the
        // element completely (and snap the level to 0 for the next fade-in).
        if (!fdrState.active && loops.fighter && loopVol.fighter < 0.004) {
            loopVol.fighter = 0;
            try {
                if (!loops.fighter.paused) loops.fighter.pause();
                loops.fighter.volume = 0;
                loops.fighter.playbackRate = 1;
            } catch (e) { }
        }
    };

    // Play a specific pooled file by name (used for voice barks + ricochet)
    const playFile = (file, vol, x, z, attenuate) => {
        if (!enabled || !ready) return;
        const src = 'sounds/rwm/' + file + '.ogg';
        const pool = pools[src];
        if (!pool) return;
        const dv = attenuate ? distVol(x, z) : 1;
        if (dv <= 0.03) return;
        const a = pool[cursor[src]];
        cursor[src] = (cursor[src] + 1) % pool.length;
        try {
            a.currentTime = 0;
            a.volume = Game.clamp(master * vol * dv, 0, 1);
            const p = a.play();
            if (p && p.catch) p.catch(() => { });
        } catch (e) { /* ignore */ }
    };

    // Playing as Germany: the f_* command acknowledgements translate to their
    // German (d_*) counterparts here, so every call site stays side-agnostic.
    const VOICE_DE = {
        f_sold_select: 'd_select', f_sold_move: 'd_move', f_sold_attack: 'd_attack',
        f_tank_select: 'd_tank_select', f_tank_move: 'd_tank_move',
        f_tank_attack: 'd_tank_attack', f_tank_stop: 'd_tank_move',
    };

    // Unit voice acknowledgement (command feedback; throttled so it never spams)
    const voice = (file) => {
        const t = Game.gameClock || 0;
        if (t - lastVoice < 0.4) return;
        if (Game.playerTeam === 'polish') {
            const takes = VOICE_PL[file];
            if (!takes || !takes.length) return;
            file = takes[Math.floor(Math.random() * takes.length)];
        } else {
            if (Game.playerTeam === 'german' && VOICE_DE[file]) file = VOICE_DE[file];
            const takes = VOICE_TAKES[file];
            if (takes && takes.length) file = takes[Math.floor(Math.random() * takes.length)];
        }
        lastVoice = t;
        playFile(file, 0.8, 0, 0, false);
    };

    return {
        init() { if (!ready) preload(); startLoops(); },
        rifle: (x, z) => play('rifle', x, z),
        mg: (x, z) => play('mg', x, z),
        cannon: (x, z) => play('cannon', x, z),
        explosion: (x, z) => play('explosion', x, z),
        ricochet: (x, z) => playFile(Math.random() < 0.5 ? 'ricochet' : 'ricochet_ground', 0.5, x, z, true),
        plane,
        // Heavy-bomber flyby for the air strike — the real RWM sample.
        heavyPlane: () => playFile('fly_heavy', 0.75, 0, 0, false),
        fighterDrone,
        voice,
        voiceSlots: { polish: VOICE_PL },
        click,
        updateAmbient,
        setEnabled(v) {
            enabled = v;
            if (!v) { for (const key in loops) { try { loops[key].pause(); } catch (e) { } } loopsStarted = false; }
        },
        setMaster(v) { master = Game.clamp(v, 0, 1); },
        get enabled() { return enabled; },
    };
})();
