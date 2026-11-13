// MIT. Provider adapters and the one server-side model catalogue.
// A model is advertised only after its exact request shape was exercised.
//
// Image: Cloudflare Workers AI, billed to this app's own Cloudflare account.
// Video: fal.ai queue REST, billed to this app's own fal key.

import { HttpError } from "./util.mjs";

export const PROVIDER_CLOUDFLARE = "cloudflare-workers-ai";
export const PROVIDER_FAL = "fal";
export const FAL_ORIGIN = "https://queue.fal.run";

const imageDimensions = {
  square: { width: 1024, height: 1024 },
  portrait: { width: 1024, height: 1280 },
  landscape: { width: 1280, height: 1024 },
  wide: { width: 1280, height: 720 },
};

export const imageAspects = Object.keys(imageDimensions);

export const models = {
  "studio-print": {
    id: "studio-print",
    label: "Studio Print",
    provider: PROVIDER_CLOUDFLARE,
    endpoint: "@cf/leonardo/lucid-origin",
    kind: "image",
    description: "Paper-cut editorial illustration with warm grounds and room for a headline.",
    aspects: imageAspects,
    references: 0,
    costMicro: 25_000,
    costBasis: "Cloudflare Workers AI estimate for one Lucid Origin still; not an invoice.",
  },
  "studio-film": {
    id: "studio-film",
    label: "Studio Film",
    provider: PROVIDER_CLOUDFLARE,
    endpoint: "@cf/leonardo/phoenix-1.0",
    kind: "image",
    description: "Screenprinted cinematic frames with deep shadows and a strong single accent.",
    aspects: imageAspects,
    references: 0,
    costMicro: 20_000,
    costBasis: "Cloudflare Workers AI estimate for one Phoenix still; not an invoice.",
  },
  "studio-draft": {
    id: "studio-draft",
    label: "Studio Draft",
    provider: PROVIDER_CLOUDFLARE,
    endpoint: "@cf/bytedance/stable-diffusion-xl-lightning",
    kind: "image",
    description: "Fast photographic draft for product plates and lighting tests.",
    aspects: imageAspects,
    references: 0,
    costMicro: 1_200,
    costBasis: "Cloudflare Workers AI estimate for one 1024px still; not an invoice.",
  },
  "studio-detail": {
    id: "studio-detail",
    label: "Studio Detail",
    provider: PROVIDER_CLOUDFLARE,
    endpoint: "@cf/black-forest-labs/flux-2-klein-4b",
    kind: "image",
    description: "Reference-guided square variation that takes palette, line quality and subject cues from one selected still. It does not promise identical composition or pixels.",
    aspects: ["square"],
    references: 1,
    costMicro: 6_000,
    costBasis: "Cloudflare Workers AI estimate for one FLUX.2 klein still; not an invoice.",
  },
  "studio-quick": {
    id: "studio-quick",
    label: "Studio Quick",
    provider: PROVIDER_CLOUDFLARE,
    endpoint: "@cf/black-forest-labs/flux-1-schnell",
    kind: "image",
    description: "Cheapest square draft for exploring a direction.",
    aspects: ["square"],
    references: 0,
    costMicro: 700,
    costBasis: "Cloudflare Workers AI estimate for one schnell still; not an invoice.",
  },
  "hailuo-standard": {
    id: "hailuo-standard",
    label: "Hailuo 2.3 Standard",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/minimax/hailuo-2.3/standard/image-to-video",
    kind: "video",
    description: "Asynchronous image-to-video with a six or ten second clip.",
    aspects: ["from-image"],
    references: 1,
    durations: [6, 10],
    costMicro: 280_000,
    costPerSecondMicro: 46_667,
    costBasis: "fal.ai published US$0.28 per video at the time of review; not an invoice.",
  },
  "kling-standard": {
    id: "kling-standard",
    label: "Kling 2.5 Turbo Pro",
    provider: PROVIDER_FAL,
    endpoint: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
    kind: "video",
    description: "Higher-motion asynchronous image-to-video, five or ten seconds.",
    aspects: ["from-image"],
    references: 1,
    durations: [5, 10],
    costMicro: 350_000,
    costPerSecondMicro: 70_000,
    costBasis: "fal.ai review estimate for a five second clip; check current fal pricing before relying on it.",
  },
};

/** Chunked base64 so an 8 MiB reference cannot overflow the argument limit. */
export function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk)
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}

