/**
 * Under Fire — valor.js
 * VALOR (Visual Adaptive Layered Object Realism) — incremental realism passes
 * layered on top of the existing pmndrs/postprocessing pipeline (engine.js).
 *
 * Stage 1 (this file): a single cheap full-screen "finish" Effect that adds three
 * old-master / atmospheric cues the base pipeline doesn't have:
 *   - Exposure          (global tone scale)
 *   - Aerial perspective (depth-aware distance desaturation + haze/fog tint —
 *                         makes the battlefield feel deep and hides far LOD)
 *   - Film grain / scumble (subtle broken optical texture so surfaces aren't
 *                           clinically clean)
 *
 * Everything is one extra EffectPass (one draw), fully degradable: a master
 * toggle disables the pass, and a setup failure leaves the base pipeline intact.
 * All parameters are live-tunable from the debug panel (backtick `) — the
 * controls are merged into the existing Post-processing section.
 *
 * The camera is orthographic, so the depth-buffer value is already linear across
 * [near, far]; aerial perspective can use it directly as a 0..1 distance.
 *
 * Loaded as a classic script before main.js; wired in from Game.setupPostFX.
 */

// Fragment shader for the pmndrs Effect. With EffectAttribute.DEPTH the entry
// point receives the (linear, for ortho) depth as the third argument.
Game._valorFinishFrag = `
uniform float uExposure;
uniform float uAerial;     // overall aerial-perspective strength (0..1)
uniform float uAerialStart;// depth where haze begins (0..1)
uniform float uAerialEnd;  // depth where haze is full (0..1)
uniform float uDesat;      // far desaturation amount (0..1)
uniform float uTint;       // far fog-colour tint amount (0..1)
uniform vec3  uFogColor;   // haze colour (synced to scene fog / sky)
uniform float uGrain;      // film-grain amount (0..~0.2)
uniform float uTime;       // animates the grain
uniform float uChiaro;     // chiaroscuro local-contrast (unsharp) amount
uniform float uSfumato;    // far edge-softening amount
uniform float uSfumatoStart;// depth where softening begins (0..1)
uniform float uGradeDesat; // global palette desaturation (documentary look)
uniform float uGradeTemp;  // colour temperature (-1 cool .. +1 warm)
uniform float uFoliageSat; // saturation multiplier for green (foliage) hues
uniform float uMetalDesat; // extra desaturation for low-sat (metal/concrete)
uniform float uSkinWarm;   // warmth boost for skin/warm hues

float valorLuma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float valorHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

// HSV helpers (Sam Hocevar, public domain) for the pseudo-semantic grade.
vec3 valorRgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 valorHsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// 5-tap cross blur of the pass input (pmndrs provides inputBuffer + texelSize).
vec3 valorBlur(vec2 uv) {
    vec2 px = texelSize;
    vec3 s = texture2D(inputBuffer, uv).rgb * 0.4;
    s += texture2D(inputBuffer, uv + vec2(px.x, 0.0)).rgb * 0.15;
    s += texture2D(inputBuffer, uv - vec2(px.x, 0.0)).rgb * 0.15;
    s += texture2D(inputBuffer, uv + vec2(0.0, px.y)).rgb * 0.15;
    s += texture2D(inputBuffer, uv - vec2(0.0, px.y)).rgb * 0.15;
    return s;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    vec3 c = inputColor.rgb * uExposure;

    // Shared neighbour blur (reused by chiaroscuro + sfumato), exposure-matched.
    vec3 blur = valorBlur(uv) * uExposure;

    // Chiaroscuro: local-contrast unsharp — crisper forms / value hierarchy.
    if (uChiaro > 0.0) c += (c - blur) * uChiaro;

    // Sfumato: blend toward the blur with distance to soften far low-poly edges.
    if (uSfumato > 0.0) {
        float sf = clamp((depth - uSfumatoStart) / max(1.0 - uSfumatoStart, 1e-4), 0.0, 1.0) * uSfumato;
        c = mix(c, blur, sf);
    }

    // Aerial perspective: contribution rises with distance.
    float d = clamp((depth - uAerialStart) / max(uAerialEnd - uAerialStart, 1e-4), 0.0, 1.0);
    float f = d * uAerial;
    c = mix(c, vec3(valorLuma(c)), f * uDesat);   // lose saturation with distance
    c = mix(c, uFogColor, f * uTint);             // tint toward haze

    // Spatial-aware-ish grade: no material-ID buffer, so the "category" is
    // inferred from hue/saturation and graded per-band (the cheap stand-in for
    // the doc's semantic LUT). Foliage greens, warm skin, and grey metal each
    // respond differently, then a global palette desat + temperature on top.
    {
        vec3 hsv = valorRgb2hsv(c);
        float foliage = smoothstep(0.20, 0.30, hsv.x) * (1.0 - smoothstep(0.45, 0.55, hsv.x));
        hsv.y *= mix(1.0, uFoliageSat, foliage);
        float warm = (1.0 - smoothstep(0.12, 0.18, hsv.x)) * smoothstep(0.0, 0.04, hsv.x);
        hsv.y += uSkinWarm * 0.15 * warm;
        float greyish = 1.0 - smoothstep(0.10, 0.30, hsv.y);   // already low-sat = metal/concrete
        hsv.y *= mix(1.0, 1.0 - uMetalDesat, greyish);
        hsv.y *= (1.0 - uGradeDesat);                          // global archival desat
        c = valorHsv2rgb(clamp(hsv, 0.0, 4.0));
        c.r += uGradeTemp * 0.05;                              // temperature
        c.b -= uGradeTemp * 0.05;
        c = max(c, 0.0);
    }

    // Film grain / scumble (animated, mild).
    if (uGrain > 0.0) {
        float n = valorHash(uv + fract(uTime) * 1.7) - 0.5;
        c += n * uGrain;
    }

    outputColor = vec4(c, inputColor.a);
}
`;

