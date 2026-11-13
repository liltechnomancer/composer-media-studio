# Deployment and ownership

## Production identity

| Item | Value |
| --- | --- |
| Worker | `composer-media-studio` |
| Account | Loftwah `1003dc1d93af0ebea56b2f1252f89627` |
| Public origin | https://media.loftwah.com |
| D1 | `media-studio` (`c3451e4b-48b7-44cd-bf0e-7d953f763df2`) |
| R2 | `media-studio` bound as `MEDIA` |
| Workers AI | binding `AI` |
| Cron | `* * * * *` for job reconciliation |
| Runtime secrets | `OWNER_PASSPHRASE`, `SESSION_SECRET`, `FAL_KEY` |
| Optional public destinations | `PUBLIC_BUILD_URL`, `PUBLIC_STORY_URL`, `LAUNCH_KIT_URL` |
| Source | https://github.com/loftwah/composer-media-studio |

Secrets live only on the Worker and in the owner's ignored local file. The
repository contains no credential, session cookie or provider key.

## First provision

```sh
npx wrangler d1 create media-studio
npx wrangler r2 bucket create media-studio
# put the returned database_id in wrangler.jsonc
npx wrangler d1 migrations apply media-studio --remote
printf '%s' "$OWNER_PASSPHRASE" | npx wrangler secret put OWNER_PASSPHRASE
printf '%s' "$SESSION_SECRET" | npx wrangler secret put SESSION_SECRET
printf '%s' "$FAL_KEY" | npx wrangler secret put FAL_KEY   # optional, video only
pnpm deploy --migrate
```

`pnpm deploy` refuses a dirty tree or unpushed `main`, runs the focused checks
once, deploys with the commit baked in, then reads `/healthz` and `/build.json`
and fails if the live revision is not the released commit.

## Optional public destinations

A published page can offer an owner-configured next step. All three variables
are optional and independent installations may omit every one; the page still
shows its media, download and a secondary **Owner sign-in** link.

| Variable | Destination |
| --- | --- |
| `PUBLIC_BUILD_URL` | **Build your own Media Studio** |
| `PUBLIC_STORY_URL` | **See how this was made** |
| `LAUNCH_KIT_URL` | **Open Launch Kit** in the owner's media detail view |

Set them as ordinary Worker variables, not secrets. Only plain HTTPS URLs
without credentials are accepted; an invalid value is ignored rather than
rendered. No destination is fetched at runtime and no link creates a Composer,
Launch Kit or provider dependency.

## Agent handoff from Composer

Init exports the pinned source, the studio defaults and the creative direction.
The agent creates an owner-controlled repository from that pin, replaces the
operator's account, Worker name, route and storage identifiers with the owner's,
creates the D1/R2 resources and AI binding, applies `migrations/0001.sql`, sets
the owner passphrase and session secret, and deploys through the guarded command.
The owner is asked only for the passphrase/session values (and, if they choose
video, a funded fal key). Composer never receives those values.

## Update path

1. Change and review the studio source.
2. Push the reviewed `main`.
3. Run `pnpm deploy` in the studio repository.
4. Promote the new commit and manifest digest in Composer's
   `config/media-studio-standalone.json` and re-export affected specifications.
5. Keep the previous commit recorded for code rollback. Media and metadata
   restore remain separate operations.

## Data and recovery

- Deleting media is a tombstone plus R2 byte deletion. Publications using it are
  withdrawn. A late provider result cannot recreate the asset.
- A failed save keeps the exact provider bytes under the generation record and
  offers "Retry saving". Retrying does not call the model again.
- The monthly allowance is one atomic D1 update per project and month. Unknown
  outcomes keep their reservation until reconciled.
- The project export contains metadata, prompts, lineage, costs and publications;
  media downloads are separate. An export is not an R2 backup.
