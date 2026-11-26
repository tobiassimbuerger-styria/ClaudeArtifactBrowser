import { API_URL, GOOGLE_CLIENT_ID } from "./config.js";

const ARTIFACT_ID = /^[0-9A-Za-z-]{16,36}$/;
const UUID = /^[0-9a-f-]{36}$/;
// Claude forbids framing its artifact pages on other sites, so artifacts launch in a new tab.
const launchUrl = (id) => `https://claude.ai/${UUID.test(id) ? "public/artifacts" : "artifact"}/${id}`;
const ARTIFACT_PATH = /\/a\/([0-9A-Za-z-]{16,36})\/?$/;
const TAG_PATH = new RegExp("/t/([a-z0-9-]{1,20})/?$");
const HOUR_MS = 36e5;
const SESSION_STORAGE = "session";
const NOTICE_MS = 5000;
const REPO_URL = "https://github.com/tobiassimbuerger-styria/ClaudeArtifactBrowser";
const HOME = new URL(document.baseURI).pathname;
const COVER_WIDTH = 640;
const COVER_HEIGHT = 360;
// Outline icons from Feather (MIT licence).
const ICONS = {
  up: "M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3",
  down: "M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  flag: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7",
  trash: "M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
};

const score = (a) => a.voters.length - a.downvoters.length;
// Votes decay with age so fresh artifacts can overtake old favorites.
const hype = (a) => score(a) / ((Date.now() - Date.parse(a.created)) / HOUR_MS + 2) ** 1.5;

const SORTS = {
  hyped: (a, b) => hype(b) - hype(a),
  new: (a, b) => Date.parse(b.created) - Date.parse(a.created),
  top: (a, b) => score(b) - score(a),
};

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
};

let artifacts = [];
const tagFromPath = () => TAG_PATH.exec(location.pathname)?.[1] ?? null;
let activeTag = tagFromPath();
let token = localStorage.getItem(SESSION_STORAGE);
// The signed-in user's vote id, used to mark their own votes and posts.
let me = null;

function notify(message) {
  $("notice").textContent = message;
  $("notice").hidden = false;
  setTimeout(() => { $("notice").hidden = true; }, NOTICE_MS);
}

function setSession(newToken) {
  token = newToken;
  try {
    me = token ? JSON.parse(atob(token.split(".")[0])).voter : null;
  } catch {
    token = null;
    me = null;
  }
  if (token) localStorage.setItem(SESSION_STORAGE, token);
  else localStorage.removeItem(SESSION_STORAGE);
  if (artifacts.length > 0) render();
  $("signin").hidden = Boolean(token);
  $("submit-open").hidden = !token;
  $("signout").hidden = !token;
}

