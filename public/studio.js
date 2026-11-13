// MIT. Media Studio client. Vanilla, same-origin, no build step.

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const confirmDialog = document.querySelector("#confirm");

const state = {
  view: "home",
  projectId: null,
  tab: "library",
  projects: [],
  project: null,
  models: [],
  recipes: [],
  videosConfigured: false,
  destinations: {},
  filter: "all",
  query: "",
  create: null,
  busy: false,
  polling: null,
};

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) =>
    character === "&" ? "&amp;" : character === "<" ? "&lt;" : character === ">" ? "&gt;" : character === '"' ? "&quot;" : "&#39;",
  );

function notify(message, tone = "ok") {
  toast.textContent = message;
  toast.hidden = false;
  toast.dataset.tone = tone;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => {
    toast.hidden = true;
  }, 5200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });
  if (response.status === 401 && !path.startsWith("/api/login")) {
    location.href = "/login";
    throw new Error("Signed out");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? `Request failed (${response.status})`);
    error.code = payload?.error?.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function money(micro) {
  const value = Number(micro ?? 0) / 1_000_000;
  return value === 0 ? "$0.00" : value < 0.01 ? `$${value.toFixed(3)}` : `$${value.toFixed(2)}`;
}

function bytesLabel(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function dateLabel(timestamp) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(timestamp));
}

function stillExtension(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function timeLabel(timestamp) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
}

function statusChip(status) {
  const map = {
    saved: ["ok", "Saved"],
    admitted: ["", "Prepared"],
    submitting: ["run", "Submitting"],
    submitted: ["run", "Submitted"],
    running: ["run", "Generating"],
    provider_complete: ["run", "Copying result"],
    saving: ["run", "Saving"],
    failed: ["bad", "Failed"],
    cancel_requested: ["unknown", "Cancel requested"],
    cancelled: ["", "Cancelled"],
    unknown: ["unknown", "Outcome unknown"],
    discarded_after_delete: ["bad", "Discarded after delete"],
  };
  const [tone, label] = map[status] ?? ["", status];
  return `<span class="status ${tone}">${esc(label)}</span>`;
}

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, "");
  if (!hash) return { view: "home" };
  const [segment, id, tab] = hash.split("/");
  if (segment === "p" && id) return { view: "project", projectId: id, tab: tab || "library" };
  if (segment === "a" && id && tab) return { view: "asset", projectId: id, assetId: tab };
  return { view: "home" };
}

async function boot() {
  const session = await api("/api/session");
  if (!session.signedIn) {
    location.href = "/login";
    return;
  }
  const data = await api("/api/state");
  state.projects = data.projects;
  state.models = data.models;
  state.recipes = data.recipes;
  state.videosConfigured = data.videosConfigured;
  state.destinations = data.destinations ?? {};
  const route = parseHash();
  state.view = route.view;
  state.projectId = route.projectId ?? null;
  state.tab = route.tab ?? "library";
  if (state.view === "project" || state.view === "asset") {
    if (state.view === "asset") state.assetId = route.assetId;
    await loadProject(state.projectId);
  }
  render();
  startPolling();
}

async function loadProject(id) {
  const data = await api(`/api/projects/${id}`);
  state.project = data.project;
  state.project.assets = data.assets;
  state.project.generations = data.generations;
  state.project.recipes = data.recipes;
  state.project.publications = data.publications;
  state.project.budget = data.budget;
  if (!state.create)
    state.create = defaultCreate();
  return data;
}

function defaultCreate() {
  const defaults = state.project?.defaults ?? {};
  const recipe = recipeBySlug("editorial-print");
  const controls = {};
  const aspectControl = recipe?.controls.find((control) => control.key === "aspect");
  return {
    recipeSlug: recipe?.slug ?? "editorial-print",
    kind: recipe?.kind ?? "image",
    model: recipe?.model ?? defaults.imageModel ?? "studio-print",
    prompt: recipe ? promptFromRecipe(recipe, controls) : "",
    aspect: aspectControl?.default ?? defaults.aspect ?? "portrait",
    durationSeconds: defaults.durationSeconds ?? 6,
    referenceAssetId: null,
    parentAssetId: null,
    controls,
  };
}

function modelById(id) {
  return state.models.find((model) => model.id === id) ?? null;
}

function recipeBySlug(slug) {
  return state.project?.recipes?.find((recipe) => recipe.slug === slug) ?? state.recipes.find((recipe) => recipe.slug === slug) ?? null;
}

function estimate() {
  const model = modelById(state.create?.model);
  if (!model) return 0;
  if (model.kind === "video" && model.costPerSecondMicro)
    return model.costPerSecondMicro * Number(state.create.durationSeconds ?? 6);
  return model.costMicro;
}

function promptFromRecipe(recipe, values) {
  return recipe.promptTemplate.replace(/\{(\w+)\}/g, (_, key) => {
    const control = recipe.controls.find((item) => item.key === key);
    return String(values[key] ?? control?.default ?? "").slice(0, 600);
  });
}

function render() {
  if (state.view === "home") {
    app.innerHTML = homeView();
  } else if (state.view === "asset") {
    app.innerHTML = assetView();
  } else {
    app.innerHTML = projectView();
    attachDropzone();
  }
}

function homeView() {
  return `
    <section class="hero-strip">
      <div>
        <p class="eyebrow">Make · keep · publish</p>
        <h1>Images and video, owned here.</h1>
        <p style="max-width:62ch">Start a studio for an idea, upload what you already have, and make new work with a funded model when it helps. Nothing is published by accident.</p>
      </div>
      <div class="card">
        <h2 style="font-size:1.1rem">What works without AI</h2>
        <p class="small">Uploads, project collections, search, download, deletion, provenance and the library itself. Generation is a separate capability with an estimate before every paid request.</p>
        <p class="small">Video generation: ${state.videosConfigured ? "configured with fal.ai; the provider checks funding on submit" : "<strong>needs a fal.ai key on this studio</strong>"}.</p>
      </div>
    </section>
    <div class="spread"><h2 style="margin:0">Your studios</h2><button class="button" data-action="new-project">New studio</button></div>
    <div class="project-grid" style="margin-top:1rem">
      ${state.projects.map(projectCard).join("")}
      <button class="project-card new-project" data-action="new-project">
        <div class="cover"><span class="empty">+</span></div>
        <div class="body"><h3>Start something new</h3><span class="small">Name it, set a direction, upload later.</span></div>
      </button>
    </div>`;
}

