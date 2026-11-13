// MIT. Media Studio Worker: owner studio, public pages and the job engine.

import { checkLoginRate, clearCookie, createSession, readBridgeToken, recordLoginFailure, requireOwner, sessionCookie, verifyPassphrase } from "./lib/auth.mjs";
import {
  advanceGeneration,
  budgetSnapshot,
  cancelGeneration,
  createGeneration,
  dispatchGeneration,
  loadGeneration,
  loadProject,
  pendingGenerations,
  reconcileGeneration,
  saveGeneration,
} from "./lib/jobs.mjs";
import { publicModels } from "./lib/providers.mjs";
import { builtinRecipe, projectRecipes, renderPrompt, builtinRecipes } from "./lib/recipes.mjs";
import { reuseStillFor, sharingDestinations } from "./lib/sharing.mjs";
import { shell, loginPage, publicPage, notFoundPage, helpPage } from "./lib/ui.mjs";
import {
  escapeHtml,
  extensionFor,
  HttpError,
  id,
  imageSize,
  json,
  money,
  now,
  problem,
  safeJson,
  sha256Hex,
  slug,
  sniffMedia,
  text,
  videoInfo,
} from "./lib/util.mjs";

const BUILD = {
  revision: typeof __BUILD_REVISION__ === "string" ? __BUILD_REVISION__ : "dev",
  builtAt: typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : new Date(0).toISOString(),
};

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_VIDEO_BYTES = 64 * 1024 * 1024;

function securityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set(
    "content-security-policy",
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  return new Response(response.body, { status: response.status, headers });
}

function assertSameOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const requestOrigin = new URL(request.url).origin;
  const allowed = new Set([requestOrigin]);
  if (env.PUBLIC_ORIGIN) allowed.add(env.PUBLIC_ORIGIN.replace(/\/$/, ""));
  if (!allowed.has(origin))
    throw new HttpError(403, "This request came from another site", "origin_refused");
}

async function body(request, limit = 64 * 1024) {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json"))
    throw new HttpError(415, "Send JSON for this action", "unsupported_media_type");
  const raw = await request.text();
  if (raw.length > limit) throw new HttpError(413, "That request is too large", "too_large");
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("object required");
    return parsed;
  } catch {
    throw new HttpError(400, "Send a JSON object", "invalid_json");
  }
}

function assetView(asset, extra = {}) {
  return {
    id: asset.id,
    kind: asset.kind,
    title: asset.title,
    caption: asset.caption,
    mime: asset.mime,
    bytes: asset.bytes,
    width: asset.width,
    height: asset.height,
    durationMs: asset.duration_ms,
    sha256: asset.sha256,
    source: asset.source,
    parentAssetId: asset.parent_asset_id,
    generationId: asset.generation_id,
    createdAt: asset.created_at,
    file: `/api/assets/${asset.id}/file`,
    download: `/api/assets/${asset.id}/download`,
    ...extra,
  };
}

function generationView(generation, extra = {}) {
  const request = safeJson(generation.request_json, {});
  return {
    id: generation.id,
    kind: generation.kind,
    status: generation.status,
    model: generation.model,
    recipeId: generation.recipe_id,
    prompt: request.prompt ?? "",
    aspect: request.aspect ?? null,
    durationSeconds: request.durationSeconds ?? null,
    referenceAssetId: request.referenceAssetId ?? null,
    parentAssetId: request.parentAssetId ?? null,
    costEstimateMicro: generation.cost_estimate_micro,
    costObservedMicro: generation.cost_observed_micro,
    error: generation.error_code
      ? { code: generation.error_code, message: generation.error_detail ?? "" }
      : null,
    assetId: generation.output_asset_id,
    createdAt: generation.created_at,
    updatedAt: generation.updated_at,
    completedAt: generation.completed_at,
    ...extra,
  };
}

