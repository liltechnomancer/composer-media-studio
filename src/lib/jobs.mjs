// MIT. One durable job authority for images and video.
//
// Invariants:
// - intent is persisted before any provider dispatch;
// - a client request id can only create one generation;
// - a durable lease prevents two workers dispatching the same admitted job;
// - retained bytes are saved without another inference call;
// - an ambiguous provider outcome keeps its reservation and is never resubmitted;
// - a deleted job or asset is never resurrected by a late completion.

import {
  downloadVideo,
  estimateCost,
  getModel,
  readVideoResult,
  readVideoStatus,
  runImage,
  submitVideo,
  validateSettings,
  cancelVideo,
} from "./providers.mjs";
import {
  extensionFor,
  HttpError,
  id,
  imageSize,
  money,
  now,
  periodKey,
  safeJson,
  sha256Hex,
  sniffMedia,
  videoInfo,
} from "./util.mjs";

export const defaultAllowanceMicro = 5_000_000;

export function allowanceFor(env) {
  const configured = Number(env.MONTHLY_ALLOWANCE_MICRO);
  return Number.isSafeInteger(configured) && configured >= 0
    ? configured
    : defaultAllowanceMicro;
}

export async function loadProject(env, projectId, { required = true } = {}) {
  const project = await env.DB.prepare("SELECT * FROM projects WHERE id=?1").bind(projectId).first();
  if (!project && required) throw new HttpError(404, "Project not found", "not_found");
  return project;
}

export async function loadGeneration(env, generationId) {
  const row = await env.DB.prepare("SELECT * FROM generations WHERE id=?1").bind(generationId).first();
  if (!row) throw new HttpError(404, "Generation not found", "not_found");
  return row;
}

export async function budgetSnapshot(env, projectId) {
  const period = periodKey();
  const row = await env.DB.prepare("SELECT * FROM budgets WHERE project_id=?1 AND period=?2")
    .bind(projectId, period)
    .first();
  const allowance = row?.allowance_micro ?? allowanceFor(env);
  return {
    period,
    allowanceMicro: allowance,
    reservedMicro: row?.reserved_micro ?? 0,
    spentMicro: row?.spent_micro ?? 0,
    availableMicro: Math.max(0, allowance - (row?.reserved_micro ?? 0) - (row?.spent_micro ?? 0)),
  };
}

async function ensureBudget(env, projectId) {
  await env.DB.prepare(
    "INSERT INTO budgets(project_id,period,allowance_micro,reserved_micro,spent_micro,updated_at) VALUES(?1,?2,?3,0,0,?4) ON CONFLICT(project_id,period) DO NOTHING",
  )
    .bind(projectId, periodKey(), allowanceFor(env), now())
    .run();
}

/** Atomic admission: one SQL statement is the allowance authority. */
async function reserve(env, projectId, amount) {
  await ensureBudget(env, projectId);
  const row = await env.DB.prepare(
    "UPDATE budgets SET reserved_micro=reserved_micro+?3, updated_at=?4 WHERE project_id=?1 AND period=?2 AND reserved_micro+spent_micro+?3<=allowance_micro RETURNING reserved_micro,spent_micro,allowance_micro",
  )
    .bind(projectId, periodKey(), amount, now())
    .first();
  if (!row) {
    const snapshot = await budgetSnapshot(env, projectId);
    throw new HttpError(
      402,
      `This month's allowance has ${money(snapshot.availableMicro)} free; this request needs ${money(amount)}. Raise the allowance or wait for next month.`,
      "budget_exhausted",
    );
  }
  return row;
}

async function settleReservation(env, generation) {
  const fresh = await loadGeneration(env, generation.id);
  if (fresh.cost_observed_micro !== null) return;
  await env.DB.prepare(
    "UPDATE budgets SET reserved_micro=MAX(0,reserved_micro-?3), spent_micro=spent_micro+?3, updated_at=?4 WHERE project_id=?1 AND period=?2",
  )
    .bind(generation.project_id, periodKey(generation.created_at), generation.cost_reserved_micro, now())
    .run();
  await env.DB.prepare("UPDATE generations SET cost_observed_micro=?2, updated_at=?3 WHERE id=?1 AND cost_observed_micro IS NULL")
    .bind(generation.id, generation.cost_reserved_micro, now())
    .run();
}