function projectCard(project) {
  return `<button class="project-card" data-action="open-project" data-id="${esc(project.id)}">
    <div class="cover">${project.cover ? `<img src="${esc(project.cover)}" alt="" loading="lazy">` : `<span class="empty">${esc(project.name.slice(0, 1).toUpperCase())}</span>`}</div>
    <div class="body">
      <h3>${esc(project.name)}</h3>
      <span class="small">${project.counts.image} images · ${project.counts.video} videos</span>
      <span class="small">${money(project.budget.spentMicro)} of ${money(project.budget.allowanceMicro)} used this month</span>
    </div>
  </button>`;
}

function projectView() {
  const project = state.project;
  if (!project) return `<p class="notice">Loading…</p>`;
  return `
    <div class="spread">
      <div>
        <p class="eyebrow">${esc(project.visibility === "unlisted" ? "Unlisted studio" : "Private studio")}</p>
        <h1 style="margin-bottom:0.2rem">${esc(project.name)}</h1>
        <p class="small" style="margin:0">${esc(project.creativeDirection || "No creative direction saved yet.")}</p>
      </div>
      <div class="row">
        <a class="button secondary" href="/api/projects/${esc(project.id)}/export" download>Export</a>
        <button class="button" data-action="tab" data-tab="create">Create</button>
      </div>
    </div>
    ${budgetStrip(project.budget)}
    <nav class="tabs" aria-label="Studio sections">
      ${["library", "create", "history", "publish", "settings"]
        .map((tab) => `<button role="tab" aria-selected="${state.tab === tab}" data-action="tab" data-tab="${tab}">${tab[0].toUpperCase() + tab.slice(1)}${tab === "history" && project.generations.some(isPending) ? " ·" : ""}</button>`)
        .join("")}
    </nav>
    <section role="tabpanel" aria-label="${esc(state.tab)}">
      ${state.tab === "library" ? libraryView() : ""}
      ${state.tab === "create" ? createView() : ""}
      ${state.tab === "history" ? historyView() : ""}
      ${state.tab === "publish" ? publishView() : ""}
      ${state.tab === "settings" ? settingsView() : ""}
    </section>`;
}

function budgetStrip(budget) {
  const used = budget.spentMicro + budget.reservedMicro;
  const percent = budget.allowanceMicro > 0 ? Math.min(100, Math.round((used / budget.allowanceMicro) * 100)) : 0;
  return `<div class="card" style="margin:1rem 0;padding:0.8rem 1rem">
    <div class="spread" style="margin-bottom:0.4rem">
      <span class="small"><strong>${money(budget.spentMicro)}</strong> spent · ${money(budget.reservedMicro)} reserved · ${money(budget.allowanceMicro)} monthly allowance</span>
      <span class="small">${esc(budget.period)} · ${percent}%</span>
    </div>
    <div class="meter" role="img" aria-label="${money(used)} of ${money(budget.allowanceMicro)} committed"><span style="width:${percent}%"></span></div>
    <p class="small" style="margin:0.4rem 0 0">Estimates are shown before each request. Unknown outcomes keep their reservation until the provider is reconciled.</p>
  </div>`;
}

function isPending(generation) {
  return ["admitted", "submitting", "submitted", "running", "provider_complete", "saving", "cancel_requested"].includes(generation.status);
}

function visibleAssets() {
  const query = state.query.trim().toLowerCase();
  return state.project.assets.filter((asset) => {
    if (state.filter !== "all" && asset.kind !== state.filter) return false;
    if (!query) return true;
    return `${asset.title} ${asset.caption} ${asset.mime} ${asset.source}`.toLowerCase().includes(query);
  });
}

function libraryView() {
  const assets = visibleAssets();
  const total = state.project.assets.length;
  return `
    <div class="spread">
      <div class="row">
        <label class="sr-only" for="search">Search media</label>
        <input id="search" type="search" placeholder="Search titles, captions, types…" value="${esc(state.query)}" data-input="search" style="min-width:min(320px,60vw)">
        <div class="row" role="group" aria-label="Filter">
          ${["all", "image", "video"].map((value) => `<button class="quiet" data-action="filter" data-filter="${value}" aria-pressed="${state.filter === value}">${value[0].toUpperCase() + value.slice(1)}</button>`).join("")}
        </div>
      </div>
      <label class="button secondary" for="upload" style="cursor:pointer">Upload media<input id="upload" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" hidden data-input="upload"></label>
    </div>
    <div class="dropzone" id="dropzone" style="margin:1rem 0">
      <p style="margin:0"><strong>Drop files here</strong> or use Upload media.</p>
      <p class="small" style="margin:0.3rem 0 0">JPEG, PNG, WebP, MP4 or WebM. Images up to 32 MB, video up to 64 MB.</p>
    </div>
    ${total === 0 ? `<div class="card"><h2>Nothing here yet.</h2><p>Upload a photo or a clip to start the library. You can generate new stills once uploads work.</p><button class="button" data-action="tab" data-tab="create">Make the first image</button></div>` : ""}
    ${total > 0 && assets.length === 0 ? `<p class="notice">No media matches that filter. <button class="quiet" data-action="filter" data-filter="all">Show all</button></p>` : ""}
    <div class="asset-grid">
      ${assets.map(assetCard).join("")}
    </div>`;
}

function assetCard(asset) {
  const media =
    asset.kind === "video"
      ? `<video src="${esc(asset.file)}" preload="metadata" muted playsinline aria-label="${esc(asset.title)}"></video>`
      : `<img src="${esc(asset.file)}" alt="${esc(asset.title)}" loading="lazy" decoding="async">`;
  return `<article class="asset">
    <button class="thumb" data-action="open-asset" data-id="${esc(asset.id)}" aria-label="Open ${esc(asset.title)}">${media}<span class="badge">${esc(asset.kind)}</span></button>
    <div class="meta">
      <strong title="${esc(asset.title)}">${esc(asset.title)}</strong>
      <small>${asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}${bytesLabel(asset.bytes)} · ${esc(asset.source)}</small>
    </div>
    <button data-action="open-asset" data-id="${esc(asset.id)}">Open</button>
  </article>`;
}

