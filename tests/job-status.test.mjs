// MIT. Queue-state handling for an already dispatched job. These use the
// stored provider URLs and a stubbed fetch: no inference, no key, no spend.

import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceGeneration, dispatchRender, loadGeneration } from "../src/lib/jobs.mjs";
import { addAsset, setup } from "./harness.mjs";

const STATUS_URL = "https://queue.fal.run/fal-ai/ffmpeg-api/requests/req_status/status";
const RESULT_URL = "https://queue.fal.run/fal-ai/ffmpeg-api/requests/req_status";

async function submittedJob(env, project) {
  const timestamp = Date.now();
  await env.DB.prepare(
    `INSERT INTO generations(id,project_id,client_request_id,kind,recipe_id,provider,model,request_json,status,provider_request_id,provider_status_url,provider_response_url,cost_estimate_micro,cost_reserved_micro,created_at,updated_at,submitted_at)
     VALUES('gen_status',?1,'req_status','video','composition','fal','studio-assembly','{}','submitted','req_status',?2,?3,20000,20000,?4,?4,?4)`,
  )
    .bind(project.id, STATUS_URL, RESULT_URL, timestamp)
    .run();
  return loadGeneration(env, "gen_status");
}

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

const envFor = (base) => ({ ...base, FAL_KEY: "test-key" });

test("a COMPLETED queue status that carries the model's error is a terminal failure", async () => {
  const { env, project } = await setup();
  const job = await submittedJob(env, project);
  const { value, calls } = await withFetch(
    () =>
      new Response(
        JSON.stringify({
          status: "COMPLETED",
          error: "Permission denied for this endpoint",
          error_type: "permission",
          response_url: RESULT_URL,
        }),
        { status: 200 },
      ),
    () => advanceGeneration(envFor(env), job),
  );
  assert.equal(value.status, "failed");
  assert.equal(value.error_code, "provider_permission");
  assert.match(value.error_detail, /permission/i);
  // The request identity survives, so a bounded reconcile is still possible.
  assert.equal(value.provider_request_id, "req_status");
  assert.equal(value.cost_observed_micro, null);
  // Nothing tried to read a result that cannot exist.
  assert.equal(calls.length, 1);
});

test("a 403 while reading the result is recorded as permission, not funding", async () => {
  const { env, project } = await setup();
  const job = await submittedJob(env, project);
  const { value } = await withFetch(
    (url) =>
      url.includes("/status")
        ? new Response(JSON.stringify({ status: "COMPLETED", response_url: RESULT_URL }), { status: 200 })
        : new Response(JSON.stringify({ detail: "This account cannot read this result" }), {
            status: 403,
            headers: { "x-fal-error-type": "permission" },
          }),
    () => advanceGeneration(envFor(env), job),
  );
  // The render may exist behind the denial, so this stays reconcilable rather
  // than pretending the job failed or that an output was saved.
  assert.equal(value.status, "unknown");
  assert.equal(value.error_code, "provider_permission");
  assert.match(value.error_detail, /HTTP 403/);
  assert.equal(value.cost_observed_micro, null);
});

test("a transient result read keeps the job recoverable instead of failing it", async () => {
  const { env, project } = await setup();
  const job = await submittedJob(env, project);
  const { value } = await withFetch(
    (url) =>
      url.includes("/status")
        ? new Response(JSON.stringify({ status: "COMPLETED", response_url: RESULT_URL }), { status: 200 })
        : new Response("upstream unavailable", { status: 503 }),
    () => advanceGeneration(envFor(env), job),
  );
  assert.equal(value.status, "provider_complete");
  assert.equal(value.error_code, "result_unavailable");
  assert.equal(value.provider_request_id, "req_status");
});

test("a finished failure is not dispatched or read twice", async () => {
  const { env, project } = await setup();
  const job = await submittedJob(env, project);
  const { calls } = await withFetch(
    () => new Response(JSON.stringify({ detail: "Exhausted balance" }), { status: 403 }),
    async () => {
      const first = await advanceGeneration(envFor(env), job);
      const second = await advanceGeneration(envFor(env), first);
      assert.equal(second.status, "unknown");
      assert.equal(second.error_code, "provider_funding");
      return second;
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${STATUS_URL}?logs=1`);
});

test("a bounded render completes from the direct response without a queue result read", async () => {
  const { env, project } = await setup();
  await addAsset(env, project, { id: "asset_a", kind: "video", durationMs: 1000 });
  await addAsset(env, project, { id: "asset_b", kind: "video", durationMs: 1000 });
  const timestamp = Date.now();
  await env.DB.prepare(
    `INSERT INTO generations(id,project_id,client_request_id,kind,recipe_id,provider,model,request_json,status,cost_estimate_micro,cost_reserved_micro,created_at,updated_at)
     VALUES('gen_direct',?1,'req_direct','video','composition','fal','studio-assembly',?2,'admitted',20000,20000,?3,?3)`,
  )
    .bind(
      project.id,
      JSON.stringify({
        title: "Direct render",
        shots: [
          { assetId: "asset_a", durationMs: 1000 },
          { assetId: "asset_b", durationMs: 1000 },
        ],
      }),
      timestamp,
    )
    .run();
  const job = await loadGeneration(env, "gen_direct");
  const { value, calls } = await withFetch(
    (url) =>
      url.startsWith("https://fal.run/")
        ? new Response(
            JSON.stringify({ video: { url: "https://v3.fal.media/files/out.mp4", content_type: "video/mp4" } }),
            { status: 200, headers: { "x-fal-request-id": "req_direct_1" } },
          )
        : new Response(Uint8Array.from([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]), {
            status: 200,
            headers: { "content-type": "video/mp4" },
          }),
    async () => {
      const admitted = await dispatchRender(envFor(env), job);
      const first = await advanceGeneration(envFor(env), admitted, { allowDispatch: true });
      const second = await advanceGeneration(envFor(env), first, { allowDispatch: true });
      return { admitted, first, second };
    },
  );
  assert.equal(value.admitted.status, "submitting");
  assert.equal(value.first.status, "saved");
  assert.equal(value.second.status, "saved");
  // One paid render for two crons and two polls.
  assert.equal(calls.filter((call) => call.url.startsWith("https://fal.run/")).length, 1);
  assert.ok(calls.every((call) => !call.url.startsWith("https://queue.fal.run/")));
});