export function publicModels() {
  return Object.values(models).map((model) => ({
    id: model.id,
    label: model.label,
    kind: model.kind,
    description: model.description,
    aspects: model.aspects,
    durations: model.durations ?? null,
    references: model.references,
    provider:
      model.provider === PROVIDER_CLOUDFLARE
        ? "Cloudflare Workers AI"
        : "fal.ai",
    costMicro: model.costMicro,
    costPerSecondMicro: model.costPerSecondMicro ?? null,
    costBasis: model.costBasis,
  }));
}

export function getModel(id) {
  const model = models[id];
  if (!model) throw new HttpError(400, "Choose a supported model");
  return model;
}

export function estimateCost(model, settings = {}) {
  if (model.kind === "image") return model.costMicro;
  const base = model.durations?.[0] ?? 5;
  const seconds = Number(settings.durationSeconds ?? base);
  if (seconds === base) return model.costMicro;
  return Math.round((model.costMicro * seconds) / base);
}

export function aspectDimensions(aspect, reference) {
  if (aspect === "match-reference" || aspect === "from-image") {
    if (reference?.width && reference?.height)
      return { width: reference.width, height: reference.height };
    return { width: 1024, height: 1024 };
  }
  const dimensions = imageDimensions[aspect];
  if (!dimensions) throw new HttpError(400, "Choose a supported frame shape");
  return { ...dimensions };
}

/** Validate settings against the selected model; never coerce silently. */
export function validateSettings(model, input) {
  const prompt = String(input.prompt ?? "").trim();
  if (!prompt) throw new HttpError(400, "Describe what you want to create");
  if (prompt.length > 1800)
    throw new HttpError(400, "Keep the prompt under 1,800 characters");

  if (model.kind === "image") {
    const aspect = String(input.aspect ?? model.aspects[0]);
    if (!model.aspects.includes(aspect))
      throw new HttpError(400, `${model.label} does not support the ${aspect} frame`);
    return { prompt, aspect };
  }

  const durationSeconds = Number(input.durationSeconds ?? model.durations[0]);
  if (!model.durations.includes(durationSeconds))
    throw new HttpError(400, `${model.label} supports ${model.durations.join(" or ")} second clips`);
  const aspect = String(input.aspect ?? "from-image");
  if (!model.aspects.includes(aspect))
    throw new HttpError(400, `${model.label} takes its frame from the selected still`);
  const aspectRatio = ["16:9", "9:16", "1:1"].includes(input.aspectRatio)
    ? input.aspectRatio
    : null;
  return { prompt, durationSeconds, aspect, aspectRatio };
}

/** Text-to-image on the Workers AI binding. */
async function generateImage(env, model, settings, references, signal) {
  const reference = references[0];
  if (model.references > 0) {
    if (!reference) throw new HttpError(400, "Select a reference image for this model");
    const form = new FormData();
    form.set("prompt", settings.prompt);
    form.set("image", new File([reference.bytes], `reference.${reference.format === "png" ? "png" : "jpg"}`, {
      type: reference.format === "png" ? "image/png" : "image/jpeg",
    }));
    const request = new Request("https://studio.local/reference", { method: "POST", body: form });
    const output = await env.AI.run(
      model.endpoint,
      { multipart: { body: request.body, contentType: request.headers.get("content-type") } },
      { signal },
    );
    const base64 = output?.image;
    if (typeof base64 !== "string" || base64.length < 256)
      throw new HttpError(502, "The image provider returned no usable image", "provider_invalid");
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    return { bytes, format: "jpeg" };
  }

  const { width, height } = aspectDimensions(settings.aspect);
  const input = { prompt: settings.prompt, width, height };
  if (model.endpoint.includes("stable-diffusion-xl"))
    input.negative_prompt =
      "photograph of a real person, glossy 3d render, plastic skin, watermark, signature, text, busy detail";
  if (model.endpoint.includes("lucid-origin")) input.guidance = 5;
  if (model.endpoint.includes("phoenix")) input.guidance = 3;
  const output = await env.AI.run(model.endpoint, input, { signal });
  let bytes;
  if (output instanceof ReadableStream) {
    bytes = new Uint8Array(await new Response(output).arrayBuffer());
  } else if (typeof output?.image === "string") {
    bytes = Uint8Array.from(atob(output.image), (character) => character.charCodeAt(0));
  } else {
    throw new HttpError(502, "The image provider returned no usable image", "provider_invalid");
  }
  if (bytes.length < 256)
    throw new HttpError(502, "The image provider returned an empty image", "provider_invalid");
  return { bytes, format: "jpeg" };
}

export async function runImage(env, model, settings, references, signal) {
  try {
    return await generateImage(env, model, settings, references, signal);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, `Image generation was not accepted: ${String(error.message ?? error).slice(0, 160)}`, "provider_error");
  }
}

