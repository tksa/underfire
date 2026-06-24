# Under Fire — Game Vision

Under Fire wants to be the World War II real-time tactics game its fans keep wishing existed: historically grounded, individual-unit, and genuinely tactical — built in the open by the community, with AI-assisted "vibe coding" lowering the barrier so anyone who loves the genre can help shape it.

This document is the north star. It is intentionally about *direction*, not a frozen spec. Everyone is free to improve the game toward it. The detailed unit/weapon design reference lives in [docs/game-vision.txt](docs/game-vision.txt) and [docs/GDD.md](docs/GDD.md). For how the engine itself could evolve (Three.js now → engine ports / custom engine / the neural-renderer ideal), see [docs/ROADMAP.md](docs/ROADMAP.md).

---

## What we are building

A platoon-to-battalion scale RTS where you command real soldiers and vehicles — not faceless blobs — across the battlefields of the Second World War. You feel the difference between a squad pinned in the open and one fighting from a hedgerow, between a flank shot and a frontal one, between a confident advance and a broken retreat.

**Scope: the whole war.** The first playable scenario opens on the 1940 Western Front because that is where development started, but the ambition spans every front and every year of WWII — the deserts, the East, Italy, the Pacific, the late-war push. New theatres, factions, and scenarios are exactly the kind of contribution we want.

---

## Design pillars

1. **Historical plausibility over arcade fantasy.** Weapons, armour, ranges, and doctrine should be recognisable to someone who knows the period. When we simplify, we simplify honestly. Stat changes should cite a source.
2. **The individual soldier matters.** Cover, concealment, stance (stand/crouch/prone/crawl), suppression, morale, and line-of-sight are first-class systems, not decorations.
3. **Tactics beat clicks.** Positioning, combined arms, fire-and-maneuver, and using the terrain should win battles — not actions-per-minute.
4. **Readable at a glance.** A top-down-ish view where you can read the situation: who is suppressed, who is flanking, where the fire is coming from.
5. **Open and low-friction.** No build step, no paywalls, CC0 assets, and a codebase a newcomer with an AI assistant can actually contribute to.

---

## Where it is now (honest status)

Working today: 3D procedural terrain (a French village of patchwork hedgerow fields, a church, windmill, river and bridge), individual-unit control, French vs. German forces, cover/concealment/LOS/suppression/stance, armour penetration with facing and obliquity, squad AI with cover-seeking and fire-and-maneuver, procedural effects and audio, fog of war, and a tactical-pause command layer.

Early / incomplete: only one playable scenario; only the French side is playable (German is AI-only for now); infantry models and animation are basic; balance is unverified; many systems are first-draft.

---

## What would move the needle most

- **A second playable faction** (make German selectable and balanced).
- **More scenarios and maps**, and the scaffolding to define them cleanly.
- **Better unit models and animation**, especially infantry.
- **Deeper, more historical combat and morale systems.**
- **New theatres** beyond 1940.
- **Audio, effects, and UI polish.**

If you want to help, start with [CONTRIBUTING.md](CONTRIBUTING.md). Pick anything above, or surprise us.
