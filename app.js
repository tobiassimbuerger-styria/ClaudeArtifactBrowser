import { API_URL, GOOGLE_CLIENT_ID } from "./config.js";

const ARTIFACT_ID = /^[0-9a-f-]{36}$/;
const ARTIFACT_PATH = /\/a\/([0-9a-f-]{36})\/?$/;
const HOUR_MS = 36e5;
const HOME = new URL(document.baseURI).pathname;

// Votes decay with age so fresh artifacts can overtake old favorites.
const hype = (a) => a.voters.length / ((Date.now() - Date.parse(a.created)) / HOUR_MS + 2) ** 1.5;

const SORTS = {
  hyped: (a, b) => hype(b) - hype(a),
  new: (a, b) => Date.parse(b.created) - Date.parse(a.created),
  top: (a, b) => b.voters.length - a.voters.length,
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

function navigate(path) {
  history.pushState(null, "", path);
  syncViewer();
}

function card(a) {
  const link = el("a", "title", a.title);
  link.href = `a/${a.id}/`;
  link.onclick = (event) => {
    event.preventDefault();
    navigate(link.href);
  };
  const vote = el("button", "vote", `▲ ${a.voters.length}`);
  vote.onclick = () => api("vote", { id: a.id });
  const node = el("div", "card", "");
  node.append(link, el("span", "meta", `by ${a.author}`), el("span", "meta", a.tags.map((t) => `#${t}`).join(" ")), vote);
  return node;
}

function render() {
  const query = $("search").value.trim().toLowerCase();
  const shown = artifacts
    .filter((a) => !activeTag || a.tags.includes(activeTag))
    .filter((a) => `${a.title} ${a.tags.join(" ")}`.toLowerCase().includes(query))
    .sort(SORTS[$("sort").value]);
  $("grid").replaceChildren(...shown.map(card));
  $("empty").hidden = shown.length > 0;

  const tags = [...new Set(artifacts.flatMap((a) => a.tags))].sort();
  $("tags").replaceChildren(...tags.map((t) => {
    const chip = el("button", t === activeTag ? "chip active" : "chip", `#${t}`);
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
  $("viewer-title").textContent = artifact.title;
  $("viewer-link").href = `https://claude.ai/public/artifacts/${artifact.id}`;
  $("viewer-frame").src = `https://claude.site/public/artifacts/${artifact.id}/embed`;
  if (!$("viewer").open) $("viewer").showModal();
}

$("search").oninput = render;
$("sort").onchange = render;
$("viewer-close").onclick = () => $("viewer").close();
$("viewer").onclose = () => {
  $("viewer-frame").src = "about:blank";
  if (ARTIFACT_PATH.test(location.pathname)) navigate(HOME);
};
window.onpopstate = syncViewer;

$("submit-open").onclick = () => $("submit").showModal();
$("submit-cancel").onclick = () => $("submit").close();
$("submit-form").onsubmit = async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const tags = form.get("tags").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (await api("submit", { url: form.get("url"), title: form.get("title"), tags })) {
    event.target.reset();
    $("submit").close();
  }
};

const response = await fetch("data/artifacts.json");
// The id ends up in an iframe URL, so anything that is not a plain artifact id is dropped.
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
  google.accounts.id.renderButton($("signin"), { theme: "outline", size: "medium" });
}
