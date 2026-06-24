# Maintaining, Deploying & Releasing Under Fire

This is the maintainer playbook: how the GitHub project is structured, how contributors get safe preview environments, how changes are reviewed/voted on, how versions are cut, and what you need to host the game on your server.

It is written so a community can run this with light-touch maintenance.

---

## 1. GitHub structure

Use a **GitHub Organization**, not a personal account. It scales to many maintainers and survives any single person leaving.

```
github.com/under-fire/            (the org)
  under                           main game repo (public)
  under-assets         (optional) large/raw art & audio sources (Git LFS)
  .github              (optional) org-wide templates, profile README
```

Suggested teams + permissions inside the org:

| Team | Permission | Who |
|------|-----------|-----|
| `maintainers` | Admin | You + 1–2 trusted long-term contributors |
| `reviewers` | Write | Proven contributors who can approve/merge |
| `contributors` | (none / fork) | Everyone else — they fork and open PRs |

**Branch protection on `main`:**
- Require a pull request before merging.
- Require at least 1 (later 2) approving reviews.
- Require status checks (the CI below) to pass.
- Disallow direct pushes; no force-push.

Add these repo files (templates):
- `.github/PULL_REQUEST_TEMPLATE.md` — "what changed, how I tested, screenshots, source for any stat change".
- `.github/ISSUE_TEMPLATE/` — bug report + feature/scenario proposal.
- `CODEOWNERS` — route reviews (e.g. `js/ai.js @ai-folks`, `js/terrain.js @terrain-folks`).

---

## 2. Branching model

Keep it simple — it is a no-build static site, so this can be lightweight.

- `main` — always deployable. This is what your server serves (production).
- Optionally `develop` or `next` — an integration branch if you want a buffer before production. Most small projects skip this and ship `main`.
- `feat/*`, `fix/*`, `art/*`, `scenario/*` — short-lived branches, one change each, merged via PR and then deleted.

Contributors **fork** the repo, branch in their fork, and open a PR back to `under-fire/under:main`.

---

## 3. Staging / preview environments (per contributor)

You want every contributor to be able to try their change live, in isolation, before it touches production. Because the game is static files, this is cheap and there are three good options:

**Option A — PR Preview Deploys (recommended, easiest).**
Connect the repo to **Cloudflare Pages**, **Netlify**, or **Vercel** (all have free tiers and all serve static sites). Each one automatically builds a unique preview URL for **every pull request** (e.g. `pr-42--under-fire.pages.dev`). The contributor and reviewers click the link, play the change, and only merge once it looks right. Production is the deploy of `main`. This is exactly the "staging env of their own which they then merge to master" model you described, with zero server work.

**Option B — GitHub Pages per fork.**
Each contributor enables GitHub Pages on their own fork; their branch is playable at `their-name.github.io/under`. Simple, but no automatic per-PR URL.

**Option C — Self-hosted preview path.**
On your own server, serve `main` at the root and check out PR branches into `/{staging}/pr-NN/` subfolders (a small script + webhook). More control, more maintenance. Only worth it if you outgrow A.

Start with **Option A**. It gives isolated staging per change and merges to master through normal PRs.

---

## 4. Review & voting

For an open fan project, blend maintainer review with community signal:

- **Lightweight (start here):** PRs need 1 maintainer/reviewer approval + green CI + a working preview link. 👍 reactions on the PR are advisory community signal.
- **Community voting (as you grow):** adopt a simple rule — a PR can merge when it has N approvals from the `reviewers` team, or a maintainer approves. For contentious design/balance/historical questions, open a **GitHub Discussion** and let people vote with reactions; a maintainer makes the final call referencing the vote.
- **RFCs for big changes:** a new faction, a combat-model rewrite, or a new theatre should start as a short proposal issue/Discussion so the community can weigh in before code is written.

Tools that help: GitHub Discussions (voting/ideas), Issues with labels (`good-first-issue`, `needs-source`, `balance`, `art`), and a project board for the roadmap.