// Build the VALOR Effect instance. Done at call time (not load time) so the
// pmndrs Effect base class and THREE are guaranteed present.
Game._makeValorEffect = () => {
    const PF = Game.PostFX, THREE = Game.THREE;
    class ValorFinishEffect extends PF.Effect {
        constructor() {
            super('ValorFinish', Game._valorFinishFrag, {
                attributes: PF.EffectAttribute.DEPTH,
                blendFunction: PF.BlendFunction.NORMAL,
                uniforms: new Map([
                    ['uExposure', new THREE.Uniform(1.31)],
                    ['uAerial', new THREE.Uniform(0.35)],
                    ['uAerialStart', new THREE.Uniform(0.25)],
                    ['uAerialEnd', new THREE.Uniform(1.0)],
                    ['uDesat', new THREE.Uniform(0.52)],
                    ['uTint', new THREE.Uniform(0.3)],
                    ['uFogColor', new THREE.Uniform(new THREE.Color(0.62, 0.66, 0.72))],
                    ['uGrain', new THREE.Uniform(0.02)],
                    ['uTime', new THREE.Uniform(0.0)],
                    ['uChiaro', new THREE.Uniform(0.12)],
                    ['uSfumato', new THREE.Uniform(0.3)],
                    ['uSfumatoStart', new THREE.Uniform(0.45)],
                    ['uGradeDesat', new THREE.Uniform(0.09)],
                    ['uGradeTemp', new THREE.Uniform(0.02)],
                    ['uFoliageSat', new THREE.Uniform(0.66)],
                    ['uMetalDesat', new THREE.Uniform(0.42)],
                    ['uSkinWarm', new THREE.Uniform(0.5)],
                ]),
            });
        }
    }
    return new ValorFinishEffect();
};

// Default tunables, merged into Game.postfxState so the existing debug UI +
// copy-values box pick them up for free.
Game._valorDefaults = {
    valorEnable: true,
    valorExposure: 1.31,
    valorAerial: 0.35,
    valorAerialStart: 0.25,
    valorAerialEnd: 1.0,
    valorDesat: 0.52,
    valorTint: 0.3,
    valorGrain: 0.02,
    valorChiaro: 0.12,
    valorSfumato: 0.3,
    valorSfumatoStart: 0.45,
    valorGradeDesat: 0.09,
    valorGradeTemp: 0.02,
    valorFoliageSat: 0.66,
    valorMetalDesat: 0.42,
    valorSkinWarm: 0.5,
};

/**
 * Add the VALOR finishing pass to the existing composer. Returns true on success.
 * Safe to fail: on any error the base pipeline is untouched.
 */