function createView() {
  const create = state.create;
  const recipes = state.project.recipes.filter((recipe) => recipe.kind === create.kind);
  const models = state.models.filter((model) => model.kind === create.kind && (model.references > 0 ? true : true));
  const model = modelById(create.model) ?? models[0];
  const recipe = recipeBySlug(create.recipeSlug);
  const images = state.project.assets.filter((asset) => asset.kind === "image");
  const selectedReference = images.find((asset) => asset.id === create.referenceAssetId);
  const needsReference = (model?.references ?? 0) > 0;
  const fundingBlocked = state.project.generations.some((generation) => generation.error?.code === "provider_funding");
  return `
    ${fundingBlocked ? `<p class="notice warn">The studio's video provider refused the last request for funding. Image work and the library still work; add credit to the studio's own provider account before starting another clip.</p>` : ""}
    <div class="grid two">
      <div class="card">
        <p class="eyebrow">1 · Choose a starting point</p>
        <div class="row" style="margin-bottom:0.8rem" role="group" aria-label="Media kind">
          <button class="secondary" data-action="kind" data-kind="image" aria-pressed="${create.kind === "image"}">Create image</button>
          <button class="secondary" data-action="kind" data-kind="video" aria-pressed="${create.kind === "video"}">Animate a still</button>
        </div>
        <div class="recipe-grid">
          ${recipes.map((item) => `<button class="recipe" data-action="recipe" data-slug="${esc(item.slug)}" aria-pressed="${create.recipeSlug === item.slug}"><strong>${esc(item.title)}</strong><span>${esc(item.description)}</span><span class="small">${esc(item.kind === "video" ? "Image → video" : "Still image")}</span></button>`).join("")}
        </div>
        <hr style="border:0;border-top:1px solid var(--line);margin:1rem 0">
        <div class="stack">
          <label>Model
            <select data-input="model">${models.map((item) => `<option value="${esc(item.id)}" ${item.id === create.model ? "selected" : ""}>${esc(item.label)} — ${esc(item.provider)}</option>`).join("")}</select>
          </label>
          <p class="small" style="margin:0">${esc(model?.description ?? "")}<br>${esc(model?.costBasis ?? "")}</p>
        </div>
      </div>
      <div class="card">
        <p class="eyebrow">2 · Direct the work</p>
        ${recipe ? recipeControls(recipe, create) : ""}
        <label style="margin-top:0.7rem">Prompt
          <textarea data-input="prompt" maxlength="1800" rows="6">${esc(create.prompt)}</textarea>
        </label>
        ${model?.kind === "image" ? `<label style="margin-top:0.6rem">Frame
          <select data-input="aspect">${model.aspects.map((aspect) => `<option value="${esc(aspect)}" ${create.aspect === aspect ? "selected" : ""}>${esc(aspect === "square" && model.references > 0 ? "Square variation" : aspect)}</option>`).join("")}</select>
        </label>` : ""}
        ${model?.kind === "video" ? `<label style="margin-top:0.6rem">Clip length
          <select data-input="duration">${model.durations.map((seconds) => `<option value="${seconds}" ${Number(create.durationSeconds) === seconds ? "selected" : ""}>${seconds} seconds</option>`).join("")}</select>
        </label>` : ""}
        ${needsReference ? `<div style="margin-top:0.8rem">
          <p class="small" style="margin-bottom:0.4rem"><strong>Reference still</strong> ${selectedReference ? `· ${esc(selectedReference.title)}` : "· none selected"}</p>
          <div class="row">${images.slice(0, 8).map((asset) => `<button class="quiet" data-action="pick-reference" data-id="${esc(asset.id)}" aria-pressed="${create.referenceAssetId === asset.id}" title="${esc(asset.title)}" style="padding:0;border:${create.referenceAssetId === asset.id ? "2px solid var(--accent)" : "2px solid transparent"};border-radius:8px;width:64px;height:64px;overflow:hidden"><img src="${esc(asset.file)}" alt="${esc(asset.title)}" style="width:100%;height:100%;object-fit:cover"></button>`).join("") || `<span class="small">Upload a still first.</span>`}</div>
        </div>` : ""}
      </div>
    </div>
    <div class="card" style="margin-top:1rem">
      <div class="spread">
        <div>
          <p class="eyebrow" style="margin-bottom:0.2rem">3 · Review and submit</p>
          <p class="small" style="margin:0">${esc(model?.label ?? "No model")} · ${create.kind === "video" ? `${esc(String(create.durationSeconds))}s` : esc(create.aspect)} · estimated <strong>${money(estimate())}</strong></p>
        </div>
        <button class="button" data-action="submit-create" ${needsReference && !create.referenceAssetId ? "disabled" : ""}>${create.kind === "video" ? "Animate this still" : "Create image"} · ${money(estimate())}</button>
      </div>
      <p class="small" style="margin:0.6rem 0 0">Each submit starts one new request. A repeat with the same request id is replayed, never charged twice. Video runs asynchronously; you can leave this page and come back.</p>
    </div>`;
}

function recipeControls(recipe, create) {
  return recipe.controls
    .filter((control) => control.type !== "reference" && control.application !== "provider-native")
    .map((control) => {
      const value = create.controls[control.key] ?? control.default ?? "";
      if (control.type === "select")
        return `<label>${esc(control.label)}
          <select data-input="control" data-key="${esc(control.key)}">${control.options.map((option) => `<option value="${esc(option)}" ${String(value) === option ? "selected" : ""}>${esc(option)}</option>`).join("")}</select>
        </label>`;
      if (control.type === "hidden") return "";
      return `<label>${esc(control.label)}
        <input data-input="control" data-key="${esc(control.key)}" value="${esc(value)}" maxlength="200">
      </label>`;
    })
    .join("");
}

function historyView() {
  const generations = state.project.generations;
  return `
    <div class="spread"><h2 style="margin:0">Generation history</h2><button class="button secondary" data-action="tab" data-tab="create">New request</button></div>
    <p class="small">Saved results live in the library. Failed and unknown outcomes keep their exact request, cost state and recovery options.</p>
    <div class="stack" style="margin-top:0.8rem">
      ${generations.length === 0 ? `<div class="card"><p style="margin:0">No requests yet.</p></div>` : ""}
      ${generations.map(jobCard).join("")}
    </div>`;
}