async function projectSummary(env, project) {
  const counts = await env.DB.prepare(
    "SELECT kind, COUNT(*) AS n FROM assets WHERE project_id=?1 AND deleted_at IS NULL GROUP BY kind",
  )
    .bind(project.id)
    .all();
  const byKind = Object.fromEntries(counts.results.map((row) => [row.kind, row.n]));
  const cover = await env.DB.prepare(
    "SELECT id FROM assets WHERE project_id=?1 AND deleted_at IS NULL AND kind='image' ORDER BY created_at DESC LIMIT 1",
  )
    .bind(project.id)
    .first();
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    creativeDirection: project.creative_direction,
    visibility: project.visibility,
    defaults: safeJson(project.defaults_json, {}),
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    counts: { image: byKind.image ?? 0, video: byKind.video ?? 0 },
    cover: cover ? `/api/assets/${cover.id}/file` : null,
    budget: await budgetSnapshot(env, project.id),
  };
}

async function handleLogin(request, env) {
  assertSameOrigin(request, env);
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  if (request.method === "POST") {
    await checkLoginRate(env, ip);
    const input = await body(request, 4 * 1024);
    const ok = await verifyPassphrase(env, input.passphrase);
    if (!ok) {
      await recordLoginFailure(env, ip);
      throw new HttpError(401, "That passphrase did not match", "unauthorized");
    }
    const token = await createSession(env);
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(token) });
  }
  return new Response(loginPage({ next: "/", revision: BUILD.revision, bridged: Boolean(env.BRIDGE_SECRET) }), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function handleApi(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;

  if (path === "/api/login") return handleLogin(request, env);

  if (path === "/api/logout" && request.method === "POST") {
    assertSameOrigin(request, env);
    return json({ ok: true }, 200, { "set-cookie": clearCookie() });
  }

  if (path === "/api/bridge" && request.method === "POST") {
    const input = await body(request);
    const claim = await readBridgeToken(env, input.token);
    if (!claim) throw new HttpError(401, "This Composer handoff is not valid or has expired", "unauthorized");
    const token = await createSession(env);
    return json({ ok: true, next: "/" }, 200, { "set-cookie": sessionCookie(token) });
  }

  if (path === "/api/session") {
    const { readSession } = await import("./lib/auth.mjs");
    const session = await readSession(env, request);
    return json({ signedIn: Boolean(session) });
  }

  await requireOwner(env, request);
  if (method !== "GET" && method !== "HEAD") assertSameOrigin(request, env);

  if (path === "/api/models" && method === "GET")
    return json({ models: publicModels(), videosConfigured: Boolean(env.FAL_KEY) });

  if (path === "/api/state" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all();
    return json({
      projects: await Promise.all(results.map((project) => projectSummary(env, project))),
      models: publicModels(),
      videosConfigured: Boolean(env.FAL_KEY),
      allowanceDefaultMicro: Number(env.MONTHLY_ALLOWANCE_MICRO) || 5_000_000,
      recipes: builtinRecipes,
      destinations: sharingDestinations(env),
    });
  }

  if (path === "/api/projects" && method === "POST") {
    const input = await body(request);
    const name = text(input.name, 80, "Studio name");
    const creativeDirection = text(input.creativeDirection ?? "", 600, "Creative direction", { required: false });
    const visibility = input.visibility === "unlisted" ? "unlisted" : "private";
    const projectId = id("prj");
    const timestamp = now();
    await env.DB.prepare(
      "INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
    )
      .bind(projectId, name, slug(8), creativeDirection, visibility, JSON.stringify(defaultDefaults()), timestamp, timestamp)
      .run();
    const project = await loadProject(env, projectId);
    return json({ project: await projectSummary(env, project) }, 201);
  }

  const projectMatch = path.match(/^\/api\/projects\/([a-z0-9_]+)(?:\/(.+))?$/);
  if (projectMatch) {
    const [, projectId, rest] = projectMatch;
    const project = await loadProject(env, projectId);

    if (!rest && method === "GET") {
      const assets = await env.DB.prepare("SELECT * FROM assets WHERE project_id=?1 AND deleted_at IS NULL ORDER BY created_at DESC")
        .bind(project.id)
        .all();
      const generations = await env.DB.prepare("SELECT * FROM generations WHERE project_id=?1 ORDER BY created_at DESC LIMIT 40")
        .bind(project.id)
        .all();
      const recipes = await env.DB.prepare("SELECT * FROM recipes WHERE project_id=?1 ORDER BY created_at ASC")
        .bind(project.id)
        .all();
      const publications = await env.DB.prepare("SELECT * FROM publications WHERE project_id=?1 AND revoked_at IS NULL ORDER BY created_at DESC")
        .bind(project.id)
        .all();
      // Reuse resolves from stored relationships and the same-project library.
      // The history list above is bounded for display; read every generation's
      // reference so an older clip can still find its retained still.
      const reuseRows = await env.DB.prepare(
        "SELECT id,output_asset_id,request_json FROM generations WHERE project_id=?1",
      )
        .bind(project.id)
        .all();
      const generationReferences = reuseRows.results.map((row) => ({
        id: row.id,
        assetId: row.output_asset_id,
        referenceAssetId: safeJson(row.request_json, {}).referenceAssetId ?? null,
      }));
      const assetRows = assets.results;
      const reuseById = new Map(
        assetRows.map((asset) => [
          asset.id,
          reuseStillFor({
            asset,
            assets: assetRows,
            generations: generationReferences,
            publications: publications.results,
          }),
        ]),
      );
      return json({
        project: await projectSummary(env, project),
        assets: assetRows.map((asset) =>
          assetView(asset, { reuseStillId: reuseById.get(asset.id)?.id ?? null }),
        ),
        generations: generations.results.map((generation) => generationView(generation)),
        recipes: projectRecipes(project.id, recipes.results),
        publications: publications.results.map((publication) => ({
          id: publication.id,
          slug: publication.slug,
          title: publication.title,
          description: publication.description,
          assetId: publication.asset_id,
          posterAssetId: publication.poster_asset_id,
          path: `/p/${publication.slug}`,
          createdAt: publication.created_at,
        })),
        budget: await budgetSnapshot(env, project.id),
      });
    }

    if (!rest && method === "PATCH") {
      const input = await body(request);
      const name = input.name === undefined ? project.name : text(input.name, 80, "Studio name");
      const direction =
        input.creativeDirection === undefined
          ? project.creative_direction
          : text(input.creativeDirection, 600, "Creative direction", { required: false });
      const visibility = input.visibility === undefined ? project.visibility : input.visibility === "unlisted" ? "unlisted" : "private";
      const references =
        input.references === undefined
          ? safeJson(project.references_json, [])
          : normalizeReferences(input.references);
      const defaults = input.defaults === undefined ? safeJson(project.defaults_json, {}) : input.defaults;
      await env.DB.prepare(
        "UPDATE projects SET name=?2,creative_direction=?3,visibility=?4,defaults_json=?5,references_json=?6,updated_at=?7 WHERE id=?1",
      )
        .bind(project.id, name, direction, visibility, JSON.stringify(defaults), JSON.stringify(references), now())
        .run();
      return json({ project: await projectSummary(env, await loadProject(env, project.id)) });
    }

    if (rest === "assets" && method === "POST")
      return uploadAsset(request, env, project);

    if (rest === "generations" && method === "POST") {
      const input = await body(request);
      const created = await createGeneration(env, project, input);
      if (!created.created) {
        const generation =
          created.generation.status === "admitted"
            ? await dispatchGeneration(env, created.generation)
            : created.generation;
        return json({ generation: generationView(generation), replayed: true, budget: await budgetSnapshot(env, project.id) });
      }
      const generation = await dispatchGeneration(env, created.generation);
      return json(
        {
          generation: generationView(generation),
          budget: await budgetSnapshot(env, project.id),
          estimateMicro: created.generation.cost_estimate_micro,
        },
        201,
      );
    }

    if (rest === "export" && method === "GET") {
      const assets = await env.DB.prepare("SELECT * FROM assets WHERE project_id=?1 ORDER BY created_at ASC").bind(project.id).all();
      const generations = await env.DB.prepare("SELECT * FROM generations WHERE project_id=?1 ORDER BY created_at ASC").bind(project.id).all();
      const recipes = await env.DB.prepare("SELECT * FROM recipes WHERE project_id=?1").bind(project.id).all();
      const publications = await env.DB.prepare("SELECT * FROM publications WHERE project_id=?1").bind(project.id).all();
      const payload = {
        format: "media-studio.export/v1",
        exportedAt: new Date().toISOString(),
        build: BUILD.revision,
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug,
          creativeDirection: project.creative_direction,
          visibility: project.visibility,
          references: safeJson(project.references_json, []),
          defaults: safeJson(project.defaults_json, {}),
          createdAt: project.created_at,
          updatedAt: project.updated_at,
        },
        assets: assets.results.map((asset) => ({
          ...assetView(asset),
          deletedAt: asset.deleted_at,
          r2Key: asset.r2_key,
          downloadPath: `/api/assets/${asset.id}/download`,
        })),
        generations: generations.results.map((generation) => ({
          ...generationView(generation),
          request: safeJson(generation.request_json, {}),
          provider: generation.provider,
          providerRequestId: generation.provider_request_id,
        })),
        recipes: recipes.results.map((recipe) => ({
          id: recipe.id,
          slug: recipe.slug,
          title: recipe.title,
          description: recipe.description,
          kind: recipe.kind,
          promptTemplate: recipe.prompt_template,
          controls: safeJson(recipe.controls_json, []),
          version: recipe.version,
        })),
        publications: publications.results.map((publication) => ({
          id: publication.id,
          slug: publication.slug,
          assetId: publication.asset_id,
          posterAssetId: publication.poster_asset_id,
          title: publication.title,
          description: publication.description,
          createdAt: publication.created_at,
          revokedAt: publication.revoked_at,
        })),
        notes: [
          "Secrets, provider keys and session cookies are never included.",
          "Media bytes are downloaded separately from each asset's download path while it exists.",
          "An export is not a backup of R2: copy the files you need while the studio still serves them.",
        ],
      };
      return new Response(JSON.stringify(payload, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${project.slug}-media-studio-export.json"`,
          "cache-control": "no-store",
        },
      });
    }

    if (rest === "recipes" && method === "POST") {      const input = await body(request);
      const slugValue = text(input.slug ?? "", 60, "Recipe id", { required: false }) || `custom-${Date.now()}`;
      const title = text(input.title, 80, "Recipe title");
      const description = text(input.description ?? "", 240, "Description", { required: false });
      const promptTemplate = text(input.promptTemplate, 1800, "Prompt template");
      const kind = input.kind === "video" ? "video" : "image";
      const recipeId = id("rcp");
      await env.DB.prepare(
        "INSERT INTO recipes(id,project_id,slug,title,description,kind,prompt_template,controls_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
      )
        .bind(recipeId, project.id, slugValue, title, description, kind, promptTemplate, JSON.stringify(input.controls ?? []), now())
        .run();
      return json({ id: recipeId }, 201);
    }
  }

  const assetMatch = path.match(/^\/api\/assets\/([a-z0-9_]+)(?:\/(file|download|publish))?$/);
  if (assetMatch) {
    const [, assetId, action] = assetMatch;
    const asset = await env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind(assetId).first();
    if (!asset) throw new HttpError(404, "Asset not found", "not_found");

    if (!action && method === "GET") return json({ asset: assetView(asset) });

    if (!action && method === "PATCH") {
      if (asset.deleted_at) throw new HttpError(410, "This asset was deleted", "deleted");
      const input = await body(request);
      const title = input.title === undefined ? asset.title : text(input.title, 100, "Title", { required: false });
      const caption = input.caption === undefined ? asset.caption : text(input.caption, 400, "Caption", { required: false });
      await env.DB.prepare("UPDATE assets SET title=?2,caption=?3,updated_at=?4 WHERE id=?1 AND deleted_at IS NULL")
        .bind(asset.id, title, caption, now())
        .run();
      return json({ asset: assetView(await env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind(asset.id).first()) });
    }

    if (!action && method === "DELETE") {
      if (asset.deleted_at) return json({ deleted: true, alreadyDeleted: true });
      await env.DB.prepare(
        "UPDATE assets SET deleted_at=?2,delete_revision=delete_revision+1,updated_at=?2 WHERE id=?1",
      )
        .bind(asset.id, now())
        .run();
      await env.DB.prepare("UPDATE publications SET revoked_at=?2 WHERE asset_id=?1 AND revoked_at IS NULL")
        .bind(asset.id, now())
        .run();
      await env.DB.prepare("UPDATE publications SET revoked_at=?2 WHERE poster_asset_id=?1 AND revoked_at IS NULL")
        .bind(asset.id, now())
        .run();
      await env.MEDIA.delete(asset.r2_key);
      return json({ deleted: true });
    }

    if (action === "file" && (method === "GET" || method === "HEAD")) {
      if (asset.deleted_at) throw new HttpError(410, "This asset was deleted", "deleted");
      const object = await env.MEDIA.get(asset.r2_key);
      if (!object) throw new HttpError(410, "The stored bytes are unavailable", "unavailable");
      return new Response(method === "HEAD" ? null : object.body, {
        headers: {
          "content-type": asset.mime,
          "content-length": String(asset.bytes),
          "cache-control": "private, max-age=300",
          etag: `"${asset.sha256.slice(0, 32)}"`,
        },
      });
    }

    if (action === "download" && method === "GET") {
      if (asset.deleted_at) throw new HttpError(410, "This asset was deleted", "deleted");
      const object = await env.MEDIA.get(asset.r2_key);
      if (!object) throw new HttpError(410, "The stored bytes are unavailable", "unavailable");
      return new Response(object.body, {
        headers: {
          "content-type": asset.mime,
          "content-length": String(asset.bytes),
          "content-disposition": `attachment; filename="media-${asset.id}.${extensionFor(asset.mime)}"`,
          "cache-control": "private, no-store",
        },
      });
    }

    if (action === "publish" && method === "POST") {
      if (asset.deleted_at) throw new HttpError(410, "This asset was deleted", "deleted");
      const input = await body(request);
      const title = text(input.title ?? asset.title, 100, "Public title");
      const description = text(input.description ?? "", 300, "Public description", { required: false });
      let posterAssetId = null;
      if (asset.kind === "video" && input.posterAssetId) {
        const poster = await env.DB.prepare(
          "SELECT id FROM assets WHERE id=?1 AND project_id=?2 AND kind='image' AND deleted_at IS NULL",
        )
          .bind(String(input.posterAssetId), asset.project_id)
          .first();
        posterAssetId = poster?.id ?? null;
      }
      const publicationId = id("pub");
      const publicSlug = slug(12);
      await env.DB.prepare(
        "INSERT INTO publications(id,project_id,asset_id,poster_asset_id,slug,title,description,asset_revision,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
      )
        .bind(publicationId, asset.project_id, asset.id, posterAssetId, publicSlug, title, description, asset.delete_revision, now())
        .run();
      return json({ publication: { id: publicationId, path: `/p/${publicSlug}`, title, description } }, 201);
    }
  }

  const publicationMatch = path.match(/^\/api\/publications\/([a-z0-9_]+)$/);
  if (publicationMatch && method === "PATCH") {
    const input = await body(request);
    if (typeof input.hidden !== "boolean") throw new HttpError(400, "Send hidden: true or false", "invalid");
    const row = await env.DB.prepare("SELECT id FROM publications WHERE id=?1 AND revoked_at IS NULL").bind(publicationMatch[1]).first();
    if (!row) throw new HttpError(404, "Publication not found", "not_found");
    await env.DB.prepare("UPDATE publications SET hidden=?2 WHERE id=?1").bind(row.id, input.hidden ? 1 : 0).run();
    return json({ id: row.id, hidden: input.hidden });
  }
  if (publicationMatch && method === "DELETE") {
    const row = await env.DB.prepare("SELECT id FROM publications WHERE id=?1").bind(publicationMatch[1]).first();
    if (!row) throw new HttpError(404, "Publication not found", "not_found");
    await env.DB.prepare("UPDATE publications SET revoked_at=?2 WHERE id=?1 AND revoked_at IS NULL")
      .bind(row.id, now())
      .run();
    return json({ revoked: true });
  }

  const generationMatch = path.match(/^\/api\/generations\/([a-z0-9_]+)(?:\/(cancel|reconcile|save-retry))?$/);
  if (generationMatch) {
    const [, generationId, action] = generationMatch;
    let generation = await loadGeneration(env, generationId);
    if (method === "GET" && !action) {
      if (["submitted", "running", "provider_complete", "saving", "submitting"].includes(generation.status))
        generation = await advanceGeneration(env, generation);
      return json({
        generation: generationView(generation),
        budget: await budgetSnapshot(env, generation.project_id),
      });
    }
    if (method === "POST" && action === "cancel") {
      generation = await cancelGeneration(env, generation);
      return json({ generation: generationView(generation), budget: await budgetSnapshot(env, generation.project_id) });
    }
    if (method === "POST" && action === "reconcile") {
      generation = await reconcileGeneration(env, generation);
      return json({ generation: generationView(generation), budget: await budgetSnapshot(env, generation.project_id) });
    }
    if (method === "POST" && action === "save-retry") {
      if (!generation.retained_key)
        throw new HttpError(409, "No retained result is waiting to be saved", "nothing_to_save");
      const object = await env.MEDIA.get(generation.retained_key);
      if (!object) throw new HttpError(410, "The retained result is no longer available", "unavailable");
      const bytes = new Uint8Array(await object.arrayBuffer());
      generation = await saveGeneration(env, generation, bytes, generation.retained_mime?.includes("mp4") ? "mp4" : "jpeg");
      return json({ generation: generationView(generation), budget: await budgetSnapshot(env, generation.project_id) });
    }
    if (method === "DELETE" && !action) {
      if (generation.status === "saved")
        throw new HttpError(409, "Saved results are removed from the library, not from their generation record", "saved_result");
      if (generation.deleted_at) return json({ deleted: true, alreadyDeleted: true });
      await env.DB.prepare(
        "UPDATE generations SET deleted_at=?2,delete_revision=delete_revision+1,updated_at=?2 WHERE id=?1",
      )
        .bind(generation.id, now())
        .run();
      if (generation.retained_key) await env.MEDIA.delete(generation.retained_key);
      if (["submitted", "running", "cancel_requested"].includes(generation.status))
        await cancelGeneration(env, generation);
      return json({ deleted: true });
    }
  }

  throw new HttpError(404, "Not found", "not_found");
}