Game.setupValor = () => {
    const PF = Game.PostFX;
    if (!PF || !PF.Effect || !PF.EffectAttribute || !Game.composer || !Game.camera) return false;
    try {
        const eff = Game._makeValorEffect();
        const pass = new PF.EffectPass(Game.camera, eff);
        Game.composer.addPass(pass);
        Game.valor = { effect: eff, time: 0 };
        Game.valorPass = pass;

        Game.postfxState = Game.postfxState || {};
        const defaults = Object.assign({}, Game._valorDefaults, Game._valorMatDefaults,
            Game._valorDecalDefaults, Game._valorFoliageDefaults);
        for (const k in defaults) {
            if (Game.postfxState[k] === undefined) Game.postfxState[k] = defaults[k];
        }
        Game._valorMatUniforms();      // ensure shared material uniforms exist
        Game._valorTreeBlurUniform();  // ensure foliage blur uniforms exist
        Game._valorHedgeBlurUniform();
        // Push initial state into the effect + material + decal + foliage settings.
        Game._valorControlDefs()
            .concat(Game._valorMatControlDefs(), Game._valorDecalControlDefs(), Game._valorFoliageControlDefs())
            .forEach(d => { try { d.apply(Game.postfxState[d.key]); } catch (e) { /* ignore */ } });
        return true;
    } catch (e) {
        console.warn('VALOR setup failed, base pipeline kept:', e);
        Game.valor = null;
        Game.valorPass = null;
        return false;
    }
};

// Debug-panel control descriptors (merged into Game._postfxControlDefs()).
Game._valorControlDefs = () => {
    const u = () => (Game.valor && Game.valor.effect && Game.valor.effect.uniforms) || null;
    const set = (name, v) => { const m = u(); if (m) m.get(name).value = v; };
    return [
        { group: 'VALOR', key: 'valorEnable', type: 'bool', label: 'VALOR Enable', apply: v => { if (Game.valorPass) Game.valorPass.enabled = !!v; } },
        { group: 'VALOR', key: 'valorExposure', label: 'Exposure', min: 0.3, max: 2.0, step: 0.01, apply: v => set('uExposure', v) },
        { group: 'VALOR', key: 'valorAerial', label: 'Aerial Strength', min: 0, max: 1, step: 0.01, apply: v => set('uAerial', v) },
        { group: 'VALOR', key: 'valorAerialStart', label: 'Aerial Start', min: 0, max: 1, step: 0.01, apply: v => set('uAerialStart', v) },
        { group: 'VALOR', key: 'valorAerialEnd', label: 'Aerial End', min: 0, max: 1, step: 0.01, apply: v => set('uAerialEnd', v) },
        { group: 'VALOR', key: 'valorDesat', label: 'Far Desaturate', min: 0, max: 1, step: 0.01, apply: v => set('uDesat', v) },
        { group: 'VALOR', key: 'valorTint', label: 'Haze Tint', min: 0, max: 1, step: 0.01, apply: v => set('uTint', v) },
        { group: 'VALOR', key: 'valorGrain', label: 'Film Grain', min: 0, max: 0.2, step: 0.005, apply: v => set('uGrain', v) },
        { group: 'VALOR', key: 'valorChiaro', label: 'Chiaroscuro (local contrast)', min: 0, max: 1, step: 0.01, apply: v => set('uChiaro', v) },
        { group: 'VALOR', key: 'valorSfumato', label: 'Sfumato (far soften)', min: 0, max: 1, step: 0.01, apply: v => set('uSfumato', v) },
        { group: 'VALOR', key: 'valorSfumatoStart', label: 'Sfumato Start', min: 0, max: 1, step: 0.01, apply: v => set('uSfumatoStart', v) },
        { group: 'VALOR Grade', key: 'valorGradeDesat', label: 'Palette Desaturate', min: 0, max: 1, step: 0.01, apply: v => set('uGradeDesat', v) },
        { group: 'VALOR Grade', key: 'valorGradeTemp', label: 'Temperature (cool/warm)', min: -1, max: 1, step: 0.01, apply: v => set('uGradeTemp', v) },
        { group: 'VALOR Grade', key: 'valorFoliageSat', label: 'Foliage Saturation', min: 0, max: 2, step: 0.01, apply: v => set('uFoliageSat', v) },
        { group: 'VALOR Grade', key: 'valorMetalDesat', label: 'Metal Desaturate', min: 0, max: 1, step: 0.01, apply: v => set('uMetalDesat', v) },
        { group: 'VALOR Grade', key: 'valorSkinWarm', label: 'Skin Warmth', min: 0, max: 1, step: 0.01, apply: v => set('uSkinWarm', v) },
    ];
};

// ── Stage 3: semantic material weathering ──────────────────────────────────
// Shared uniforms referenced by every weathered material (Game._addWeathering),
// so one debug slider drives dirt/wear/wetness/snow across the whole army. The
// master uniform scales everything to zero for an instant, recompile-free off.
Game._valorMatDefaults = {
    valorMatEnable: true,
    valorMatDirt: 0.81,
    valorMatWear: 0.56,
    valorMatWet: 0.43,
    valorMatSnow: 0.0,
};

