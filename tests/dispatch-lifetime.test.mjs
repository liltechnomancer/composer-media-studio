import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";
import { createSession } from "../src/lib/auth.mjs";
import { PNG_1x1, setup } from "./harness.mjs";

test("an admitted video dispatch is registered to continue after client disconnect", async (t) => {
  const { env, project } = await setup();
  env.FAL_KEY = "test-key";
  await env.MEDIA.put("source", PNG_1x1);
  await env.DB.prepare("INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,sha256,title,source,created_at,updated_at) VALUES('asset_ref',?1,'image','source','image/png',1,1,1,'hash','Still','upload',1,1)").bind(project.id).run();
  let finishProvider;
  let started;
  const providerStarted = new Promise((resolve) => { started = resolve; });
  t.mock.method(globalThis, "fetch", () => {
    started();
    return new Promise((resolve) => { finishProvider = resolve; });
  });
  const retained = [];
  const ctx = { waitUntil(promise) { retained.push(promise); } };
  const cookie = `studio_session=${await createSession(env)}`;
  const request = new Request(`https://studio.test/api/projects/${project.id}/generations`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ kind: "video", model: "hailuo-standard", prompt: "Move the light gently", durationSeconds: 6, referenceAssetId: "asset_ref", clientRequestId: "req_lifetime" }),
  });
  const response = worker.fetch(request, env, ctx);
  await providerStarted;
  assert.equal(retained.length, 1);
  finishProvider(Response.json({ request_id: "req_provider", status_url: "https://queue.fal.run/model/requests/req_provider/status", response_url: "https://queue.fal.run/model/requests/req_provider" }));
  await retained[0];
  assert.equal((await response).status, 201);
  const generation = await env.DB.prepare("SELECT status,provider_request_id FROM generations WHERE client_request_id='req_lifetime'").first();
  assert.equal(generation.status, "submitted");
  assert.equal(generation.provider_request_id, "req_provider");
  assert.equal(globalThis.fetch.mock.calls.length, 1);
});