function defaultDefaults() {
  return {
    imageModel: "studio-print",
    videoModel: "hailuo-standard",
    aspect: "portrait",
    durationSeconds: 6,
  };
}

function normalizeReferences(input) {
  if (!Array.isArray(input) || input.length > 12)
    throw new HttpError(400, "Keep up to 12 creative references");
  return input.map((reference) => {
    if (!reference || typeof reference !== "object" || Array.isArray(reference))
      throw new HttpError(400, "Each reference needs a title and an HTTPS link");
    const title = text(reference.title, 100, "Reference title");
    let url;
    try {
      url = new URL(String(reference.url ?? ""));
    } catch {
      throw new HttpError(400, "Each reference needs a full HTTPS link");
    }
    if (url.protocol !== "https:" || url.username || url.password)
      throw new HttpError(400, "References must be plain HTTPS links");
    return {
      id: typeof reference.id === "string" && /^[a-z0-9_-]{4,60}$/i.test(reference.id) ? reference.id : id("ref"),
      title,
      url: url.href,
      note: text(reference.note ?? "", 240, "Reference note", { required: false }),
    };
  });
}

async function uploadAsset(request, env, project) {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("multipart/form-data"))
    throw new HttpError(415, "Upload the file as form data", "unsupported_media_type");
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a file to upload");
  if (file.size === 0) throw new HttpError(400, "That file is empty");
  if (file.size > MAX_VIDEO_BYTES)
    throw new HttpError(413, `Keep uploads under ${MAX_VIDEO_BYTES / 1024 / 1024} MiB`, "too_large");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffMedia(bytes, file.type);
  if (!sniffed.kind) throw new HttpError(415, "Upload a JPEG, PNG or WebP image, or an MP4/WebM video", "unsupported_type");
  const limit = sniffed.kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (bytes.length > limit)
    throw new HttpError(413, `${sniffed.kind === "image" ? "Images" : "Videos"} must stay under ${limit / 1024 / 1024} MiB`, "too_large");

  let size;
  if (sniffed.kind === "image") {
    size = imageSize(bytes);
    if (!size.width || !size.height)
      throw new HttpError(415, "That image could not be read. Try a standard JPEG or PNG.", "unsupported_type");
  } else {
    size = videoInfo(bytes);
  }

  const hash = await sha256Hex(bytes);
  const assetId = id("asset");
  const key = `projects/${project.id}/assets/${assetId}/original.${extensionFor(sniffed.mime)}`;
  await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: sniffed.mime },
    customMetadata: { sha256: hash, project: project.id },
  });
  const timestamp = now();
  const fallbackTitle = String(form.get("title") ?? "").trim() || file.name.replace(/\.[^.]+$/, "").slice(0, 100) || "Untitled";
  try {
    await env.DB.prepare(
      `INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,duration_ms,sha256,title,caption,source,parent_asset_id,created_at,updated_at)
       VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'upload',?13,?14,?14)`,
    )
      .bind(
        assetId,
        project.id,
        sniffed.kind,
        key,
        sniffed.mime,
        bytes.length,
        size.width ?? null,
        size.height ?? null,
        size.durationMs ?? null,
        hash,
        text(fallbackTitle, 100, "Title", { required: false }) || "Untitled",
        text(String(form.get("caption") ?? ""), 400, "Caption", { required: false }),
        form.get("parentAssetId") ? String(form.get("parentAssetId")) : null,
        timestamp,
      )
      .run();
  } catch (error) {
    await env.MEDIA.delete(key);
    throw error;
  }
  const asset = await env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind(assetId).first();
  return json({ asset: assetView(asset) }, 201);
}