async function releaseReservation(env, generation) {
  const fresh = await loadGeneration(env, generation.id);
  if (fresh.cost_observed_micro !== null) return;
  await env.DB.prepare(
    "UPDATE budgets SET reserved_micro=MAX(0,reserved_micro-?3), updated_at=?4 WHERE project_id=?1 AND period=?2",
  )
    .bind(generation.project_id, periodKey(generation.created_at), generation.cost_reserved_micro, now())
    .run();
  await env.DB.prepare("UPDATE generations SET cost_observed_micro=0, updated_at=?2 WHERE id=?1 AND cost_observed_micro IS NULL")
    .bind(generation.id, now())
    .run();
}

async function referenceFor(env, projectId, assetId) {
  if (!assetId) return null;
  const asset = await env.DB.prepare(
    "SELECT * FROM assets WHERE id=?1 AND project_id=?2 AND deleted_at IS NULL",
  )
    .bind(assetId, projectId)
    .first();
  if (!asset) throw new HttpError(404, "The selected reference is not in this project", "reference_unavailable");
  if (asset.kind !== "image")
    throw new HttpError(400, "Choose a still image as the reference", "reference_unavailable");
  const object = await env.MEDIA.get(asset.r2_key);
  if (!object) throw new HttpError(410, "The selected reference bytes are unavailable", "reference_unavailable");
  const bytes = new Uint8Array(await object.arrayBuffer());
  const size = imageSize(bytes);
  return {
    asset,
    bytes,
    format: size.format ?? "jpeg",
    width: size.width,
    height: size.height,
  };
}

export async function createGeneration(env, project, input) {
  const model = getModel(input.model);
  if (model.kind !== input.kind)
    throw new HttpError(400, "That model does not create this kind of media");
  const settings = validateSettings(model, input);
  const clientRequestId = String(input.clientRequestId ?? "").slice(0, 80);
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(clientRequestId))
    throw new HttpError(400, "A client request id is required", "invalid_request");

  const existing = await env.DB.prepare(
    "SELECT * FROM generations WHERE project_id=?1 AND client_request_id=?2",
  )
    .bind(project.id, clientRequestId)
    .first();
  if (existing) return { generation: existing, created: false };

  const reference = await referenceFor(env, project.id, input.referenceAssetId);
  if (model.references > 0 && !reference)
    throw new HttpError(400, `${model.label} needs a selected reference image`);
  if (model.references === 0 && reference)
    throw new HttpError(400, `${model.label} does not take a reference image`);

  const cost = estimateCost(model, settings);
  const generationId = id("gen");
  const timestamp = now();
  try {
    await env.DB.prepare(
      `INSERT INTO generations(id,project_id,client_request_id,kind,recipe_id,provider,model,request_json,status,cost_estimate_micro,cost_reserved_micro,created_at,updated_at)
       VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'admitted',?9,?10,?11,?12)`,
    )
      .bind(
        generationId,
        project.id,
        clientRequestId,
        model.kind,
        String(input.recipeId ?? "freeform").slice(0, 80),
        model.provider,
        model.id,
        JSON.stringify({
          ...settings,
          referenceAssetId: reference?.asset.id ?? null,
          referenceSha256: reference?.asset.sha256 ?? null,
          parentAssetId: input.parentAssetId ?? null,
        }),
        cost,
        cost,
        timestamp,
        timestamp,
      )
      .run();
  } catch (error) {
    if (String(error.message ?? error).includes("UNIQUE")) {
      const row = await env.DB.prepare(
        "SELECT * FROM generations WHERE project_id=?1 AND client_request_id=?2",
      )
        .bind(project.id, clientRequestId)
        .first();
      if (row) return { generation: row, created: false };
    }
    throw error;
  }

  let generation = await loadGeneration(env, generationId);
  try {
    await reserve(env, project.id, cost);
  } catch (error) {
    await env.DB.prepare("UPDATE generations SET status='failed',error_code='budget_exhausted',error_detail=?2,updated_at=?3 WHERE id=?1")
      .bind(generationId, error.message, now())
      .run();
    throw error;
  }

  generation = await loadGeneration(env, generationId);
  return { generation, created: true, model, settings, reference };
}

