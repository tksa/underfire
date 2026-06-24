# Under Fire — Development Paths

These are **branches, not a fixed sequence.** Under Fire runs today in Three.js;
from here it could grow in several directions, and they can combine. The
long-term **ideal vision is a neural renderer** layered on top of a simple,
controllable game.

```
                        ┌── Existing engine   (Unity / Unreal / Godot)
   Three.js (now) ──────┼── Custom engine     (C++/Rust + WebGPU)
                        └── Neural renderer   ★ ideal vision
```

## Where we are — Three.js (now)
Pure web, zero install, instant play, easy for AI-assisted contributors. Perfect
for prototyping mechanics, scenarios, and gathering the community. Limits: unit
counts, draw calls, and visual fidelity in a browser.

## Branch A — Existing engine (Unity / Unreal / Godot)
Port the game to a mature engine for better tooling, asset pipelines, physics,
particles, performance, and platform reach. Fastest route to a polished, scalable
product. Cost: leaving the no-build, open-in-browser simplicity behind.

## Branch B — Custom engine (C++/Rust + WebGPU)
A bespoke engine tuned for huge formations (battalion-scale), deterministic
simulation, and exactly the rendering we want. Maximum control and ceiling. Cost:
the most engineering effort by far.

## Branch C — Neural renderer (the ideal vision) ★
Keep a simple, layout-true game render (any of the engines above can produce it)
and add a small conditional **image-to-image** model that turns it into a
realistic WW2 frame in real time. The game stays cheap and controllable; the AI
supplies the realism. This is the long-term goal and already has a working data
exporter and a full pipeline: see
[neural-renderer/README.md](neural-renderer/README.md) and the dated
[model research](neural-renderer/model-research.md).

Crucially, the neural renderer is **engine-agnostic** — it layers on top of
Three.js, a ported engine, or a custom one. So Branch C doesn't compete with A or
B; it rides on whichever foundation we pick.

## How to read this
- No branch is mandated. The community decides, contribution by contribution.
- Three.js is the trunk that keeps the project open and approachable today.
- The neural renderer is the star we're steering toward.