function jobCard(generation) {
  const model = modelById(generation.model);
  const asset = state.project.assets.find((item) => item.id === generation.assetId);
  const pending = isPending(generation);
  const canCancel = ["admitted", "submitting", "submitted", "running"].includes(generation.status);
  const canRetrySave = ["provider_complete", "saving"].includes(generation.status);
  return `<article class="job" data-job="${esc(generation.id)}">
    <header>
      <div class="row">${statusChip(generation.status)}<strong>${esc(model?.label ?? generation.model)}</strong><span class="small">${esc(generation.kind)} · ${dateLabel(generation.createdAt)} ${timeLabel(generation.createdAt)}</span></div>
      <span class="small">${money(generation.costObservedMicro ?? generation.costEstimateMicro)}</span>
    </header>
    <p class="prompt">${esc(generation.prompt)}</p>
    <p class="small">${esc(generation.aspect ?? "")} ${generation.durationSeconds ? `· ${generation.durationSeconds}s` : ""} ${generation.error ? `· ${esc(generation.error.message)}` : ""}</p>
    ${asset ? `<div class="result">${asset.kind === "video" ? `<video src="${esc(asset.file)}" controls preload="metadata"></video>` : `<img src="${esc(asset.file)}" alt="${esc(asset.title)}" loading="lazy">`}</div>` : ""}
    <div class="row">
      ${asset ? `<button class="secondary" data-action="open-asset" data-id="${esc(asset.id)}">Open result</button><button class="secondary" data-action="reuse-job" data-id="${esc(generation.id)}">Reuse settings</button>` : ""}
      ${pending && generation.kind === "video" ? `<button class="secondary" data-action="refresh-job" data-id="${esc(generation.id)}">Refresh</button>` : ""}
      ${canCancel ? `<button class="secondary" data-action="cancel-job" data-id="${esc(generation.id)}">Cancel</button>` : ""}
      ${canRetrySave ? `<button data-action="save-retry" data-id="${esc(generation.id)}">Retry saving</button>` : ""}
      ${generation.status === "unknown" ? `<button class="secondary" data-action="reconcile-job" data-id="${esc(generation.id)}">Reconcile</button>` : ""}
      ${!pending && !asset ? `<button class="quiet" data-action="delete-job" data-id="${esc(generation.id)}">Remove from history</button>` : ""}
    </div>
  </article>`;
}

function publishView() {
  const publications = state.project.publications;
  return `
    <div class="spread"><h2 style="margin:0">Published pages</h2><button class="button" data-action="choose-publish">Publish a piece</button></div>
    <p class="small">Publishing creates a public page with only the title, description and media. Prompts, other projects and private filenames stay private. Withdrawal stops new visits; downloads already taken cannot be recalled.</p>
    <div class="stack" style="margin-top:0.8rem">
      ${publications.length === 0 ? `<div class="card"><p style="margin:0">Nothing published yet.</p></div>` : ""}
      ${publications
        .map((publication) => `<article class="job">
          <header><strong>${esc(publication.title)}</strong><span class="small">${dateLabel(publication.createdAt)}</span></header>
          <p class="small"><a href="${esc(publication.path)}" target="_blank" rel="noopener">${esc(location.origin + publication.path)}</a></p>
          <div class="row"><a class="button secondary" href="${esc(publication.path)}" target="_blank" rel="noopener">Open page</a><button class="quiet" data-action="revoke" data-id="${esc(publication.id)}">Withdraw</button></div>
        </article>`)
        .join("")}
    </div>`;
}

function settingsView() {
  const project = state.project;
  const references = project.references ?? [];
  return `
    <form class="grid two" data-form="settings">
      <div class="card stack">
        <p class="eyebrow">Studio</p>
        <label>Name<input name="name" value="${esc(project.name)}" maxlength="80" required></label>
        <label>Creative direction<textarea name="creativeDirection" maxlength="600" rows="4">${esc(project.creativeDirection)}</textarea></label>
        <label>Visibility
          <select name="visibility">
            <option value="private" ${project.visibility === "private" ? "selected" : ""}>Private — only this studio</option>
            <option value="unlisted" ${project.visibility === "unlisted" ? "selected" : ""}>Unlisted — reachable with its link</option>
          </select>
        </label>
        <p class="small">Visibility applies to the studio itself, not to published pieces. Published pages are public until withdrawn.</p>
        <button class="button" type="submit">Save studio</button>
      </div>
      <div class="card stack">
        <p class="eyebrow">Creative references</p>
        <p class="small" style="margin:0">Links to work that informs this studio. They are notes for you and your agent, never fetched or executed.</p>
        <div id="references">
          ${references.length === 0 ? `<p class="small">No references yet.</p>` : ""}
          ${references.map((reference) => `<div class="row" style="justify-content:space-between;border-top:1px solid var(--line);padding-top:0.5rem"><span><strong>${esc(reference.title)}</strong><br><a href="${esc(reference.url)}" target="_blank" rel="noopener noreferrer" class="small">${esc(reference.url)}</a></span><button class="quiet" data-action="remove-reference" data-id="${esc(reference.id)}" type="button">Remove</button></div>`).join("")}
        </div>
        <div class="row"><input name="referenceTitle" placeholder="Reference title" maxlength="100"><input name="referenceUrl" type="url" placeholder="https://…"><button class="secondary" type="button" data-action="add-reference">Add</button></div>
        <hr style="border:0;border-top:1px solid var(--line);margin:0.5rem 0">
        <p class="small">Ownership: this studio owns its D1 metadata, R2 media and provider keys. Export downloads the project record, prompts and lineage without secrets. Media files download separately while they still exist.</p>
        <a class="button secondary" href="/api/projects/${esc(project.id)}/export" download>Download project export</a>
      </div>
    </form>`;
}

