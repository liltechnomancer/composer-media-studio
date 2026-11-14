// MIT. Provider contract checks. These exercise the exact request shape without
// spending money; live generation remains a separate, recorded evidence step.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyProviderFailure,
  getModel,
  readVideoStatus,
  readVideoResult,
  sanitiseProviderDetail,
  submitVideo,
  downloadVideo,
  validateSettings,
} from "../src/lib/providers.mjs";

const reference = {
  bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]),
  format: "jpeg",
  width: 1024,
  height: 1280,
};

function withFetch(handler, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return handler(String(url), options);
  };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = original;
    })
    .then((value) => ({ value, calls }));
}

test("video submission sends the documented image-to-video shape", async () => {
  const { value, calls } = await withFetch(
    () =>
      new Response(
        JSON.stringify({
          request_id: "req_123",
          status_url: "https://queue.fal.run/fal-ai/minimax/hailuo-2.3/standard/image-to-video/requests/req_123/status",
          response_url: "https://queue.fal.run/fal-ai/minimax/hailuo-2.3/standard/image-to-video/requests/req_123",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    () => {
      const model = getModel("hailuo-standard");
      const settings = validateSettings(model, { prompt: "a slow push in", durationSeconds: 6 });
      return submitVideo({ FAL_KEY: "test-key" }, model, settings, reference);
    },
  );
  assert.equal(value.requestId, "req_123");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].url, "https://queue.fal.run/fal-ai/minimax/hailuo-2.3/standard/image-to-video");
  assert.equal(calls[0].options.headers.authorization, "Key test-key");
  assert.equal(body.duration, "6");
  assert.match(body.image_url, /^data:image\/jpeg;base64,/);
  assert.ok(body.prompt.includes("slow push in"));
});

test("an unfunded provider is a definite refusal and is not retried", async () => {
  const { calls } = await withFetch(
    () => new Response(JSON.stringify({ detail: "User is locked. Reason: Exhausted balance." }), { status: 403 }),
    async () => {
      const model = getModel("hailuo-standard");
      const settings = validateSettings(model, { prompt: "x", durationSeconds: 6 });
      await assert.rejects(submitVideo({ FAL_KEY: "test-key" }, model, settings, reference), (error) => {
        assert.equal(error.status, 402);
        assert.equal(error.code, "provider_funding");
        assert.equal(error.definitive, true);
        return true;
      });
    },
  );
  assert.equal(calls.length, 1);
});

test("a provider status URL outside the queue host is rejected", async () => {
  await withFetch(
    () =>
      new Response(
        JSON.stringify({
          request_id: "req_123",
          status_url: "https://attacker.example/status",
          response_url: "https://queue.fal.run/x",
        }),
        { status: 200 },
      ),
    async () => {
      const model = getModel("hailuo-standard");
      const settings = validateSettings(model, { prompt: "x", durationSeconds: 6 });
      await assert.rejects(submitVideo({ FAL_KEY: "k" }, model, settings, reference), /unexpected status URL/);
    },
  );
});

test("status and result reads use the stored provider addresses", async () => {
  const generation = {
    provider_request_id: "req_123",
    provider_status_url: "https://queue.fal.run/model/requests/req_123/status",
    provider_response_url: "https://queue.fal.run/model/requests/req_123",
  };
  const { value } = await withFetch(
    (url) =>
      url.includes("/status")
        ? new Response(JSON.stringify({ status: "COMPLETED", response_url: generation.provider_response_url }), { status: 200 })
        : new Response(JSON.stringify({ video: { url: "https://v3.fal.media/files/video.mp4", content_type: "video/mp4", file_size: 100 } }), { status: 200 }),
    async () => ({
      status: await readVideoStatus({ FAL_KEY: "k" }, generation),
      result: await readVideoResult({ FAL_KEY: "k" }, generation),
    }),
  );
  assert.equal(value.status.status, "COMPLETED");
  assert.equal(value.result.url, "https://v3.fal.media/files/video.mp4");
});

test("video downloads cannot be pointed at an arbitrary host", async () => {
  await assert.rejects(downloadVideo({ FAL_KEY: "k" }, "https://attacker.example/video.mp4"), /untrusted download address/);
});

test("a 403 with a permission detail is not reported as a funding problem", async () => {
  await withFetch(
    () =>
      new Response(
        JSON.stringify({ detail: "This API key is not allowed to use this endpoint" }),
        { status: 403, headers: { "x-fal-error-type": "permission" } },
      ),
    async () => {
      const model = getModel("hailuo-standard");
      const settings = validateSettings(model, { prompt: "x", durationSeconds: 6 });
      await assert.rejects(submitVideo({ FAL_KEY: "test-key" }, model, settings, reference), (error) => {
        assert.equal(error.code, "provider_permission");
        assert.equal(error.errorType, "permission");
        assert.equal(error.providerStatus, 403);
        assert.equal(error.definitive, true);
        return true;
      });
    },
  );
});

test("queue status keeps the provider's error, type and recent logs", async () => {
  const generation = {
    provider_request_id: "req_123",
    provider_status_url: "https://queue.fal.run/model/requests/req_123/status",
    provider_response_url: "https://queue.fal.run/model/requests/req_123",
  };
  const { value, calls } = await withFetch(
    () =>
      new Response(
        JSON.stringify({
          status: "COMPLETED",
          error: "Input video is not readable; see https://signed.example/secret",
          error_type: "validation",
          logs: [
            { message: "queued" },
            { message: "runner failed: invalid input" },
          ],
        }),
        { status: 200 },
      ),
    () => readVideoStatus({ FAL_KEY: "k" }, generation),
  );
  assert.match(calls[0].url, /\?logs=1$/);
  assert.equal(value.status, "COMPLETED");
  assert.equal(value.errorType, "validation");
  assert.match(value.error, /not readable/);
  assert.ok(!value.error.includes("signed.example"));
  assert.deepEqual(value.logs, ["queued", "runner failed: invalid input"]);
});

test("a result read failure keeps its HTTP status and provider error type", async () => {
  const generation = {
    provider_response_url: "https://queue.fal.run/model/requests/req_123",
  };
  await withFetch(
    () =>
      new Response(JSON.stringify({ detail: "Result not permitted for this key" }), {
        status: 403,
        headers: { "x-fal-error-type": "permission" },
      }),
    async () => {
      await assert.rejects(readVideoResult({ FAL_KEY: "k" }, generation), (error) => {
        assert.equal(error.code, "provider_permission");
        assert.equal(error.providerStatus, 403);
        assert.equal(error.errorType, "permission");
        assert.equal(error.definitive, true);
        assert.equal(error.stage, "result");
        return true;
      });
    },
  );
});

test("provider detail is bounded and strips signed URLs and keys", () => {
  const detail = sanitiseProviderDetail(
    "key: sk_live_secret failed at https://queue.fal.run/x?sig=abc and again https://v3.fal.media/y",
    120,
  );
  assert.ok(!detail.includes("sk_live_secret"));
  assert.ok(!detail.includes("queue.fal.run"));
  assert.ok(!detail.includes("fal.media"));
  assert.ok(detail.length <= 120);
});

test("failure classification separates funding, permission and transient errors", () => {
  assert.equal(classifyProviderFailure(403, { detail: "Exhausted balance" }), "provider_funding");
  assert.equal(classifyProviderFailure(403, { detail: "Forbidden" }), "provider_permission");
  assert.equal(classifyProviderFailure(401, {}), "provider_auth");
  assert.equal(classifyProviderFailure(429, {}), "provider_rate_limited");
  assert.equal(classifyProviderFailure(422, { detail: "invalid input" }), "provider_rejected");
  assert.equal(classifyProviderFailure(503, {}), "provider_error");
});

