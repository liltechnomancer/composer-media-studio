// MIT. Provider contract checks. These exercise the exact request shape without
// spending money; live generation remains a separate, recorded evidence step.

import { test } from "node:test";
import assert from "node:assert/strict";
import { submitVideo, readVideoStatus, readVideoResult, downloadVideo, getModel, validateSettings } from "../src/lib/providers.mjs";

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
      url.endsWith("/status")
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