function assetView() {
  const asset = state.project?.assets.find((item) => item.id === state.assetId);
  if (!asset) return `<p class="notice">That asset is no longer in the library. <a href="#/p/${esc(state.projectId)}/library">Back to the library</a>.</p>`;
  const isVideo = asset.kind === "video";
  // The server resolves this from stored same-project relationships; the client
  // never guesses a poster from a filename or title.
  const still = asset.reuseStillId ? state.project.assets.find((item) => item.id === asset.reuseStillId) : null;
  const launchKitUrl = state.destinations?.launchKitUrl ?? null;
  const launchKitSource = still
    ? `<div class="stack" style="border-top:1px solid var(--line);padding-top:0.8rem">
        <p class="eyebrow" style="margin:0">Launch Kit source</p>
        <div class="row">
          <a class="button secondary" href="${esc(still.download)}" download="launch-kit-source-${esc(still.id)}.${esc(stillExtension(still.mime))}">${isVideo ? "Download poster for Launch Kit" : "Download for Launch Kit"}</a>
          ${launchKitUrl ? `<a class="button secondary" href="${esc(launchKitUrl)}" target="_blank" rel="noopener noreferrer">Open Launch Kit</a>` : ""}
        </div>
        <p class="small" style="margin:0">${
          isVideo
            ? `1. Download the poster still${still.title ? ` “${esc(still.title)}”` : ""}. 2. Import that still into Launch Kit. The clip stays here; only the still becomes the source artwork.`
            : "1. Download the still. 2. Import it into Launch Kit as the source artwork. Finishing and export stay in Launch Kit."
        }${launchKitUrl ? "" : " Open your own Launch Kit installation to import it."}</p>
      </div>`
    : `<p class="notice" style="font-size:0.84rem">${
        isVideo
          ? "This clip has no retained poster or source still, so it cannot supply Launch Kit artwork or a variation reference. Choose a still in the library instead."
          : "This file type cannot be imported into Launch Kit or used as a variation reference. Upload a JPEG, PNG or WebP still."
      }${isVideo ? ` <button class="quiet" data-action="choose-still">Choose a still</button>` : ""}</p>`;
  return `
    <p class="small"><a href="#/p/${esc(state.projectId)}/library">← Back to ${esc(state.project.name)}</a></p>
    <div class="viewer">
      <div class="stage">${isVideo ? `<video src="${esc(asset.file)}" controls playsinline preload="metadata"></video>` : `<img src="${esc(asset.file)}" alt="${esc(asset.title)}">`}</div>
      <aside class="card stack">
        <div><p class="eyebrow">${esc(asset.kind)} · ${esc(asset.source)}</p><h1 style="font-size:1.7rem">${esc(asset.title)}</h1></div>
        ${asset.caption ? `<p>${esc(asset.caption)}</p>` : ""}
        <dl class="kv">
          <dt>Size</dt><dd>${bytesLabel(asset.bytes)}</dd>
          ${asset.width ? `<dt>Frame</dt><dd>${asset.width} × ${asset.height}</dd>` : ""}
          ${asset.durationMs ? `<dt>Duration</dt><dd>${(asset.durationMs / 1000).toFixed(1)}s</dd>` : ""}
          <dt>Type</dt><dd>${esc(asset.mime)}</dd>
          <dt>Added</dt><dd>${dateLabel(asset.createdAt)}</dd>
          <dt>SHA-256</dt><dd style="word-break:break-all;font-size:0.72rem">${esc(asset.sha256)}</dd>
        </dl>
        <div class="row">
          <a class="button secondary" href="${esc(asset.download)}" download>Download</a>
          <button class="secondary" data-action="rename-asset" data-id="${esc(asset.id)}">Rename</button>
          ${still ? `<button class="secondary" data-action="vary-asset" data-id="${esc(still.id)}">${isVideo ? "Make a variation of its still" : "Make a variation"}</button>` : ""}
        </div>
        <div class="row">
          <button class="secondary" data-action="animate-asset" data-id="${esc(asset.id)}" ${isVideo ? "disabled" : ""}>Animate this still</button>
          <button class="secondary" data-action="publish-asset" data-id="${esc(asset.id)}">Publish page</button>
        </div>
        ${launchKitSource}
        ${isVideo && still ? `<p class="small" style="margin:0">A variation uses “${esc(still.title)}”, the still, not this clip.</p>` : ""}
        <button class="quiet" data-action="delete-asset" data-id="${esc(asset.id)}">Delete from library</button>
      </aside>
    </div>`;
}

/* ---------- dialogs ---------- */

function ask({ title, copy, fields = [], submit = "Continue" }) {
  return new Promise((resolve) => {
    confirmDialog.querySelector("#confirm-title").textContent = title;
    confirmDialog.querySelector("#confirm-copy").innerHTML = `
      <p class="small">${copy}</p>
      ${fields
        .map(
          (field) =>
            `<label style="margin-top:0.6rem">${esc(field.label)}${field.type === "textarea" ? `<textarea name="${esc(field.name)}" maxlength="${field.maxlength ?? 400}" rows="3">${esc(field.value ?? "")}</textarea>` : `<input name="${esc(field.name)}" type="${esc(field.type ?? "text")}" value="${esc(field.value ?? "")}" maxlength="${field.maxlength ?? 200}" ${field.required ? "required" : ""}>`}</label>`,
        )
        .join("")}`;
    const form = confirmDialog.querySelector("#confirm-form");
    form.querySelector('button[value="ok"]').textContent = submit;
    const finish = (value) => {
      confirmDialog.close();
      confirmDialog.removeEventListener("close", onClose);
      resolve(value);
    };
    const onClose = () => {
      const data = new FormData(form);
      if (confirmDialog.returnValue === "ok") {
        const values = {};
        for (const field of fields) values[field.name] = String(data.get(field.name) ?? "");
        finish(values);
      } else finish(null);
    };
    confirmDialog.addEventListener("close", onClose);
    confirmDialog.showModal();
  });
}

async function confirmAction(title, copy, label = "Continue", dangerous = false) {
  const ok = await ask({ title, copy, submit: label });
  return Boolean(ok);
}

/* ---------- actions ---------- */