async function handlePublic(request, env, url) {
  const path = url.pathname;
  const publicationMatch = path.match(/^\/p\/([A-Za-z0-9_-]+)(\/poster|\/download|\/media)?$/);
  if (publicationMatch) {
    const [, publicSlug, extra] = publicationMatch;
    const publication = await env.DB.prepare(
      `SELECT p.*, a.kind AS asset_kind, a.mime AS asset_mime, a.width, a.height, a.duration_ms, a.bytes, a.deleted_at AS asset_deleted
       FROM publications p JOIN assets a ON a.id=p.asset_id
       WHERE p.slug=?1 AND p.revoked_at IS NULL`,
    )
      .bind(publicSlug)
      .first();
    if (!publication || publication.asset_deleted)
      throw new HttpError(404, "This page is not published", "not_found");

    if (extra === "/download") return servePublished(env, publication.asset_id, true);
    if (extra === "/media") return servePublished(env, publication.asset_id, false);
    if (extra === "/poster") {
      if (!publication.poster_asset_id) throw new HttpError(404, "No poster for this page", "not_found");
      return servePublished(env, publication.poster_asset_id, false);
    }
    if (request.method !== "GET" && request.method !== "HEAD")
      throw new HttpError(405, "Method not allowed", "method_not_allowed");

    let posterAsset = null;
    if (publication.poster_asset_id) {
      posterAsset = await env.DB.prepare(
        "SELECT id,kind,mime,width,height,deleted_at FROM assets WHERE id=?1",
      )
        .bind(publication.poster_asset_id)
        .first();
    }
    const usablePoster = posterAsset && !posterAsset.deleted_at && posterAsset.kind === "image" ? posterAsset : null;
    const poster =
      publication.asset_kind === "image"
        ? `/p/${publication.slug}/download`
        : usablePoster
          ? `/p/${publication.slug}/poster`
          : null;
    const destinations = sharingDestinations(env);
    const html = publicPage({
      title: publication.title,
      description: publication.description,
      kind: publication.asset_kind,
      mime: publication.asset_mime,
      width: publication.width,
      height: publication.height,
      durationMs: publication.duration_ms,
      bytes: publication.bytes,
      media: `/p/${publication.slug}/media`,
      download: `/p/${publication.slug}/download`,
      poster,
      posterMime: usablePoster?.mime ?? null,
      posterWidth: usablePoster?.width ?? null,
      posterHeight: usablePoster?.height ?? null,
      buildUrl: destinations.buildUrl,
      storyUrl: destinations.storyUrl,
      origin: env.PUBLIC_ORIGIN || url.origin,
      slug: publication.slug,
    });
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" },
    });
  }

  const shareMatch = path.match(/^\/s\/([A-Za-z0-9_-]+)$/);
  if (shareMatch) {
    const publication = await env.DB.prepare(
      "SELECT asset_id FROM publications WHERE slug=?1 AND revoked_at IS NULL",
    )
      .bind(shareMatch[1])
      .first();
    if (!publication) throw new HttpError(404, "Not found", "not_found");
    return servePublished(env, publication.asset_id, false);
  }

  if (path === "/healthz") {
    return json({
      ok: true,
      revision: BUILD.revision,
      bridge: Boolean(env.BRIDGE_SECRET),
      builtAt: BUILD.builtAt,
      time: new Date().toISOString(),
    });
  }
  if (path === "/build.json") return json({ revision: BUILD.revision, builtAt: BUILD.builtAt });

  if (path === "/bridge") {
    const token = url.searchParams.get("token");
    const claim = await readBridgeToken(env, token);
    if (!claim)
      return new Response(loginPage({ next: "/", revision: BUILD.revision, bridged: Boolean(env.BRIDGE_SECRET) }), {
        status: 401,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    const session = await createSession(env);
    return new Response(null, { status: 302, headers: { location: "/", "set-cookie": sessionCookie(session), "cache-control": "no-store" } });
  }

  if (path === "/login") return handleLogin(request, env);
  if (path === "/help") {
    return new Response(helpPage(), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" },
    });
  }
  if (path === "/" || path === "/studio") {
    const { readSession } = await import("./lib/auth.mjs");
    const session = await readSession(env, request);
    if (!session && path !== "/login")
      return new Response(loginPage({ next: "/", revision: BUILD.revision, bridged: Boolean(env.BRIDGE_SECRET) }), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    return new Response(shell({ revision: BUILD.revision }), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (env.ASSETS) return env.ASSETS.fetch(request);
  return new Response(notFoundPage(), {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function servePublished(env, assetId, download) {
  const asset = await env.DB.prepare("SELECT * FROM assets WHERE id=?1").bind(assetId).first();
  if (!asset || asset.deleted_at) throw new HttpError(404, "Not found", "not_found");
  const object = await env.MEDIA.get(asset.r2_key);
  if (!object) throw new HttpError(410, "This media is no longer available", "unavailable");
  const headers = {
    "content-type": asset.mime,
    "content-length": String(asset.bytes),
    "cache-control": "public, max-age=86400",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "cross-origin",
    etag: `"${asset.sha256.slice(0, 32)}"`,
  };
  if (download)
    headers["content-disposition"] = `attachment; filename="published-${asset.id}.${extensionFor(asset.mime)}"`;
  return new Response(object.body, { headers });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const response = url.pathname.startsWith("/api/")
        ? await handleApi(request, env, url)
        : await handlePublic(request, env, url);
      return securityHeaders(response);
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status === 401 && !new URL(request.url).pathname.startsWith("/p/"))
          return securityHeaders(json({ error: { code: error.code, message: error.message }, signedIn: false }, 401));
        return securityHeaders(problem(error.message, error.status, error.code));
      }
      console.error("media-studio", error);
      return securityHeaders(problem("Something went wrong. Nothing was charged by this request.", 500, "internal"));
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const pending = await pendingGenerations(env, 8);
        for (const generation of pending) await advanceGeneration(env, generation);
      })(),
    );
  },
};
