# Media Studio

An independent, original image-and-video studio: upload and organise media, make stills, vary a reference, animate a still, reuse recipes, compare results, and publish one piece deliberately. MIT.

Built for [App Composer](https://github.com/loftwah/app-composer) issue [#457](https://github.com/loftwah/app-composer/issues/457). This repository owns its source, D1 metadata, R2 media, provider keys and release.

## What works without a model account

Projects, uploads, thumbnails, the viewer, search and filters, renaming, downloads, deletion, creative references, project export and public pages. Uploads accept JPEG, PNG and WebP up to 32 MB and MP4/WebM up to 64 MB. Reference images for generation are capped at 8 MB.

## Generation

- **Images** — Cloudflare Workers AI on this studio's own account. Studio Draft (SDXL Lightning) supports square, portrait, landscape and wide frames. Studio Detail (FLUX.2 klein) takes one selected still and makes a reference-guided variation.
- **Video** — fal.ai through this studio's own key. Hailuo 2.3 Standard or Kling 2.5 Turbo Pro, image-to-video, 5–10 seconds. The job is asynchronous: submit, poll, copy the finished MP4 into this studio's R2.
- **Recipes** — five original starting points: editorial still, product plate, cinematic still, reference variation and animate a still. Controls state whether they map to a provider field or a prompt instruction.

Every request shows an estimate before submission. The monthly allowance is enforced by one atomic SQL admission across the project. Half-finished saves keep the exact provider bytes and can be retried without another inference call. Ambiguous provider outcomes keep their reservation and are never resubmitted automatically.

## Run locally

```sh
pnpm install
npx wrangler d1 create media-studio   # first time only; update database_id
npx wrangler r2 bucket create media-studio
pnpm migrate:local
printf '%s' 'a-long-owner-passphrase' | npx wrangler secret put OWNER_PASSPHRASE --local
printf '%s' "$(openssl rand -hex 32)" | npx wrangler secret put SESSION_SECRET --local
pnpm dev
```

Optional video on a local or deployed studio: `npx wrangler secret put FAL_KEY`.

Optional public destinations: `PUBLIC_BUILD_URL` ("Build your own Media Studio"), `PUBLIC_STORY_URL` ("See how this was made") and `LAUNCH_KIT_URL` ("Open Launch Kit"). Each is a plain HTTPS installation variable; omit an independent studio's absent destination and the link is not rendered. Invalid, non-HTTPS or credential-bearing values are ignored.

`pnpm check` runs the focused unit and persistence tests. `pnpm deploy` refuses a dirty tree or unpushed main, runs the checks once, deploys, and verifies the live revision.

## Ownership boundaries

- One studio, one owner passphrase, HttpOnly signed session. There is no multi-tenant registration.
- Media bytes live in the studio's R2 bucket; metadata in its D1 database.
- Composer receives a source pin, not credentials. The studio runs after detaching Composer and has no licence callback.
- Deleting media withdraws pages using it. A tombstone prevents a late provider result from restoring deleted media.
- The project export includes project, references, prompts, lineage, costs and publications but never secrets or media bytes. Media downloads are separate; an export is not an R2 backup.

See [the reuse note](docs/darkroom-assessment.md) for the bounded Darkroom decision and [the deployment notes](docs/deployment.md).