async function handleAction(action, element) {
  const id = element.dataset.id;
  switch (action) {
    case "new-project": {
      const values = await ask({
        title: "Start a studio",
        copy: "Name it and give it a direction. You can change both later.",
        fields: [
          { name: "name", label: "Studio name", value: "", required: true, maxlength: 80 },
          { name: "creativeDirection", label: "Creative direction", type: "textarea", value: "", maxlength: 600 },
        ],
        submit: "Create studio",
      });
      if (!values) return;
      const result = await api("/api/projects", { method: "POST", body: JSON.stringify(values) });
      state.projects.unshift(result.project);
      location.hash = `#/p/${result.project.id}/library`;
      return;
    }
    case "open-project":
      location.hash = `#/p/${id}/library`;
      return;
    case "tab":
      state.tab = element.dataset.tab;
      location.hash = `#/p/${state.projectId}/${state.tab}`;
      return;
    case "filter":
      state.filter = element.dataset.filter;
      render();
      return;
    case "kind": {
      state.create.kind = element.dataset.kind;
      const recipes = state.project.recipes.filter((recipe) => recipe.kind === state.create.kind);
      state.create.recipeSlug = recipes[0]?.slug ?? state.create.recipeSlug;
      const recipe = recipeBySlug(state.create.recipeSlug);
      if (recipe) {
        state.create.controls = {};
        state.create.prompt = promptFromRecipe(recipe, {});
        state.create.model = recipe.kind === "video" ? (state.project.defaults.videoModel ?? "hailuo-standard") : (recipe.model ?? "studio-draft");
      }
      render();
      return;
    }
    case "recipe": {
      const recipe = recipeBySlug(element.dataset.slug);
      if (!recipe) return;
      state.create.recipeSlug = recipe.slug;
      state.create.kind = recipe.kind;
      state.create.controls = {};
      state.create.prompt = promptFromRecipe(recipe, {});
      state.create.model = recipe.model ?? state.create.model;
      const aspectControl = recipe.controls.find((control) => control.key === "aspect");
      if (aspectControl?.default) state.create.aspect = aspectControl.default;
      const durationControl = recipe.controls.find((control) => control.key === "duration");
      if (durationControl?.default) state.create.durationSeconds = Number(durationControl.default);
      render();
      return;
    }
    case "pick-reference":
      state.create.referenceAssetId = id;
      render();
      return;
    case "submit-create":
      await submitCreate();
      return;
    case "open-asset":
      location.hash = `#/a/${state.projectId}/${id}`;
      return;
    case "refresh-job":
      await refreshGeneration(id, true);
      return;
    case "cancel-job": {
      if (!(await confirmAction("Cancel this request?", "The provider must confirm. A local cancellation is not a refund; work already running can still finish or remain billable.", "Ask the provider to cancel"))) return;
      await api(`/api/generations/${id}/cancel`, { method: "POST", body: "{}" });
      await refreshGeneration(id, true);
      notify("Cancellation requested. The status shows what the provider confirmed.");
      return;
    }
    case "save-retry": {
      const result = await api(`/api/generations/${id}/save-retry`, { method: "POST", body: "{}" });
      replaceGeneration(result.generation);
      notify("Saved the retained result without generating again.");
      await loadProject(state.projectId);
      render();
      return;
    }
    case "reconcile-job": {
      const result = await api(`/api/generations/${id}/reconcile`, { method: "POST", body: "{}" });
      replaceGeneration(result.generation);
      notify(result.generation.status === "unknown" ? "Still unknown. No new request was sent." : `Provider status: ${result.generation.status}.`);
      render();
      return;
    }
    case "delete-job": {
      if (!(await confirmAction("Remove this request from history?", "The record is kept as a tombstone so a late provider result cannot reappear. Retained bytes are deleted.", "Remove", true))) return;
      await api(`/api/generations/${id}`, { method: "DELETE" });
      state.project.generations = state.project.generations.filter((item) => item.id !== id);
      render();
      return;
    }
    case "reuse-job": {
      const generation = state.project.generations.find((item) => item.id === id);
      if (!generation) return;
      state.create = {
        ...state.create,
        kind: generation.kind,
        model: generation.model,
        prompt: generation.prompt,
        aspect: generation.aspect ?? state.create.aspect,
        durationSeconds: generation.durationSeconds ?? state.create.durationSeconds,
        referenceAssetId: generation.referenceAssetId,
        parentAssetId: null,
      };
      state.tab = "create";
      location.hash = `#/p/${state.projectId}/create`;
      render();
      return;
    }
    case "rename-asset": {
      const asset = state.project.assets.find((item) => item.id === id);
      const values = await ask({
        title: "Rename this media",
        copy: "The file name and hash stay the same.",
        fields: [
          { name: "title", label: "Title", value: asset.title, required: true, maxlength: 100 },
          { name: "caption", label: "Caption", type: "textarea", value: asset.caption, maxlength: 400 },
        ],
        submit: "Save",
      });
      if (!values) return;
      const result = await api(`/api/assets/${id}`, { method: "PATCH", body: JSON.stringify(values) });
      Object.assign(asset, result.asset);
      render();
      return;
    }
    case "vary-asset": {
      const source = state.project.assets.find((item) => item.id === id);
      if (!source || source.kind !== "image") {
        notify("A variation needs a still reference.", "bad");
        return;
      }
      state.create = {
        ...defaultCreate(),
        kind: "image",
        model: "studio-detail",
        aspect: "square",
        recipeSlug: "reference-variation",
        referenceAssetId: source.id,
        parentAssetId: source.id,
        controls: {},
      };
      const recipe = recipeBySlug("reference-variation");
      state.create.prompt = promptFromRecipe(recipe, {});
      state.tab = "create";
      location.hash = `#/p/${state.projectId}/create`;
      render();
      return;
    }
    case "animate-asset": {
      const source = state.project.assets.find((item) => item.id === id);
      if (!source || source.kind !== "image") {
        notify("Choose a still to animate.", "bad");
        return;
      }
      state.create = {
        ...defaultCreate(),
        kind: "video",
        model: state.project.defaults.videoModel ?? "hailuo-standard",
        recipeSlug: "animate-a-still",
        referenceAssetId: source.id,
        durationSeconds: 6,
        controls: { motion: "slow push in" },
      };
      const recipe = recipeBySlug("animate-a-still");
      state.create.prompt = promptFromRecipe(recipe, state.create.controls);
      state.tab = "create";
      location.hash = `#/p/${state.projectId}/create`;
      render();
      return;
    }
    case "choose-still":
      state.filter = "image";
      state.query = "";
      state.tab = "library";
      location.hash = `#/p/${state.projectId}/library`;
      return;
    case "publish-asset":
      await publishAsset(id);
      return;
    case "choose-publish": {
      const assets = state.project.assets;
      if (!assets.length) {
        notify("Upload or generate something first.");
        return;
      }
      const values = await ask({
        title: "Publish a piece",
        copy: "Only the title, description and media become public. Choose an asset by its title.",
        fields: [
          { name: "assetTitle", label: `Asset (one of: ${assets.slice(0, 6).map((asset) => asset.title).join(" · ")})`, value: assets[0].title, required: true },
          { name: "title", label: "Public title", value: assets[0].title, required: true, maxlength: 100 },
          { name: "description", label: "Public description", type: "textarea", value: "", maxlength: 300 },
        ],
        submit: "Publish",
      });
      if (!values) return;
      const asset = assets.find((item) => item.title === values.assetTitle);
      if (!asset) {
        notify("That title did not match an asset. Open the asset and use Publish page.", "bad");
        return;
      }
      await publishAsset(asset.id, values.title, values.description);
      return;
    }
    case "revoke": {
      if (!(await confirmAction("Withdraw this page?", "New visits stop immediately. Copies already downloaded cannot be recalled.", "Withdraw", true))) return;
      await api(`/api/publications/${id}`, { method: "DELETE" });
      state.project.publications = state.project.publications.filter((item) => item.id !== id);
      render();
      notify("Page withdrawn.");
      return;
    }
    case "delete-asset": {
      if (!(await confirmAction("Delete this media?", "Published pages using it are withdrawn. The bytes are removed from this studio. A late generation result cannot bring it back.", "Delete", true))) return;
      await api(`/api/assets/${id}`, { method: "DELETE" });
      state.project.assets = state.project.assets.filter((item) => item.id !== id);
      state.project.publications = state.project.publications.filter((item) => item.assetId !== id);
      location.hash = `#/p/${state.projectId}/library`;
      notify("Media deleted.");
      return;
    }
    case "add-reference": {
      const form = document.querySelector('[data-form="settings"]');
      const title = form.querySelector('[name="referenceTitle"]').value.trim();
      const url = form.querySelector('[name="referenceUrl"]').value.trim();
      if (!title || !url) {
        notify("Give the reference a title and an HTTPS link.", "bad");
        return;
      }
      const references = [...(state.project.references ?? []), { id: `ref_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`, title, url, note: "" }];
      await saveSettings({ references });
      notify("Reference added.");
      render();
      return;
    }
    case "remove-reference": {
      const references = (state.project.references ?? []).filter((reference) => reference.id !== id);
      await saveSettings({ references });
      render();
      return;
    }
    case "open-asset-link":
      location.hash = `#/a/${state.projectId}/${id}`;
      return;
    default:
      return;
  }
}

