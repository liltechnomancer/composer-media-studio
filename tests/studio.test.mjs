// MIT. Focused checks for the studio's real risk boundaries:
// specification validation, idempotency, one budget authority, save recovery,
// tombstones and byte parsing. Uses node:sqlite with the real migration SQL.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  createGeneration,
  cancelGeneration,
  loadGeneration,
  saveGeneration,
  advanceGeneration,
  budgetSnapshot,
} from "../src/lib/jobs.mjs";
import { getModel, validateSettings, publicModels, estimateCost } from "../src/lib/providers.mjs";
import { imageSize, videoInfo, sniffMedia } from "../src/lib/util.mjs";

const migration = readFileSync(new URL("../migrations/0001.sql", import.meta.url), "utf8");

class SqliteD1 {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    this.db.exec(migration);
  }
  prepare(sql) {
    const statement = this.db.prepare(sql);
    return {
      bind: (...args) => ({
        first: async () => statement.get(...args) ?? null,
        all: async () => ({ results: statement.all(...args) }),
        run: async () => statement.run(...args),
      }),
      first: async () => statement.get() ?? null,
      all: async () => ({ results: statement.all() }),
      run: async () => statement.run(),
    };
  }
  exec(sql) {
    this.db.exec(sql);
  }
}

class FakeBucket {
  constructor() {
    this.objects = new Map();
  }
  async put(key, bytes) {
    this.objects.set(key, new Uint8Array(bytes));
  }
  async get(key) {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    return {
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  }
  async delete(key) {
    this.objects.delete(key);
  }
}

const PNG_1x1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function jpeg(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03], 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(7, height);
  view.setUint16(9, width);
  bytes.set([0xff, 0xd9], 22);
  return bytes;
}

async function setup({ allowance = 5_000_000 } = {}) {
  const env = {
    DB: new SqliteD1(),
    MEDIA: new FakeBucket(),
    MONTHLY_ALLOWANCE_MICRO: allowance,
  };
  const projectId = "prj_test";
  const timestamp = Date.now();
  await env.DB.prepare(
    "INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,created_at,updated_at) VALUES(?1,?2,?3,'','private','{}',?4,?4)",
  )
    .bind(projectId, "Test studio", "test-studio", timestamp)
    .run();
  const project = await env.DB.prepare("SELECT * FROM projects WHERE id=?1").bind(projectId).first();
  return { env, project };
}

function imageRequest(overrides = {}) {
  return {
    kind: "image",
    model: "studio-draft",
    recipeId: "editorial-still",
    prompt: "A quiet paper landscape with a single burnt orange sun.",
    aspect: "portrait",
    clientRequestId: "req_abcdefgh",
    ...overrides,
  };
}

test("model settings are validated on the server", () => {
  assert.throws(() => validateSettings(getModel("studio-draft"), { prompt: "x", aspect: "tall" }), /frame/);
  assert.throws(() => validateSettings(getModel("hailuo-standard"), { prompt: "x", durationSeconds: 7 }), /second/);
  const settings = validateSettings(getModel("studio-detail"), { prompt: " change the light ", aspect: "square" });
  assert.equal(settings.prompt, "change the light");
  assert.ok(publicModels().every((model) => model.costMicro > 0 && model.costBasis.length > 20));
});

test("image and video bytes are read without trusting the client", () => {
  assert.deepEqual(imageSize(PNG_1x1), { width: 1, height: 1, format: "png" });
  assert.deepEqual(imageSize(jpeg(640, 480)), { width: 640, height: 480, format: "jpeg" });
  assert.equal(sniffMedia(new TextEncoder().encode("<svg></svg>"), "image/svg+xml").kind, null);
  assert.equal(sniffMedia(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), "").mime, "image/jpeg");
});

test("video duration and frame come from the MP4 boxes", () => {
  const bytes = new Uint8Array(400);
  const view = new DataView(bytes.buffer);
  let offset = 32;
  bytes.set([0, 0, 0, 100], offset);
  bytes.set([...Buffer.from("mvhd")], offset + 4);
  bytes[offset + 8] = 0; // version 0
  view.setUint32(offset + 20, 1000); // timescale
  view.setUint32(offset + 24, 5000); // duration
  offset = 160;
  bytes.set([0, 0, 0, 92], offset);
  bytes.set([...Buffer.from("tkhd")], offset + 4);
  bytes[offset + 8] = 0;
  view.setUint32(offset + 84, 1280 * 65536);
  view.setUint32(offset + 88, 720 * 65536);
  assert.deepEqual(videoInfo(bytes), { durationMs: 5000, width: 1280, height: 720 });
});