async function api(route, body) {
  if (!token) {
    globalThis.google?.accounts.id.prompt();
    return false;
  }
  const response = await fetch(`${API_URL}/${route}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (response.status === 401) setSession(null);
  if (!response.ok) {
    notify(result.error);
    return false;
  }
  artifacts = result;
  render();
  return true;
}

// Artifacts without an uploaded screenshot get a stable generated cover.
function paintGeneratedCover(node, a) {
  const hue = [...a.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  node.style.setProperty("--hue", hue);
  node.replaceChildren(a.title[0].toUpperCase());
}

function paintCover(node, a) {
  if (!a.cover) {
    paintGeneratedCover(node, a);
    return;
  }
  const image = new Image();
  image.alt = `Screenshot of ${a.title}`;
  image.loading = "lazy";
  image.onerror = () => paintGeneratedCover(node, a);
  // Read from the repository: the site's own copy only appears with the next build.
  image.src = `${REPO_URL.replace("github.com", "raw.githubusercontent.com")}/main/data/covers/${a.id}.jpg`;
  node.replaceChildren(image);
}

/** Crops the picture to the cover format and returns it as base64 JPEG. */
async function coverData(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = COVER_WIDTH;
  canvas.height = COVER_HEIGHT;
  const scale = Math.max(COVER_WIDTH / bitmap.width, COVER_HEIGHT / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  canvas.getContext("2d").drawImage(bitmap, (COVER_WIDTH - width) / 2, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
}

function iconButton(icon, label, text = "") {
  const button = el("button", "icon-button", "");
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[icon]}"/></svg>`;
  button.append(text);
  button.ariaLabel = label;
  button.title = label;
  return button;
}

function voteButton(a, value) {
  const [list, icon, label] = value === 1 ? [a.voters, "up", "Thumbs up"] : [a.downvoters, "down", "Thumbs down"];
  const button = iconButton(icon, label, value === 1 ? list.length : "");
  button.classList.toggle("active", list.includes(me));
  button.onclick = () => api("vote", { id: a.id, value });
  return button;
}

function card(a) {
  const cover = el("div", "cover", "");
  paintCover(cover, a);
  const link = el("a", "title", a.title);
  link.href = `a/${a.id}/`;
  link.onclick = (event) => {
    event.preventDefault();
    window.open(launchUrl(a.id), "_blank", "noopener");
  };
  const share = iconButton("link", "Copy link");
  share.classList.add("push");
  share.onclick = async () => {
    await navigator.clipboard.writeText(link.href);
    notify("Link copied");
  };
  const report = iconButton("flag", "Report");
  report.onclick = () => {
    const title = encodeURIComponent(`Report artifact ${a.id}`);
    window.open(`${REPO_URL}/issues/new?title=${title}`, "_blank", "noopener");
  };
  const actions = el("div", "card-actions", "");
  actions.append(voteButton(a, 1), voteButton(a, -1), share, report);
  if (me && a.owner === me) {
    const remove = iconButton("trash", "Delete");
    remove.onclick = () => confirm(`Delete "${a.title}"?`) && api("delete", { id: a.id });
    actions.append(remove);
  }
  const node = el("article", "card", "");
  node.append(
    cover,
    link,
    el("p", "description", a.description),
    el("small", "meta", [...a.tags.map((t) => `#${t}`), `by ${a.author}`].join(" · ")),
    actions,
  );
  return node;
}

function render() {
  const query = $("search").value.trim().toLowerCase();
  const shown = artifacts
    .filter((a) => !activeTag || a.tags.includes(activeTag))
    .filter((a) => `${a.title} ${a.description} ${a.tags.join(" ")}`.toLowerCase().includes(query))
    .sort(SORTS[$("sort").value]);
  $("grid").replaceChildren(...shown.map(card));
  $("empty").hidden = shown.length > 0;

  const tags = [...new Set(artifacts.flatMap((a) => a.tags))].sort();
  $("tags").replaceChildren(...tags.map((t) => {
    const chip = el("button", t === activeTag ? "chip" : "chip outline", `#${t}`);
    chip.onclick = () => {
      activeTag = t === activeTag ? null : t;
      history.pushState(null, "", activeTag ? new URL(`t/${activeTag}/`, document.baseURI) : HOME);
      render();
    };
    return chip;
  }));
}

function syncViewer() {
  const id = ARTIFACT_PATH.exec(location.pathname)?.[1];
  const artifact = artifacts.find((a) => a.id === id);
  if (!artifact) {
    $("viewer").close();
    return;
  }
  paintCover($("viewer-cover"), artifact);
  $("viewer-title").textContent = artifact.title;
  $("viewer-description").textContent = artifact.description;
  $("viewer-link").href = launchUrl(artifact.id);
  if (!$("viewer").open) $("viewer").showModal();
}

$("search").oninput = render;
$("sort").onchange = render;
$("viewer-close").onclick = () => $("viewer").close();
$("viewer").onclose = () => {
  if (ARTIFACT_PATH.test(location.pathname)) history.pushState(null, "", HOME);
};
window.onpopstate = () => {
  activeTag = tagFromPath();
  render();
  syncViewer();
};

$("submit-open").onclick = () => $("submit").showModal();
$("submit-cancel").onclick = () => $("submit").close();
$("submit-form").onsubmit = async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const tags = form.get("tags").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const body = { url: form.get("url"), title: form.get("title"), description: form.get("description"), tags };
  if (form.get("cover").size > 0) body.cover = await coverData(form.get("cover"));
  $("submit-send").ariaBusy = "true";
  $("submit-send").disabled = true;
  const posted = await api("submit", body);
  $("submit-send").ariaBusy = "false";
  $("submit-send").disabled = false;
  if (posted) {
    event.target.reset();
    $("submit").close();
  }
};

$("signout").onclick = () => {
  globalThis.google?.accounts.id.disableAutoSelect();
  setSession(null);
};
setSession(token);

// The worker has the current list; the static copy is the fallback when the worker is unreachable.
const response = await fetch(`${API_URL}/artifacts`)
  .then((live) => (live.ok ? live : Promise.reject(new Error("worker unavailable"))))
  .catch(() => fetch("data/artifacts.json"));
// The id ends up in a link URL, so anything that is not a plain artifact id is dropped.
artifacts = (await response.json()).filter((a) => ARTIFACT_ID.test(a.id));
render();
syncViewer();

// Absent when the Google script is blocked; browsing still works then.
if (globalThis.google && GOOGLE_CLIENT_ID) {
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: async ({ credential }) => {
      const login = await fetch(`${API_URL}/login`, { method: "POST", headers: { Authorization: `Bearer ${credential}` } });
      if (login.ok) setSession((await login.json()).token);
      else notify("Sign-in failed, please try again");
    },
  });
  google.accounts.id.renderButton($("signin"), { theme: "outline", size: "large" });
}