function replaceGeneration(generation) {
  const index = state.project.generations.findIndex((item) => item.id === generation.id);
  if (index >= 0) state.project.generations[index] = generation;
}

async function saveSettings(overrides = {}) {
  const form = document.querySelector('[data-form="settings"]');
  const payload = {
    name: form?.querySelector('[name="name"]')?.value ?? state.project.name,
    creativeDirection: form?.querySelector('[name="creativeDirection"]')?.value ?? state.project.creativeDirection,
    visibility: form?.querySelector('[name="visibility"]')?.value ?? state.project.visibility,
    references: state.project.references ?? [],
    ...overrides,
  };
  const result = await api(`/api/projects/${state.projectId}`, { method: "PATCH", body: JSON.stringify(payload) });
  Object.assign(state.project, result.project);
  state.projects = state.projects.map((project) => (project.id === state.project.id ? { ...project, ...result.project } : project));
}

async function submitCreate() {
  const create = state.create;
  const model = modelById(create.model);
  if (!create.prompt.trim()) {
    notify("Describe what you want to create.", "bad");
    return;
  }
  if ((model?.references ?? 0) > 0 && !create.referenceAssetId) {
    notify("Choose the reference still first.", "bad");
    return;
  }
  const ok = await confirmAction(
    `Start one new ${create.kind === "video" ? "video" : "image"} request?`,
    `${model.label} · ${create.kind === "video" ? `${create.durationSeconds}s` : create.aspect} · estimated ${money(estimate())}. This can incur provider charges. Repeating the same request replays it instead of billing twice.`,
    `Create · ${money(estimate())}`,
  );
  if (!ok) return;

  const clientRequestId = `req_${crypto.randomUUID().replaceAll("-", "")}`;
  const result = await api(`/api/projects/${state.projectId}/generations`, {
    method: "POST",
    body: JSON.stringify({
      kind: create.kind,
      model: create.model,
      recipeId: create.recipeSlug,
      prompt: create.prompt,
      aspect: create.kind === "image" ? create.aspect : "from-image",
      durationSeconds: create.kind === "video" ? Number(create.durationSeconds) : undefined,
      referenceAssetId: create.referenceAssetId,
      parentAssetId: create.parentAssetId,
      clientRequestId,
    }),
  });
  state.project.budget = result.budget;
  state.project.generations.unshift(result.generation);
  if (result.generation.status === "saved") await loadProject(state.projectId);
  state.tab = "history";
  location.hash = `#/p/${state.projectId}/history`;
  render();
  if (result.generation.status === "saved") notify("Created and saved. The result is in your library.");
  else notify("Request submitted. You can leave this page; progress is saved.");
  startPolling();
}

async function publishAsset(assetId, title, description) {
  const asset = state.project.assets.find((item) => item.id === assetId);
  if (!asset) return;
  const values = await ask({
    title: "Publish this piece",
    copy: "A public page is created with only the title, description and media. You can withdraw it later.",
    fields: [
      { name: "title", label: "Public title", value: title ?? asset.title, required: true, maxlength: 100 },
      { name: "description", label: "Public description", type: "textarea", value: description ?? asset.caption, maxlength: 300 },
      ...(asset.kind === "video" && asset.parentAssetId
        ? [{ name: "posterAssetId", label: "Poster asset id (leave as is)", value: asset.parentAssetId, maxlength: 80 }]
        : []),
    ],
    submit: "Publish",
  });
  if (!values) return;
  const result = await api(`/api/assets/${assetId}/publish`, {
    method: "POST",
    body: JSON.stringify({
      title: values.title,
      description: values.description,
      posterAssetId: values.posterAssetId || undefined,
    }),
  });
  await loadProject(state.projectId);
  state.tab = "publish";
  location.hash = `#/p/${state.projectId}/publish`;
  render();
  notify(`Published at ${result.publication.path}`);
}