Game._valorMatUniforms = () => {
    if (!Game._valorMatU) {
        const U = Game.THREE.Uniform;
        Game._valorMatU = {
            master: new U(1.0),
            dirt: new U(Game._valorMatDefaults.valorMatDirt),
            wear: new U(Game._valorMatDefaults.valorMatWear),
            wet: new U(Game._valorMatDefaults.valorMatWet),
            snow: new U(Game._valorMatDefaults.valorMatSnow),
        };
    }
    return Game._valorMatU;
};

Game._valorMatControlDefs = () => {
    const u = () => Game._valorMatUniforms();
    return [
        { group: 'VALOR Materials', key: 'valorMatEnable', type: 'bool', label: 'Material Weathering', apply: v => { u().master.value = v ? 1.0 : 0.0; } },
        { group: 'VALOR Materials', key: 'valorMatDirt', label: 'Dirt / Grime', min: 0, max: 1, step: 0.01, apply: v => { u().dirt.value = v; } },
        { group: 'VALOR Materials', key: 'valorMatWear', label: 'Edge Wear', min: 0, max: 1, step: 0.01, apply: v => { u().wear.value = v; } },
        { group: 'VALOR Materials', key: 'valorMatWet', label: 'Wetness', min: 0, max: 1, step: 0.01, apply: v => { u().wet.value = v; } },
        { group: 'VALOR Materials', key: 'valorMatSnow', label: 'Snow', min: 0, max: 1, step: 0.01, apply: v => { u().snow.value = v; } },
    ];
};

// ── Stage 5: persistent scorch decals (battlefield scars). Settings live on
// Game.scorchCfg (defined in renderer.js); these sliders drive it.
Game._valorDecalDefaults = {
    valorScorchEnable: true,
    valorScorchOpacity: 0.5,
    valorScorchMax: 140,
};

Game._valorDecalControlDefs = () => {
    const cfg = () => (Game.scorchCfg = Game.scorchCfg || { enable: true, opacity: 0.5, max: 140 });
    return [
        { group: 'VALOR Decals', key: 'valorScorchEnable', type: 'bool', label: 'Scorch Marks', apply: v => { cfg().enable = !!v; } },
        { group: 'VALOR Decals', key: 'valorScorchOpacity', label: 'Scorch Opacity', min: 0, max: 1, step: 0.01, apply: v => { cfg().opacity = v; } },
        { group: 'VALOR Decals', key: 'valorScorchMax', label: 'Scorch Max Count', min: 0, max: 400, step: 10, apply: v => { cfg().max = Math.round(v); } },
    ];
};

// ── Foliage: tunable tree/leaf blur. Shared uniform so the slider softens all
// leaf cards at once (the foliage material injects it in _attachFoliageWind).
Game._valorFoliageDefaults = { valorTreeBlur: 0.62, valorHedgeBlur: 0.3, valorFoliageCrush: true };
Game._valorTreeBlurUniform = () => {
    if (!Game._treeBlurU) Game._treeBlurU = new Game.THREE.Uniform(Game._valorFoliageDefaults.valorTreeBlur);
    return Game._treeBlurU;
};
Game._valorHedgeBlurUniform = () => {
    if (!Game._hedgeBlurU) Game._hedgeBlurU = new Game.THREE.Uniform(Game._valorFoliageDefaults.valorHedgeBlur);
    return Game._hedgeBlurU;
};

// Soft-blend ("overlay blur"): instead of smearing the texture, feather the
// alpha edge and ease overall opacity so foliage melds into the scene behind it
// rather than reading as a hard cut-out. Trees and hedges pass their OWN softness
// uniform so each tunes separately. Applied to materials set transparent.
Game._valorTreeBlurInject = (shader, uni) => {
    if (!Game.THREE) return;
    shader.uniforms.uTreeBlur = uni || Game._valorTreeBlurUniform();
    if (shader.fragmentShader.indexOf('uniform float uTreeBlur;') >= 0) return; // already injected
    shader.fragmentShader = 'uniform float uTreeBlur;\n' + shader.fragmentShader.replace(
        '#include <alphatest_fragment>',
        `// VALOR soft-blend: widen the alpha falloff and ease opacity with softness
         float tbSoft = clamp(uTreeBlur, 0.0, 1.0);
         diffuseColor.a = smoothstep(0.0, 0.25 + tbSoft * 0.65, diffuseColor.a) * (1.0 - tbSoft * 0.35);
         #include <alphatest_fragment>`
    );
};
Game._valorFoliageControlDefs = () => [
    { group: 'VALOR Foliage', key: 'valorTreeBlur', label: 'Tree Blend (soft edges)', min: 0, max: 1, step: 0.01, apply: v => { Game._valorTreeBlurUniform().value = v; } },
    { group: 'VALOR Foliage', key: 'valorHedgeBlur', label: 'Hedge Blend (soft edges)', min: 0, max: 1, step: 0.01, apply: v => { Game._valorHedgeBlurUniform().value = v; } },
    { group: 'VALOR Foliage', key: 'valorFoliageCrush', type: 'bool', label: 'Tanks Crush Foliage', apply: v => { Game.foliageKDEnabled = !!v; } },
];

