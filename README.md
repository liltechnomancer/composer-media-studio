# Media Studio

An independent, original image, video and sound studio: upload and organise media, make stills, vary a reference, animate a still, generate music and narration, order a storyboard, render a bounded assembly, compare results, and publish one piece deliberately. MIT.

Built for [App Composer](https://github.com/loftwah/app-composer) issue [#457](https://github.com/loftwah/app-composer/issues/457). This repository owns its source, D1 metadata, R2 media, provider keys and release.

## What works without a model account

Projects, uploads, thumbnails, the viewer, search and filters, renaming, downloads, deletion, creative references, project export and public pages. Uploads accept JPEG, PNG and WebP up to 32 MB and MP4/WebM up to 64 MB. Reference images for generation are capped at 8 MB.

## Generation

- **Images** — Cloudflare Workers AI on this studio's own account. Studio Draft (SDXL Lightning) supports square, portrait, landscape and wide frames. Studio Detail (FLUX.2 klein) takes one selected still and makes a reference-guided variation.
- **Video** — fal.ai through this studio's own key. Hailuo 2.3 Standard or Kling 2.5 Turbo Pro, image-to-video, 5–10 seconds. The job is asynchronous: submit, poll, copy the finished MP4 into this studio's R2.
- **Sound** — fal.ai through the same key. Studio Score (`fal-ai/stable-audio`) makes a 30-second instrumental bed; Studio Voice (`fal-ai/elevenlabs/tts/eleven-v3`) narrates text supplied by the owner. Audio is saved as its own asset kind with a real duration, sample rate and channel count read from the bytes, and it can be published or used as a storyboard's bed.
- **Recipes** — five original starting points: editorial still, product plate, cinematic still, reference variation and animate a still. Controls state whether they map to a provider field or a prompt instruction.

## Storyboard and bounded assembly

A composition is an ordered list of two to six saved clips (each at most 10.5 seconds, all of them at most 60 seconds) plus one optional saved audio bed. Saving a composition stores the manifest; rendering it creates one durable job that calls one bounded ffmpeg composition on fal.ai (`fal-ai/ffmpeg-api/compose`) and copies the assembled MP4 into this studio's R2. Editing a storyboard updates it in place and keeps every earlier render attached to it, so the interface can show that a cut has changed since its last render. Rendering again is a separate estimated request. A 9:16 social cut is a second, clearly labelled derivative made from the assembled master.

Studio Score takes a length of 10 to 30 seconds, so a generated bed can be chosen to fit the cut instead of being padded afterwards.

A render needs the provider to read the participating bytes. The studio mints a signed link per asset, valid for 30 minutes, bound to one asset and one project. It exposes no listing, session or provider key, and expires on its own. That read is disclosed in the interface before the render starts.

Every request shows an estimate before submission. The monthly allowance is enforced by one atomic SQL admission across the project. Half-finished saves keep the exact provider bytes and can be retried without another inference call. Ambiguous provider outcomes keep their reservation and are never resubmitted automatically.

## Migrations

`0003_audio_and_assembly.sql` widens the saved media kinds to include audio and adds compositions. SQLite cannot widen a `CHECK` constraint in place, so the two tables that enumerate kinds are rebuilt with every existing row copied; no data is dropped. Apply it with `pnpm migrate:remote` before deploying the worker that needs it.

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
