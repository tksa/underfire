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
    const LOOP_FILES = {
        ambWind: 'sounds/rwm/wind_forest_loop.ogg',
        ambBirds: 'sounds/rwm/birds.ogg',
        engine: 'sounds/rwm/diesel_move.ogg',
    };
    // Unit voice barks (French = f_/player, German = d_/enemy) + ricochet, pooled by file
    const EXTRA = [
        'f_sold_select', 'f_tank_select', 'f_sold_move', 'f_tank_move',
        'f_sold_attack', 'f_tank_attack', 'f_tank_stop',
        'd_select', 'd_tank_select', 'd_move', 'd_tank_move', 'd_attack', 'd_tank_attack',
        'ricochet', 'ricochet_ground',
    ].map(n => 'sounds/rwm/' + n + '.ogg');

    const loops = {};               // key -> HTMLAudioElement (loop=true)
    const loopVol = { ambWind: 0, ambBirds: 0, engine: 0 };
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

    // Start the looping beds (needs a user gesture; the Start-Mission click qualifies)
    const startLoops = () => {
        if (loopsStarted || !enabled) return;
        loopsStarted = true;
        for (const key in loops) {
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
        const target = {
            ambWind: 0.14 * master,
            ambBirds: 0.06 * master,
            engine: engineAct * 0.5 * master,
        };
        const k = Math.min(1, (dt || 0.016) * 3);
        for (const key in loops) {
            loopVol[key] = loopVol[key] + (target[key] - loopVol[key]) * k;
            try { loops[key].volume = Game.clamp(loopVol[key], 0, 1); } catch (e) { }
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

    // Unit voice acknowledgement (command feedback; throttled so it never spams)
    const voice = (file) => {
        const t = Game.gameClock || 0;
        if (t - lastVoice < 0.4) return;
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
        voice,
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