/** Atomically take the dispatch lease so two callers cannot both submit. */
async function claim(env, generationId, from, to) {
  const row = await env.DB.prepare(
    `UPDATE generations SET status=?3, updated_at=?4 WHERE id=?1 AND status=?2 RETURNING id`,
  )
    .bind(generationId, from, to, now())
    .first();
  return Boolean(row);
}

export async function dispatchGeneration(env, generation) {
  const model = getModel(generation.model);
  const request = safeJson(generation.request_json, {});
  const reference = await referenceFor(env, generation.project_id, request.referenceAssetId);

  if (!(await claim(env, generation.id, "admitted", "submitting"))) {
    return loadGeneration(env, generation.id);
  }

  if (model.kind === "image") {
    try {
      const output = await runImage(env, model, request, reference ? [reference] : []);
      return await saveGeneration(env, generation, output.bytes, output.format);
    } catch (error) {
      return failGeneration(env, generation, error);
    }
  }

  try {
    const submitted = await submitVideo(env, model, request, reference);
    await env.DB.prepare(
      "UPDATE generations SET status='submitted',provider_request_id=?2,provider_status_url=?3,provider_response_url=?4,submitted_at=?5,updated_at=?5 WHERE id=?1 AND status='submitting'",
    )
      .bind(generation.id, submitted.requestId, submitted.statusUrl, submitted.responseUrl, now())
      .run();
    return loadGeneration(env, generation.id);
  } catch (error) {
    return failGeneration(env, generation, error, { dispatched: true });
  }
}

async function failGeneration(env, generation, error, { dispatched = false } = {}) {
  const definitive = error instanceof HttpError && error.definitive === true;
  const status = definitive || !dispatched ? "failed" : "unknown";
  const code = error instanceof HttpError ? error.code : "provider_error";
  await env.DB.prepare(
    "UPDATE generations SET status=?2,error_code=?3,error_detail=?4,updated_at=?5 WHERE id=?1 AND status IN ('submitting','submitted','running')",
  )
    .bind(generation.id, status, code, String(error.message ?? error).slice(0, 240), now())
    .run();
  if (status === "failed") await releaseReservation(env, generation);
  return loadGeneration(env, generation.id);
}

/** Persist exact output bytes, then the asset record. Never calls inference. */
export async function saveGeneration(env, generation, bytes, format) {
  const mime = mimeFor(format, bytes);
  const fresh = await loadGeneration(env, generation.id);
  if (fresh.status === "saved") return fresh;
  if (fresh.deleted_at) {
    await env.DB.prepare("UPDATE generations SET status='discarded_after_delete',updated_at=?2 WHERE id=?1")
      .bind(generation.id, now())
      .run();
    return loadGeneration(env, generation.id);
  }

  const hash = await sha256Hex(bytes);
  const existingAsset = await env.DB.prepare(
    "SELECT * FROM assets WHERE generation_id=?1 AND deleted_at IS NULL",
  )
    .bind(generation.id)
    .first();
  if (existingAsset) {
    await env.DB.prepare(
      "UPDATE generations SET status='saved',output_asset_id=?2,completed_at=?3,updated_at=?3,error_code=NULL,error_detail=NULL WHERE id=?1",
    )
      .bind(generation.id, existingAsset.id, now())
      .run();
    await settleReservation(env, generation);
    return loadGeneration(env, generation.id);
  }
  const extension = extensionFor(mime);
  const retainedKey = fresh.retained_key ?? `projects/${generation.project_id}/generations/${generation.id}/retained.${extension}`;
  if (!fresh.retained_key) {
    await env.MEDIA.put(retainedKey, bytes, { httpMetadata: { contentType: mime } });
    await env.DB.prepare(
      "UPDATE generations SET retained_key=?2,retained_mime=?3,retained_bytes=?4,status='saving',updated_at=?5 WHERE id=?1",
    )
      .bind(generation.id, retainedKey, mime, bytes.length, now())
      .run();
  }

  const request = safeJson(fresh.request_json, {});
  const assetId = id("asset");
  const assetKey = `projects/${generation.project_id}/assets/${assetId}/original.${extension}`;
  await env.MEDIA.put(assetKey, bytes, { httpMetadata: { contentType: mime } });
  const size = mime.startsWith("video/") ? videoInfo(bytes) : imageSize(bytes);
  const timestamp = now();
  try {
    await env.DB.prepare(
      `INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,duration_ms,sha256,title,caption,source,parent_asset_id,generation_id,created_at,updated_at)
       VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'generated',?13,?14,?15,?15)`,
    )
      .bind(
        assetId,
        generation.project_id,
        mime.startsWith("video/") ? "video" : "image",
        assetKey,
        mime,
        bytes.length,
        size.width ?? null,
        size.height ?? null,
        size.durationMs ?? null,
        hash,
        String(request.prompt ?? "").slice(0, 80),
        String(request.prompt ?? "").slice(0, 400),
        request.parentAssetId ?? null,
        generation.id,
        timestamp,
      )
      .run();
  } catch (error) {
    // The provider already produced bytes. Keep them retained for a save retry.
    await env.DB.prepare(
      "UPDATE generations SET status='provider_complete',error_code='save_failed',error_detail=?2,updated_at=?3 WHERE id=?1",
    )
      .bind(generation.id, String(error.message ?? error).slice(0, 200), now())
      .run();
    throw new HttpError(500, "The result was created but could not be saved. Retry saving; it will not generate again.", "save_failed");
  }

  await env.DB.prepare(
    "UPDATE generations SET status='saved',output_asset_id=?2,completed_at=?3,updated_at=?3,error_code=NULL,error_detail=NULL WHERE id=?1",
  )
    .bind(generation.id, assetId, now())
    .run();
  await settleReservation(env, generation);
  return loadGeneration(env, generation.id);
}