function falKey(env) {
  if (!env.FAL_KEY) throw new HttpError(503, "Video generation needs a fal.ai key on this studio", "provider_not_configured");
  return env.FAL_KEY;
}

function checkFalUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(502, `Video provider returned an invalid ${label}`, "provider_invalid");
  }
  if (url.protocol !== "https:" || url.hostname !== "queue.fal.run")
    throw new HttpError(502, `Video provider returned an unexpected ${label}`, "provider_invalid");
  return url.href;
}

export async function submitVideo(env, model, settings, reference) {
  if (!reference) throw new HttpError(400, "Select the still to animate");
  if (reference.bytes.length > 8 * 1024 * 1024)
    throw new HttpError(400, "The still is larger than the 8 MiB reference limit", "reference_too_large");
  const mime = reference.format === "png" ? "image/png" : "image/jpeg";
  const dataUri = `data:${mime};base64,${toBase64(reference.bytes)}`;

  const body = {
    prompt: settings.prompt,
    image_url: dataUri,
    duration: String(settings.durationSeconds),
  };
  if (model.id === "kling-standard") {
    body.negative_prompt = "blur, distort, low quality, text artefacts";
  } else {
    body.prompt_optimizer = false;
  }

  const response = await fetch(`${FAL_ORIGIN}/${model.endpoint}`, {
    method: "POST",
    headers: {
      authorization: `Key ${falKey(env)}`,
      "content-type": "application/json",
      "x-fal-request-timeout": "120",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.detail ?? payload?.error?.message ?? `fal responded ${response.status}`;
    const definitive = response.status >= 400 && response.status < 500;
    const error = new HttpError(
      response.status === 403 ? 402 : 502,
      `Video provider refused the request: ${String(detail).slice(0, 200)}`,
      response.status === 403 ? "provider_funding" : "provider_error",
    );
    error.definitive = definitive;
    throw error;
  }
  if (!payload?.request_id)
    throw new HttpError(502, "Video provider accepted the request without an identifier", "provider_invalid");
  return {
    requestId: payload.request_id,
    statusUrl: checkFalUrl(payload.status_url, "status URL"),
    responseUrl: checkFalUrl(payload.response_url, "result URL"),
  };
}

export async function readVideoStatus(env, generation) {
  if (!generation.provider_status_url)
    throw new HttpError(409, "This job has no provider status to read", "unknown_outcome");
  const response = await fetch(generation.provider_status_url, {
    headers: { authorization: `Key ${falKey(env)}` },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new HttpError(502, `Video provider status read failed (${response.status})`, "provider_error");
  return {
    status: String(payload?.status ?? ""),
    responseUrl: payload?.response_url
      ? checkFalUrl(payload.response_url, "result URL")
      : generation.provider_response_url,
  };
}

export async function readVideoResult(env, generation) {
  const response = await fetch(generation.provider_response_url, {
    headers: { authorization: `Key ${falKey(env)}` },
  });
  if (!response.ok)
    throw new HttpError(502, `Video provider result read failed (${response.status})`, "provider_error");
  const payload = await response.json().catch(() => null);
  const file = payload?.video;
  if (!file?.url) throw new HttpError(502, "Video provider returned no video", "provider_invalid");
  return { url: file.url, contentType: file.content_type ?? "video/mp4", bytes: file.file_size ?? null };
}

export async function cancelVideo(env, generation) {
  if (!generation.provider_status_url)
    throw new HttpError(409, "This job has no provider request to cancel", "unknown_outcome");
  const url = generation.provider_status_url.replace(/\/status$/, "/cancel");
  checkFalUrl(url, "cancel URL");
  const response = await fetch(url, {
    method: "PUT",
    headers: { authorization: `Key ${falKey(env)}` },
  });
  return { accepted: response.ok, status: response.status };
}

const ALLOWED_MEDIA_HOST = /(^|\.)fal\.media$/;

export async function downloadVideo(env, url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !ALLOWED_MEDIA_HOST.test(parsed.hostname))
    throw new HttpError(502, "Video provider returned an untrusted download address", "provider_invalid");
  const response = await fetch(parsed.href, { redirect: "follow" });
  if (!response.ok) throw new HttpError(502, `Video download failed (${response.status})`, "provider_error");
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > 64 * 1024 * 1024)
    throw new HttpError(502, "Video exceeds the 64 MiB owned-output limit", "output_too_large");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 64 * 1024 * 1024)
    throw new HttpError(502, "Video exceeds the 64 MiB owned-output limit", "output_too_large");
  return { bytes, contentType: response.headers.get("content-type") ?? "video/mp4" };
}
