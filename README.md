<p align="center">
  <img src="splash.png" alt="Under Fire" width="640">
</p>

<h1 align="center">Under Fire</h1>

<p align="center"><strong>A free, open, community-built World War II real-time tactics game. Built in the browser, with AI.</strong></p>

<p align="center">
  <a href="https://underfire.io">▶ Play</a>
  &nbsp;·&nbsp;
  <a href="https://discord.gg/jmkh3RDkF">💬 Discord</a>
  &nbsp;·&nbsp;
  <a href="CONTRIBUTING.md">Contribute</a>
  &nbsp;·&nbsp;
  <a href="vision.md">Vision</a>
</p>

<p align="center">
  <a href="https://discord.gg/jmkh3RDkF"><img src="https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?logo=discord&logoColor=white" alt="Join our Discord"></a>
</p>

---

Under Fire is a browser-based WW2 RTS in active, early development. It runs today: a 3D, individual-unit tactical battle with cover, suppression, line-of-sight, stance, armour penetration, squad AI, and a procedurally generated French-village battlefield. The bigger goal is a historically faithful platoon-to-battalion wargame spanning the whole of the Second World War — and it is being built in the open, by the community, with AI ("vibe") coding.

> Status: **work in progress.** Expect rough edges and missing pieces. That is the invitation, not the disclaimer.

---

## Play it

No build step. It is plain HTML, CSS, JavaScript and Three.js (loaded from a CDN).

```bash
# from the repo root
python3 -m http.server 8741
# then open http://localhost:8741
```

Any static file server works (`npx serve`, `php -S`, nginx, etc.). Opening `index.html` directly via `file://` may break ES-module and asset loading, so use a server.

### Controls

| Input | Action |
|-------|--------|
| Left click / drag | Select units |
| Right click | Order: **Move** or **Attack-Move** per the stance switch (Orders panel); right-clicking an enemy attacks it |
| Double right-click | **Retreat** — break off and fall back (infantry sprint, tanks reverse) |
| `E` | Toggle Move / Attack-Move stance |
| `F` | Attack ground (suppress a spot) |
| `Ctrl+0–9` / `0–9` | Assign / recall control groups |
| `V` / `H` | Stop / Hold fire |
| `U` / `M` / `K` | Sapper: build sandbags / lay mine / TNT |
| `O` / `L` | Tow a gun / Load–unload troops (vehicles & trucks) |
| `Space` | Tactical pause (issue orders while paused; press again to resume) |
| `C` | Cycle stance (run / walk / crouch / crawl) |
| `WASD` / screen edge | Pan camera · Mouse wheel zoom |

Towed guns (AT guns, heavy MGs) deploy/limber automatically: they set up to fire and pack up when ordered to move.

### Debug panel

Press `` ` `` (backtick) in-game to toggle the **Debug Controls** panel. It has live sliders for:

- **Terrain** — height scale, smoothing, bump/roughness/metalness, texture filter and scale, flat shading (then **Rebuild Terrain**)
- **Lighting / Water / Camera** — sun and ambient, cloud shadows, water level/opacity/roughness, camera tilt and zoom range
- **Tank Model** — pick a model and **Scan Nodes** to inspect its mesh hierarchy
- **Post-processing** — anti-aliasing (SMAA), the render **upscaler**, bloom, tilt-shift depth-of-field, colour grading (hue/saturation, brightness/contrast), vignette, and live **lighting** (sun / ambient / cloud shadows)

Each post-processing control has a slider *and* a typeable number box. Retune the look live, then click **Copy values** to copy the current settings to the clipboard (a `postfx = { … }` block including lighting) so you can drop them into an issue, a PR, or a chat.

---

## Help build it

This project exists to bring WW2 RTS fans into building the game they want. You do **not** need to be a professional engineer — describe what you want, let an AI assistant help you write it, test it, and open a pull request.

- **Start here:** [CONTRIBUTING.md](CONTRIBUTING.md) — how the code is laid out, where to add things, asset rules, and the contribution workflow.
- **The dream:** [vision.md](vision.md) — what we are aiming at and the design pillars.
- **Where it could go:** [docs/ROADMAP.md](docs/ROADMAP.md) — development paths (Three.js now → engine ports / custom engine / the neural-renderer ideal).
- **Maintainers / hosting / releases:** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Good first areas: **models, scenery, textures, effects, sound, mechanics, and historical accuracy.** The systems exist; nearly all of them have room to get better.

## Found a bug? Have feedback?

Please report it — it genuinely helps. The game is early and rough, so bug reports are some of the most valuable contributions you can make.

- **Report a bug or request a feature:** [open an issue](https://github.com/tksa/underfire/issues/new/choose) (there are quick templates for both).
- **Browse known issues first:** [existing issues](https://github.com/tksa/underfire/issues).
- **Prefer to chat?** Drop it in [Discord](https://discord.gg/jmkh3RDkF) and we'll log it.

When reporting a bug, a sentence on what you did, what you expected, and what happened (plus your browser/OS) is plenty. Screenshots or a clip help a lot.

---

## Tech at a glance

- **Three.js** (r0.180, via CDN importmap) for 3D rendering
- **Postprocessing** ([pmndrs/postprocessing](https://github.com/pmndrs/postprocessing), CDN) — bloom, tilt-shift depth-of-field, colour grading, vignette, SMAA, plus an FSR-like render upscaler; all tunable live in the debug panel
- **Procedural trees & hedges** via [EZ-Tree](https://github.com/dgreenheck/ez-tree) (geometry only), rendered with CC0 oak bark + leaf textures
- Vanilla JS — a global `Game` namespace of classic scripts plus one ES-module entry (`js/main.js`)
- **Per-unit logic split into modules** (`js/unit_modules.js`: move/fire/scan/health/morale/deploy/…) behind a thin `updateUnit` orchestrator
- **Data-driven units** — `data/units.csv` is the editable roster (614 units, with per-unit `year` for era gating), merged over the built-in table at boot
- Procedural terrain, meshes, animation, and effects; no asset pipeline required to run
- All bundled art/audio is **CC0 / public-domain** (see [CREDITS.md](CREDITS.md))

## Repository layout

```
index.html        Game shell: menu, HUD, CSS, script/importmap wiring
js/               Game code (see CONTRIBUTING.md for the per-file map)
data/             Editable game data: units.csv (roster), changelog.json
models/           3D models (.glb)
textures/         Textures (textures/oga/ = CC0 OpenGameArt)
sounds/           Audio (sounds/rwm/ = public-domain clips + manifest)
fonts/            UI fonts
maps/             Map data
tools/            Asset/format utilities
docs/             Design notes, deployment guide, deep-dive docs
vision.md         Game vision
CONTRIBUTING.md   Contributor guide
LICENSE.md        Under Fire Community License (free, non-commercial)
CREDITS.md        Asset attributions
```

## License

Under Fire is free to play, study, modify and share for **non-commercial** use. You must credit **Under Fire**, you may not sell it or run ads on it, and you may not spin it off into a separate or commercial product — improvements come back here so everyone benefits. See [LICENSE.md](LICENSE.md) for the exact terms.