function mimeFor(format, bytes) {
  if (format === "mp4") return "video/mp4";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  const sniffed = sniffMedia(bytes, "image/jpeg");
  return sniffed.kind === "image" ? sniffed.mime : "image/jpeg";
}

/** Advance one asynchronous job. Safe to call repeatedly from polling or cron. */
export async function advanceGeneration(env, generation) {
  const fresh = await loadGeneration(env, generation.id);
  if (fresh.deleted_at) {
    if (fresh.retained_key) await env.MEDIA.delete(fresh.retained_key);
    await env.DB.prepare("UPDATE generations SET status='discarded_after_delete',retained_key=NULL,updated_at=?2 WHERE id=?1")
      .bind(fresh.id, now())
      .run();
    return loadGeneration(env, fresh.id);
  }

  if (["provider_complete", "saving"].includes(fresh.status) && fresh.retained_key) {
    const stored = await env.MEDIA.get(fresh.retained_key);
    if (stored) {
      const bytes = new Uint8Array(await stored.arrayBuffer());
      return saveGeneration(env, fresh, bytes, fresh.retained_mime?.includes("mp4") ? "mp4" : "jpeg");
    }
    return fresh;
  }

  if (fresh.status === "submitting") {
    // A worker can die between the dispatch lease and the provider reply.
    // The provider may or may not have started: never resubmit automatically.
    if (now() - fresh.updated_at > 120_000) {
      await env.DB.prepare(
        "UPDATE generations SET status='unknown',error_code='dispatch_unknown',error_detail='The studio lost the reply before the provider confirmed. Check the provider before retrying.',updated_at=?2 WHERE id=?1 AND status='submitting'",
      )
        .bind(fresh.id, now())
        .run();
      return loadGeneration(env, fresh.id);
    }
    return fresh;
  }

  if (!["submitted", "running", "cancel_requested"].includes(fresh.status)) return fresh;
  if (!fresh.provider_request_id) return fresh;

  let status;
  try {
    status = await readVideoStatus(env, fresh);
  } catch (error) {
    // A transient read failure is not a provider failure. Leave the job intact.
    return fresh;
  }

  const providerState = status.status.toUpperCase();
  if (providerState === "COMPLETED") return completeVideo(env, fresh, status);
  if (providerState === "CANCELLED" || providerState === "CANCELED") {
    await env.DB.prepare("UPDATE generations SET status='cancelled',cancelled_at=?2,updated_at=?2 WHERE id=?1")
      .bind(fresh.id, now())
      .run();
    await settleReservation(env, fresh);
    return loadGeneration(env, fresh.id);
  }
  if (providerState === "FAILED" || providerState === "ERROR") {
    await env.DB.prepare("UPDATE generations SET status='failed',error_code='provider_failed',error_detail='The video provider reported a failed job',updated_at=?2 WHERE id=?1")
      .bind(fresh.id, now())
      .run();
    await releaseReservation(env, fresh);
    return loadGeneration(env, fresh.id);
  }
  if (providerState === "IN_PROGRESS" && fresh.status !== "cancel_requested") {
    await env.DB.prepare("UPDATE generations SET status='running',updated_at=?2 WHERE id=?1 AND status IN ('submitted','running')")
      .bind(fresh.id, now())
      .run();
  }
  return loadGeneration(env, fresh.id);
}

