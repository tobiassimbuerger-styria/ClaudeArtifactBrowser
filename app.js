import { API_URL, GOOGLE_CLIENT_ID } from "./config.js";

const ARTIFACT_ID = /^[0-9A-Za-z-]{16,36}$/;
const UUID = /^[0-9a-f-]{36}$/;
// Claude forbids framing its artifact pages on other sites, so artifacts launch in a new tab.
const launchUrl = (id) => `https://claude.ai/${UUID.test(id) ? "public/artifacts" : "artifact"}/${id}`;
const ARTIFACT_PATH = /\/a\/([0-9A-Za-z-]{16,36})\/?$/;
const HOUR_MS = 36e5;
const HOME = new URL(document.baseURI).pathname;
const TAG_ICONS = { game: "🎮", tool: "🛠️", programming: "💻", learn: "📚", creative: "🎨", data: "📊", fun: "🎉" };

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
let activeTag = null;
let token = null;

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
  if (!response.ok) {
    alert(result.error);
    return false;
  }
  artifacts = result;
  render();
  return true;
}

// Claude offers no preview images, so each artifact gets a stable generated cover instead.
function paintCover(node, a) {
  const hue = [...a.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  node.style.setProperty("--hue", hue);
  node.textContent = TAG_ICONS[a.tags.find((t) => TAG_ICONS[t])] ?? a.title[0].toUpperCase();
}

function voteButton(a, value, label) {
  const button = el("button", "vote outline secondary", label);
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
  const actions = el("div", "card-actions", "");
  actions.append(voteButton(a, 1, `👍 ${a.voters.length}`), voteButton(a, -1, "👎"), el("small", "", `by ${a.author}`));
  const node = el("article", "card", "");
  node.append(
    cover,
    link,
    el("p", "description", a.description),
    el("small", "", a.tags.map((t) => `#${t}`).join(" ")),
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
    chip.onclick = () => { activeTag = t === activeTag ? null : t; render(); };
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
window.onpopstate = syncViewer;

$("submit-open").onclick = () => $("submit").showModal();
$("submit-cancel").onclick = () => $("submit").close();
$("submit-form").onsubmit = async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const tags = form.get("tags").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const body = { url: form.get("url"), title: form.get("title"), description: form.get("description"), tags };
  if (await api("submit", body)) {
    event.target.reset();
    $("submit").close();
  }
};

const response = await fetch("data/artifacts.json");
// The id ends up in a link URL, so anything that is not a plain artifact id is dropped.
artifacts = (await response.json()).filter((a) => ARTIFACT_ID.test(a.id));
render();
syncViewer();

// Absent when the Google script is blocked; browsing still works then.
if (globalThis.google && GOOGLE_CLIENT_ID) {
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    auto_select: true,
    callback: ({ credential }) => {
      token = credential;
      $("signin").hidden = true;
      $("submit-open").hidden = false;
    },
  });
  google.accounts.id.renderButton($("signin"), { theme: "outline", size: "large" });
}
