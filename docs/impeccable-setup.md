# Studio design skill setup

Media Studio uses the upstream Impeccable skill for meaningful design work.
The tracked `AGENTS.md`, `PRODUCT.md` and `DESIGN.md` provide project routing and
context. The design document describes the incumbent interface; it is not
owner approval of the UI, which remains subject to the owner's recovery brief.

## Reproduce the project-local install

With Node, npm, Git and GitHub CLI available, and a trusted checkout of
`loftwah/woodhouse-new` beside this repository, run from the Studio root:

```sh
node scripts/setup-impeccable.mjs
```

If Woodhouse is elsewhere, pass its absolute checkout path as the first
argument. The script checks the helper against that checkout's locally known
`origin/main`, fetches the exact upstream `skill-v4.9.1` release, verifies the
bundle's Ed25519 signature, digest and size, and invokes the trusted Woodhouse
helper with CLI 4.9.1, skill 4.9.1 and the Codex project provider. It uses an
owned temporary cache and removes it afterward. The helper backs up existing
project configuration under Git metadata and refuses an external skill symlink.
Review a changed Woodhouse helper and refresh its remote ref before trusting a
later version; this check does not fetch or execute moving source.

The installed `.agents/skills/impeccable/` is machine-local and ignored. The
installer may also create a local `.codex/hooks.json`; it does not modify a
global skill. Re-running the script preserves an existing installation and does
not force-overwrite a modified skill. If its files are stale or locally changed,
inspect and reconcile them before updating. Setup output reporting
`LOCAL_FILES_READY_NOT_RUNTIME_VERIFIED` means files are present, not that the
active agent discovered the skill or that a hook fired. Restart the agent and
verify discovery and the applicable hook during real work.

## Recorded verification and limits

On 14 November 2026, official npm reported CLI 4.9.1 and the upstream release
identified skill 4.9.1 and engine 0.1.24. A normal pinned installer initially
resolved the older signed 4.9.0 bundle and installed engine 0.1.23; its own
update check likewise reported 4.9.0 current. The exact 4.9.1 release bundle
was therefore verified against the [upstream pinned signing key](https://github.com/pbakaus/impeccable/blob/1d0d782/scripts/bundle-signing-keys.json)
and installed using the official local-bundle input. Its SHA-256 is
`f0e94487ffcf8e28d0d1cfb47f41918e3748c657f33f0f128ecf0a478ac85942`.
The isolated macOS project checkout then reported skill 4.9.1, engine 0.1.24
and enabled `.agents` hook wiring. Actual hook execution and fresh-session
skill precedence have not been proved by that inspection. The current running
agent may still have loaded an older global skill; installing files does not
change a skill already loaded into a running session. Review upstream versions
again before a later update rather than treating this dated pin as latest.