async function completeVideo(env, generation, status) {
  if (generation.status === "cancel_requested") {
    // Completion won the race. Report what happened instead of pretending it cancelled.
    await env.DB.prepare("UPDATE generations SET error_code='completed_before_cancel',updated_at=?2 WHERE id=?1")
      .bind(generation.id, now())
      .run();
  }
  await env.DB.prepare("UPDATE generations SET status='provider_complete',updated_at=?2 WHERE id=?1")
    .bind(generation.id, now())
    .run();
  let result;
  try {
    result = await readVideoResult(env, { ...generation, provider_response_url: status.responseUrl });
  } catch (error) {
    await env.DB.prepare("UPDATE generations SET error_code='result_unavailable',error_detail=?2,updated_at=?3 WHERE id=?1")
      .bind(generation.id, String(error.message).slice(0, 200), now())
      .run();
    return loadGeneration(env, generation.id);
  }
  let download;
  try {
    download = await downloadVideo(env, result.url);
  } catch (error) {
    await env.DB.prepare("UPDATE generations SET error_code='download_failed',error_detail=?2,updated_at=?3 WHERE id=?1")
      .bind(generation.id, String(error.message).slice(0, 200), now())
      .run();
    return loadGeneration(env, generation.id);
  }
  return saveGeneration(env, generation, download.bytes, "mp4");
}

export async function cancelGeneration(env, generation) {
  const fresh = await loadGeneration(env, generation.id);
  if (fresh.status === "admitted" || fresh.status === "submitting") {
    const cancelled = await env.DB.prepare(
      "UPDATE generations SET status='cancelled',cancelled_at=?2,updated_at=?2 WHERE id=?1 AND status IN ('admitted','submitting') RETURNING id",
    )
      .bind(fresh.id, now())
      .first();
    if (cancelled) {
      await releaseReservation(env, fresh);
      return loadGeneration(env, fresh.id);
    }
    return loadGeneration(env, fresh.id);
  }
  if (["submitted", "running"].includes(fresh.status)) {
    try {
      const result = await cancelVideo(env, fresh);
      if (result.accepted) {
        await env.DB.prepare("UPDATE generations SET status='cancel_requested',updated_at=?2 WHERE id=?1")
          .bind(fresh.id, now())
          .run();
        return loadGeneration(env, fresh.id);
      }
    } catch {
      // Fall through to an honest "not confirmed" state.
    }
    await env.DB.prepare("UPDATE generations SET error_code='cancel_unconfirmed',updated_at=?2 WHERE id=?1")
      .bind(fresh.id, now())
      .run();
    return loadGeneration(env, fresh.id);
  }
  if (["provider_complete", "saving"].includes(fresh.status)) {
    return advanceGeneration(env, fresh);
  }
  return fresh;
}

export async function reconcileGeneration(env, generation) {
  const fresh = await loadGeneration(env, generation.id);
  if (fresh.status === "unknown") {
    if (fresh.provider_request_id) return advanceGeneration(env, { ...fresh, status: "submitted" });
    await env.DB.prepare("UPDATE generations SET error_code='needs_support',updated_at=?2 WHERE id=?1")
      .bind(fresh.id, now())
      .run();
    return loadGeneration(env, fresh.id);
  }
  return advanceGeneration(env, fresh);
}

export async function pendingGenerations(env, limit = 8) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM generations WHERE status IN ('submitting','submitted','running','provider_complete','saving') ORDER BY updated_at ASC LIMIT ?1",
  )
    .bind(limit)
    .all();
  return results;
}