test("the same client request can only create one generation", async () => {
  const { env, project } = await setup();
  const first = await createGeneration(env, project, imageRequest());
  assert.equal(first.created, true);
  const second = await createGeneration(env, project, imageRequest());
  assert.equal(second.created, false);
  assert.equal(second.generation.id, first.generation.id);
  const { results } = await env.DB.prepare("SELECT COUNT(*) AS n FROM generations").all();
  assert.equal(results[0].n, 1);
});

test("one atomic admission prevents oversubscribing the allowance", async () => {
  const { env, project } = await setup({ allowance: 2_000 });
  const first = await createGeneration(env, project, imageRequest());
  assert.equal(first.created, true);
  await assert.rejects(createGeneration(env, project, imageRequest({ clientRequestId: "req_second1" })), (error) => {
    assert.equal(error.status, 402);
    assert.equal(error.code, "budget_exhausted");
    return true;
  });
  const budget = await budgetSnapshot(env, project.id);
  assert.equal(budget.reservedMicro, 1_200);
  const row = await env.DB.prepare("SELECT status FROM generations WHERE client_request_id='req_second1'").first();
  assert.equal(row.status, "failed");
});

test("saving retains one owned asset and a retry never generates again", async () => {
  const { env, project } = await setup();
  const { generation } = await createGeneration(env, project, imageRequest());
  const saved = await saveGeneration(env, generation, PNG_1x1, "png");
  assert.equal(saved.status, "saved");
  assert.ok(saved.output_asset_id);
  const again = await saveGeneration(env, generation, PNG_1x1, "png");
  assert.equal(again.status, "saved");
  assert.equal(again.output_asset_id, saved.output_asset_id);
  const assets = await env.DB.prepare("SELECT COUNT(*) AS n FROM assets").all();
  assert.equal(assets.results[0].n, 1);
  const budget = await budgetSnapshot(env, project.id);
  assert.equal(budget.spentMicro, estimateCost(getModel("studio-draft")));
  assert.equal(budget.reservedMicro, 0);
});

test("a late save cannot resurrect a deleted job or asset", async () => {
  const { env, project } = await setup();
  const { generation } = await createGeneration(env, project, imageRequest());
  await env.DB.prepare("UPDATE generations SET deleted_at=?2 WHERE id=?1").bind(generation.id, Date.now()).run();
  const result = await saveGeneration(env, generation, PNG_1x1, "png");
  assert.equal(result.status, "discarded_after_delete");
  const assets = await env.DB.prepare("SELECT COUNT(*) AS n FROM assets").all();
  assert.equal(assets.results[0].n, 0);
  const advance = await advanceGeneration(env, generation);
  assert.equal(advance.status, "discarded_after_delete");
});

test("cancelling before dispatch releases the reservation", async () => {
  const { env, project } = await setup();
  const { generation } = await createGeneration(env, project, imageRequest({ model: "studio-quick", aspect: "square" }));
  const cancelled = await cancelGeneration(env, generation);
  assert.equal(cancelled.status, "cancelled");
  const budget = await budgetSnapshot(env, project.id);
  assert.equal(budget.reservedMicro, 0);
  assert.equal(budget.spentMicro, 0);
});

test("a lost dispatch reply is unknown and keeps its reservation", async () => {
  const { env, project } = await setup();
  const { generation } = await createGeneration(env, project, imageRequest());
  await env.DB.prepare("UPDATE generations SET status='submitting', updated_at=?2 WHERE id=?1")
    .bind(generation.id, Date.now() - 600_000)
    .run();
  const advanced = await advanceGeneration(env, generation);
  assert.equal(advanced.status, "unknown");
  assert.equal(advanced.error_code, "dispatch_unknown");
  const budget = await budgetSnapshot(env, project.id);
  assert.equal(budget.reservedMicro, 1_200);
  const fresh = await loadGeneration(env, generation.id);
  assert.equal(fresh.cost_observed_micro, null);
});

test("a reference must belong to the same project and be a still", async () => {
  const { env, project } = await setup();
  const timestamp = Date.now();
  await env.DB.prepare(
    "INSERT INTO projects(id,name,slug,creative_direction,visibility,defaults_json,created_at,updated_at) VALUES('prj_other','Other','other','','private','{}',?1,?1)",
  )
    .bind(timestamp)
    .run();
  await env.DB.prepare(
    "INSERT INTO assets(id,project_id,kind,r2_key,mime,bytes,width,height,sha256,title,source,created_at,updated_at) VALUES('asset_other','prj_other','image','k','image/png',1,1,1,'h','Other','upload',?1,?1)",
  )
    .bind(timestamp)
    .run();
  await assert.rejects(
    createGeneration(env, project, imageRequest({ model: "studio-detail", aspect: "square", referenceAssetId: "asset_other" })),
    /not in this project/,
  );
});