// Inject the shared world-space weathering (dirt / edge-wear / wetness / snow)
// into a MeshStandard onBeforeCompile shader. Used by both unit materials
// (_addWeathering) and the terrain material, so one set of sliders weathers the
// whole battlefield. opts.wear=false skips edge-wear (ground doesn't scuff).
Game._valorWeatherInject = (shader, opts = {}) => {
    const vu = Game._valorMatUniforms ? Game._valorMatUniforms() : null;
    if (!vu) return;
    const wear = opts.wear !== false;
    shader.uniforms.uvMaster = vu.master;
    shader.uniforms.uvDirt = vu.dirt;
    shader.uniforms.uvWear = vu.wear;
    shader.uniforms.uvWet = vu.wet;
    shader.uniforms.uvSnow = vu.snow;

    if (shader.vertexShader.indexOf('vValorWP') < 0) {
        shader.vertexShader = 'varying vec3 vValorWP;\nvarying vec3 vValorWN;\n' + shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
             vValorWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
             vValorWN = normalize(mat3(modelMatrix) * normal);`
        );
    }

    // Smooth (interpolated) value noise — replaces the old floor()-cell hash that
    // produced a hard axis-aligned grid ("tiles") on terrain and units.
    shader.fragmentShader =
        'uniform float uvMaster, uvDirt, uvWear, uvWet, uvSnow;\n' +
        'varying vec3 vValorWP;\nvarying vec3 vValorWN;\n' +
        'float valorVN(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);' +
        ' float a=fract(sin(dot(i,vec2(12.9898,78.233)))*43758.545);' +
        ' float b=fract(sin(dot(i+vec2(1.0,0.0),vec2(12.9898,78.233)))*43758.545);' +
        ' float c=fract(sin(dot(i+vec2(0.0,1.0),vec2(12.9898,78.233)))*43758.545);' +
        ' float d=fract(sin(dot(i+vec2(1.0,1.0),vec2(12.9898,78.233)))*43758.545);' +
        ' return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }\n' +
        shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           float vUp = clamp(vValorWN.y, 0.0, 1.0);
           // smooth multi-octave grime (organic, no cell edges)
           float gn = valorVN(vValorWP.xz * 0.6) * 0.65 + valorVN(vValorWP.xz * 2.3) * 0.35;
           float grime = uvMaster * uvDirt * gn * (0.45 + 0.55 * (1.0 - vUp));
           diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.40, 0.36, 0.30), grime);
           ${wear ? `// edge wear: paint scuff / bare metal on up-facing convex spots
           float wr = uvMaster * uvWear * smoothstep(0.72, 1.0, vUp) * gn;
           diffuseColor.rgb += wr * 0.10;` : ``}
           // snow blanket on top faces
           float sn = uvMaster * uvSnow * smoothstep(0.42, 1.0, vUp);
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.90, 0.92, 0.96), sn);
         }`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         {
           float vUp = clamp(vValorWN.y, 0.0, 1.0);
           float wet = uvMaster * uvWet * (0.35 + 0.65 * vUp);
           roughnessFactor = clamp(roughnessFactor + uvMaster * uvDirt * 0.12 - wet * 0.45, 0.04, 1.0);
         }`
    );
};

// Per-frame: animate the grain and keep the haze tint matched to the scene fog
// (so dawn/dusk/overcast haze stays coherent). Called from the game loop.
Game.updateValor = (dt) => {
    if (!Game.valor || !Game.valorPass || !Game.valorPass.enabled) return;
    const u = Game.valor.effect.uniforms;
    Game.valor.time += (dt || 0.016);
    u.get('uTime').value = Game.valor.time;
    const fog = Game.scene && Game.scene.fog;
    if (fog && fog.color) u.get('uFogColor').value.copy(fog.color);
};