---

## 5. Versioning

Use **Semantic-ish Versioning** tied to git tags and GitHub Releases:

```
MAJOR.MINOR.PATCH   e.g. 0.4.2
```

- **0.x** while pre-1.0 (we are here): `MINOR` = notable new content/features, `PATCH` = fixes/tweaks.
- Tag releases on `main`: `git tag v0.4.0 && git push --tags`, then write GitHub Release notes.
- Keep a `CHANGELOG.md` (or auto-generate from PR titles / Conventional Commits).
- Surface the version in-game (a small build string in the menu) so bug reports are pinned to a version. A CI step can stamp the current tag/commit into the page at deploy time.

**Best practices**
- One logical change per PR; write a clear title (Conventional Commits like `feat:`, `fix:`, `art:` make changelogs trivial).
- Never break "it runs with no build step". Keep Three.js pinned to a known CDN version.
- Don't commit huge binaries to the main repo — use Git LFS or the `under-assets` repo for raw sources; ship only optimised assets.

---

## 6. Continuous Integration (optional but recommended)

A tiny GitHub Action keeps `main` healthy:

- **Lint/syntax:** run `node --check` on every `js/*.js` file (catches syntax errors before merge).
- **Smoke test:** boot the game headless with `playwright-core`, start the scenario, assert no console/page errors and that units spawn. (This repo already uses that harness pattern for screenshots.)
- **Link/asset check:** optionally verify referenced assets exist.

Gate merges on this check passing. It is cheap and stops the obvious breakages.

---

## 7. Hosting on your server (requirements)

Under Fire is **100% static files** — there is no backend, no database, no server-side runtime. That makes hosting trivial and cheap.

**Minimum requirements**
- Any web server that serves static files: **nginx**, Apache, Caddy, or a CDN/static host.
- ~Tens of MB of disk (code + current assets; grows with art/audio).
- Outbound access for the **player's browser** to the Three.js CDN (cdnjs) used by the importmap. If you prefer zero external dependencies, vendor Three.js locally into the repo and point the importmap at it — then nothing external is needed.
- **HTTPS** (use a free Let's Encrypt cert). Browsers increasingly require a secure context for some web APIs, and audio/pointer features behave best over HTTPS.

**Recommended server config**
- Serve the repo root as the web root; `index.html` is the entry point.
- Correct MIME types: `.js` as `text/javascript`, `.glb` as `model/gltf-binary`, `.json`, `.ogg`/`.mp3` audio, `.woff2` fonts.
- Enable gzip/brotli compression for `.js`, `.html`, `.json` (big win — the JS is text).
- Cache headers: long cache for hashed/static assets (`models/`, `textures/`, `sounds/`, `fonts/`), short/no-cache for `index.html` so updates appear immediately.
- HTTP/2 or HTTP/3 helps because the game loads many small files.

**Minimal nginx example**
```nginx
server {
    listen 443 ssl http2;
    server_name underfire.example;        # your domain

    root /var/www/under;                   # the repo
    index index.html;

    gzip on;
    gzip_types text/javascript application/javascript text/css application/json image/svg+xml;

    location ~* \.(glb|jpg|png|ogg|mp3|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    location = /index.html {
        add_header Cache-Control "no-cache";
    }
    # SSL certs (Let's Encrypt) ...
}
```

**Deploying updates**
- Easiest: a deploy webhook or GitHub Action that `git pull`s `main` (or `rsync`s the built artifact) to `/var/www/under` on tag/release. Because there is no build, "deploy" is just "put the files there".
- Roll back by checking out the previous tag.
- If you use Cloudflare Pages/Netlify/Vercel for hosting too, production deploys happen automatically on merge to `main` and you may not need your own server at all — your server then becomes optional/custom-domain only.

---

## 8. Domain note

Production points your domain at either your server (Option C / nginx) or your static host (Cloudflare Pages / Netlify / Vercel custom domain). Keep `main` = production; preview URLs are per-PR and disposable.