async function refreshGeneration(id, manual = false) {
  const result = await api(`/api/generations/${id}`);
  replaceGeneration(result.generation);
  state.project.budget = result.budget;
  const card = document.querySelector(`[data-job="${id}"]`);
  if (card) card.outerHTML = jobCard(result.generation);
  if (manual) notify(`Status: ${result.generation.status}`);
  if (result.generation.status === "saved") {
    await loadProject(state.projectId);
    if (!isTyping()) render();
    notify("Result saved to the library.");
  }
  return result.generation;
}

function isTyping() {
  const active = document.activeElement;
  return active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
}

function startPolling() {
  clearInterval(state.polling);
  state.polling = setInterval(async () => {
    if (!state.project) return;
    const pending = state.project.generations.filter(isPending);
    if (!pending.length) return;
    for (const generation of pending.slice(0, 4)) {
      try {
        await refreshGeneration(generation.id);
      } catch {
        /* transient; next tick */
      }
    }
  }, 4000);
}

/* ---------- uploads ---------- */

function uploadFile(file) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.set("file", file);
    form.set("title", file.name.replace(/\.[^.]+$/, "").slice(0, 100));
    const request = new XMLHttpRequest();
    request.open("POST", `/api/projects/${state.projectId}/assets`);
    request.withCredentials = true;
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable)
        notify(`Uploading ${Math.round((event.loaded / event.total) * 100)}%…`);
    });
    request.addEventListener("load", () => {
      let payload = {};
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        /* handled below */
      }
      if (request.status >= 200 && request.status < 300) resolve(payload);
      else reject(new Error(payload?.error?.message ?? `Upload failed (${request.status})`));
    });
    request.addEventListener("error", () => reject(new Error("Upload failed. Check the connection and try again.")));
    request.send(form);
  });
}

async function uploadFiles(files) {
  const list = [...files];
  if (!list.length) return;
  for (const file of list) {
    try {
      const result = await uploadFile(file);
      state.project.assets.unshift(result.asset);
      notify(`Added ${result.asset.title}.`);
    } catch (error) {
      notify(error.message, "bad");
    }
  }
  render();
}

function attachDropzone() {
  const zone = document.querySelector("#dropzone");
  if (!zone) return;
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("drag");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("drag");
    uploadFiles(event.dataTransfer.files);
  });
}

/* ---------- events ---------- */

app.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  event.preventDefault();
  try {
    await handleAction(target.dataset.action, target);
  } catch (error) {
    if (error.message !== "Signed out") notify(error.message, "bad");
  }
});

app.addEventListener("change", async (event) => {
  const input = event.target.closest("[data-input]");
  if (!input) return;
  const kind = input.dataset.input;
  if (kind === "upload") {
    await uploadFiles(input.files);
    return;
  }
  if (kind === "search") return;
  if (kind === "model") {
    state.create.model = input.value;
    const model = modelById(input.value);
    if (model.kind === "image" && !model.aspects.includes(state.create.aspect))
      state.create.aspect = model.aspects[0];
    if (model.kind === "video" && !model.durations.includes(Number(state.create.durationSeconds)))
      state.create.durationSeconds = model.durations[0];
    if ((model.references ?? 0) === 0) state.create.referenceAssetId = null;
    render();
    return;
  }
  if (kind === "aspect") {
    state.create.aspect = input.value;
    return;
  }
  if (kind === "duration") {
    state.create.durationSeconds = Number(input.value);
    render();
    return;
  }
  if (kind === "prompt") {
    state.create.prompt = input.value;
    return;
  }
  if (kind === "control") {
    state.create.controls[input.dataset.key] = input.value;
    const recipe = recipeBySlug(state.create.recipeSlug);
    if (recipe) state.create.prompt = promptFromRecipe(recipe, state.create.controls);
    const prompt = document.querySelector('[data-input="prompt"]');
    if (prompt) prompt.value = state.create.prompt;
    return;
  }
});

app.addEventListener("input", (event) => {
  const input = event.target.closest("[data-input]");
  if (!input) return;
  if (input.dataset.input === "search") {
    state.query = input.value;
    const grid = document.querySelector(".asset-grid");
    if (grid) grid.innerHTML = visibleAssets().map(assetCard).join("");
  }
  if (input.dataset.input === "prompt") state.create.prompt = input.value;
  if (input.dataset.input === "control") {
    state.create.controls[input.dataset.key] = input.value;
    const recipe = recipeBySlug(state.create.recipeSlug);
    if (recipe) {
      state.create.prompt = promptFromRecipe(recipe, state.create.controls);
      const prompt = document.querySelector('[data-input="prompt"]');
      if (prompt) prompt.value = state.create.prompt;
    }
  }
});

app.addEventListener("submit", async (event) => {
  const form = event.target.closest('[data-form="settings"]');
  if (!form) return;
  event.preventDefault();
  try {
    await saveSettings();
    await loadProject(state.projectId);
    render();
    notify("Studio saved.");
  } catch (error) {
    notify(error.message, "bad");
  }
});

document.querySelector("#signout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  location.href = "/login";
});

window.addEventListener("hashchange", async () => {
  const route = parseHash();
  state.view = route.view;
  state.projectId = route.projectId ?? null;
  state.tab = route.tab ?? "library";
  if (route.view === "asset") state.assetId = route.assetId;
  if (route.view === "home") {
    const data = await api("/api/state");
    state.projects = data.projects;
    render();
    return;
  }
  if (!state.project || state.project.id !== state.projectId) await loadProject(state.projectId);
  render();
});

boot().catch((error) => {
  if (error.message === "Signed out") return;
  app.innerHTML = `<div class="card"><h1>Something went wrong</h1><p>${esc(error.message)}</p><button class="button" onclick="location.reload()">Try again</button></div>`;
});
