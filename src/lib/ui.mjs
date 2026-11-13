// MIT. Server-rendered shells. The studio itself is progressive, same-origin JS.

import { escapeHtml } from "./util.mjs";

const mark = `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><rect x="4" y="4" width="40" height="40" rx="8" fill="#252923"/><path d="M11 34h26" stroke="#f4f0e8" stroke-width="2" stroke-linecap="round"/><circle cx="24" cy="22" r="9" fill="none" stroke="#f4f0e8" stroke-width="2"/><path d="M15 22a9 9 0 0 1 18 0" fill="#d95022"/><circle cx="24" cy="22" r="3.2" fill="#f4f0e8"/></svg>`;

const styles = "/studio.css";

function head({
  title,
  description,
  image,
  imageAlt,
  imageType,
  imageWidth,
  imageHeight,
  url,
  kind = "website",
  extra = "",
}) {
  const hasImage = Boolean(image);
  const width = Number.isInteger(imageWidth) && imageWidth > 0 ? imageWidth : null;
  const height = Number.isInteger(imageHeight) && imageHeight > 0 ? imageHeight : null;
  const type = typeof imageType === "string" && imageType.startsWith("image/") ? imageType : null;
  const alt = imageAlt || title;
  const imageTags = hasImage
    ? [
        `<meta property="og:image" content="${escapeHtml(image)}">`,
        type ? `<meta property="og:image:type" content="${escapeHtml(type)}">` : "",
        width ? `<meta property="og:image:width" content="${width}">` : "",
        height ? `<meta property="og:image:height" content="${height}">` : "",
        `<meta property="og:image:alt" content="${escapeHtml(alt)}">`,
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const twitter = [
    `<meta name="twitter:card" content="${hasImage ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    hasImage ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : "",
    hasImage ? `<meta name="twitter:image:alt" content="${escapeHtml(alt)}">` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="theme-color" content="#f4f0e8">
<link rel="icon" href="/mark.svg" type="image/svg+xml">
<link rel="stylesheet" href="${styles}">
${imageTags}
<meta property="og:type" content="${kind}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
${url ? `<meta property="og:url" content="${escapeHtml(url)}"><link rel="canonical" href="${escapeHtml(url)}">` : ""}
${twitter}
${extra}
</head>`;
}

export function shell({ revision }) {
  return `${head({
    title: "Media Studio — make, assemble and keep images, video and sound",
    description:
      "An independent studio for uploads, image generation, reference variations, image-to-video, generated music and narration, bounded assembly, saved compositions and deliberate publishing.",
    extra: `<meta name="robots" content="noindex">`,
  })}
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <a class="wordmark" href="#/" aria-label="Media Studio home">${mark}<span>Media Studio</span><span class="brand-by">App Composer</span></a>
  <nav class="header-nav" aria-label="Studio">
    <a href="#/">Projects</a>
    <a href="/help" target="_blank" rel="noopener">Help</a>
    <button class="quiet" id="signout" type="button">Sign out</button>
  </nav>
</header>
<main id="main" tabindex="-1">
  <div id="app">
    <p class="notice calm">Loading your studio…</p>
  </div>
  <noscript><p class="notice warn">Media Studio needs JavaScript for the studio screens. Published pages still work without it.</p></noscript>
</main>
<div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
<dialog id="confirm" aria-labelledby="confirm-title">
  <form method="dialog" class="dialog-body" id="confirm-form">
    <h2 id="confirm-title">Confirm</h2>
    <div id="confirm-copy"></div>
    <div class="row end">
      <button value="cancel" class="secondary">Keep editing</button>
      <button value="ok" class="button">Continue</button>
    </div>
  </form>
</dialog>
<script type="module" src="/studio.js?v=${encodeURIComponent(revision)}"></script>
</body>
</html>`;
}

export function loginPage({ next = "/", revision = "dev", bridged = false }) {
  return `${head({
    title: "Sign in — Media Studio",
    description: "Owner sign-in for an independent Media Studio.",
    extra: `<meta name="robots" content="noindex">`,
  })}
<body>
<div class="login">
  <main class="card" id="main">
    <div class="mark">${mark}</div>
    <div>
      <p class="eyebrow">${bridged ? "App Composer · Media Studio" : "Independent studio"}</p>
      <h1 style="font-size:2rem">Your media, kept here.</h1>
    </div>
    <p>Upload and organise images and video, make new work with a funded model, and publish deliberately. Uploads and the library work without any AI account.</p>
    ${bridged ? `<p class="notice calm">Open this studio from App Composer. Your existing Composer sign-in carries you in; there is no second password.</p>
    <p><a class="button" href="https://composer.loftwah.com/media-studio/studio">Continue with App Composer</a></p>
    <details><summary>Standalone owner sign-in</summary>` : ""}
    <form id="login-form" class="stack">
      <label>Owner passphrase
        <input name="username" type="text" autocomplete="username" value="owner" hidden>
        <input name="passphrase" type="password" autocomplete="current-password" required minlength="16" autofocus>
      </label>
      <input type="hidden" name="next" value="${escapeHtml(next)}">
      <button class="button" type="submit">${bridged ? "Sign in with the owner passphrase" : "Open the studio"}</button>
      <p class="small" role="status" id="login-status"></p>
    </form>
    ${bridged ? "</details>" : ""}
    <p class="small">This studio belongs to its own Cloudflare account and stores media in its own R2 bucket. It does not use your App Composer password.</p>
  </main>
</div>
<script type="module" src="/login.js?v=${encodeURIComponent(revision)}"></script>
</body>
</html>`;
}

export function publicPage({
  title,
  description,
  kind,
  mime,
  width,
  height,
  durationMs,
  bytes,
  media,
  download,
  poster,
  posterMime,
  posterWidth,
  posterHeight,
  buildUrl,
  storyUrl,
  origin,
  slug,
}) {
  const url = `${origin}/p/${slug}`;
  const isVideo = kind === "video";
  const isAudio = kind === "audio";
  const dimensions = width && height ? `${width} × ${height}` : null;
  const duration = durationMs ? `${(durationMs / 1000).toFixed(1)}s` : null;
  const size = bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : null;
  const facts = [dimensions, duration, size, mime].filter(Boolean).join(" · ");
  const ogImage = isVideo ? poster : isAudio ? null : media;
  const ogImageUrl = ogImage ? `${origin}${ogImage}` : null;
  const ogImageMime = isVideo ? posterMime : mime;
  const ogImageWidth = isVideo ? posterWidth : width;
  const ogImageHeight = isVideo ? posterHeight : height;
  const actions = [
    buildUrl
      ? `<a class="button" href="${escapeHtml(buildUrl)}">Build your own Media Studio</a>`
      : "",
    storyUrl
      ? `<a class="button secondary" href="${escapeHtml(storyUrl)}">See how this was made</a>`
      : "",
  ].filter(Boolean);
  const nextCopy = buildUrl
    ? "Take the same kind of studio into your own Cloudflare account, with your own media storage and model keys."
    : "The project, references and decisions behind this published piece.";
  return `${head({
    title,
    description: description || "Published from an independent Media Studio.",
    image: ogImageUrl,
    imageAlt: title,
    imageType: ogImageMime,
    imageWidth: ogImageWidth,
    imageHeight: ogImageHeight,
    url,
    kind: isVideo ? "video.other" : isAudio ? "music.song" : "website",
    extra: isVideo
      ? `<meta property="og:video" content="${escapeHtml(origin + media)}"><meta property="og:video:type" content="${escapeHtml(mime)}">${durationMs ? `<meta property="video:duration" content="${Math.round(durationMs / 1000)}">` : ""}`
      : "",
  })}
<body>
<main class="public-page" id="main">
  <p class="eyebrow">Published from Media Studio</p>
  <h1>${escapeHtml(title)}</h1>
  ${description ? `<p class="lede">${escapeHtml(description)}</p>` : ""}
  <figure style="margin:1.4rem 0">
    <div class="media">
      ${
        isVideo
          ? `<video controls playsinline preload="metadata" ${poster ? `poster="${escapeHtml(poster)}"` : ""} aria-label="${escapeHtml(title)}"><source src="${escapeHtml(media)}" type="${escapeHtml(mime)}">Your browser cannot play this video. <a href="${escapeHtml(download)}">Download it instead</a>.</video>`
          : isAudio
            ? `<audio controls preload="metadata" aria-label="${escapeHtml(title)}" style="width:100%"><source src="${escapeHtml(media)}" type="${escapeHtml(mime)}">Your browser cannot play this audio. <a href="${escapeHtml(download)}">Download it instead</a>.</audio>`
            : `<img src="${escapeHtml(media)}" alt="${escapeHtml(title)}" ${width ? `width="${width}" height="${height}"` : ""} decoding="async">`
      }
    </div>
    <figcaption class="caption">
      <span>${escapeHtml(facts)}</span>
      <a href="${escapeHtml(download)}" download>Download ${isVideo ? "video" : isAudio ? "audio" : "image"}</a>
    </figcaption>
  </figure>
  <p class="small">A deliberately published piece. Private projects, other media and prompts stay in the studio. Withdrawing this page stops new visits here; copies someone already downloaded cannot be recalled.</p>
  ${
    actions.length
      ? `<section class="public-next" aria-labelledby="public-next-title">
    <p class="eyebrow">${buildUrl ? "Make your own" : "Behind this page"}</p>
    <h2 id="public-next-title">${buildUrl ? "Build your own Media Studio" : "How this was made"}</h2>
    <p>${nextCopy}</p>
    <div class="row">${actions.join("")}</div>
  </section>`
      : ""
  }
  <footer class="public-footer">Published with an independently owned Media Studio · <a href="${escapeHtml(origin)}/">Owner sign-in</a></footer>
</main>
</body>
</html>`;
}

export function notFoundPage() {
  return `${head({ title: "Not found — Media Studio", description: "This page is not available." })}
<body><main id="main"><p class="eyebrow">404</p><h1>Nothing here.</h1><p>This page may have been withdrawn. <a href="/">Return to the studio</a>.</p></main></body></html>`;
}

export function helpPage() {
  return `${head({
    title: "How Media Studio works",
    description: "What the studio keeps, what generation costs, and how to recover from a failed save.",
  })}
<body>
<header class="site-header">
  <a class="wordmark" href="/" aria-label="Media Studio home">${mark}<span>Media Studio</span><span class="brand-by">App Composer</span></a>
  <nav class="header-nav"><a href="/">Open the studio</a></nav>
</header>
<main id="main" class="public-page">
  <p class="eyebrow">Help and setup</p>
  <h1>How Media Studio works</h1>
  <p class="lede">A plain account of what is stored, what a model costs, and what the studio can honestly confirm.</p>

  <h2>Without an AI account</h2>
  <p>Uploads, project collections, search and filters, the viewer, renaming, downloads, deletion, creative references, storyboards, export and public pages all work without any model provider. Nothing on those paths calls a model or spends money.</p>
  <p>Uploads accept JPEG, PNG and WebP images and WAV, MP3 or M4A audio up to 32&nbsp;MB, and MP4 or WebM video up to 64&nbsp;MB. The studio checks the actual bytes and records the real dimensions, duration and audio format. A reference image for generation is capped at 8&nbsp;MB. Rendering a storyboard is the one path that needs a provider, because it needs a renderer.</p>

  <h2>Generation</h2>
  <p>Generation uses the provider configured on this studio, not your personal account elsewhere:</p>
  <ul>
    <li><strong>Images</strong> run on Cloudflare Workers AI on this studio's own Cloudflare account. Studio Quick and Studio Draft make new stills in square, portrait, landscape or wide frames. Studio Detail takes one selected still as a reference and makes a variation.</li>
    <li><strong>Video</strong> runs on fal.ai through this studio's own key. Animate a still sends the selected image and a motion prompt to an asynchronous image-to-video job, then copies the finished MP4 into this studio's storage.</li>
    <li><strong>Sound</strong> runs on fal.ai too. Studio Score makes a 30-second instrumental bed; Studio Voice narrates text you supply. Both come back as audio assets with their real duration, sample rate and channel count, and both can be published or used as a storyboard's audio track.</li>
    <li><strong>Assembly</strong> is a bounded render, not an unbounded transcode. The studio signs short-lived read links for the participating clips and audio, asks the render provider for one composition of up to sixty seconds, then copies the assembled MP4 into this studio's storage. The composition stays editable; rendering again is a new, separately estimated request and keeps the earlier result.</li>
  </ul>
  <p>Every request shows an estimate before you confirm it. Estimates are not invoices. The monthly allowance is enforced by one atomic check across the whole studio, so two simultaneous requests cannot oversubscribe it.</p>

  <h2>What the statuses mean</h2>
  <ul>
    <li><strong>Prepared / Submitting / Submitted / Generating</strong> — the request is saved and the provider is working.</li>
    <li><strong>Copying result / Saving</strong> — the provider finished. The studio is writing the exact bytes and the library record. A save failure can be retried without generating again.</li>
    <li><strong>Saved</strong> — owned bytes and a library record both exist.</li>
    <li><strong>Cancel requested</strong> — the provider was asked to stop. The studio shows what the provider confirmed. A cancellation is not a refund.</li>
    <li><strong>Outcome unknown</strong> — the studio lost the provider's reply or cannot prove what happened. It keeps the reservation and never resubmits automatically. Reconcile when the provider is reachable.</li>
    <li><strong>Discarded after delete</strong> — the job or its asset was deleted before a late result arrived. The result is not restored.</li>
  </ul>

  <h2>Publishing and withdrawing</h2>
  <p>A published page exposes its title, description and media, plus a download link. Prompts, other projects and filenames stay private. Withdrawing stops new visits immediately, but copies someone already downloaded cannot be recalled. Deleting media also withdraws any page using it.</p>

  <h2>Ownership and recovery</h2>
  <p>This studio owns its D1 metadata, its R2 media and its provider keys. The project export contains the project record, references, prompts, generation history, costs and lineage without secrets. Media files download separately while they still exist. An export is not a backup of R2; copy the files you need.</p>
  <p>Code and media restore are separate operations. Restoring an older Worker version does not bring back deleted bytes; restoring bytes does not roll back code.</p>

  <h2>Owner setup for a new installation</h2>
  <ol>
    <li>Create a D1 database and an R2 bucket, then apply <code>migrations/0001.sql</code>.</li>
    <li>Bind them as <code>DB</code> and <code>MEDIA</code>, and add the Workers AI binding <code>AI</code>.</li>
    <li>Set <code>OWNER_PASSPHRASE</code> (at least 16 characters) and <code>SESSION_SECRET</code> (at least 32 characters) as Wrangler secrets.</li>
    <li>Optional video, sound and assembly: set <code>FAL_KEY</code> as a Wrangler secret. Without it, image work and the library still function and the studio says those routes need a key.</li>
    <li>Deploy with a clean pushed <code>main</code>. The guarded deploy runs the focused checks first.</li>
  </ol>
  <p class="small">No App Composer account, licence callback or hosted service is required after deployment.</p>
</main>
</body>
</html>`;
}
