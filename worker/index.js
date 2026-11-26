import { artifactId } from "./artifact-url.mjs";

const TAG = /^[a-z0-9-]{1,20}$/;
const MAX_TITLE = 80;
const MAX_DESCRIPTION = 200;
const MAX_TAGS = 5;
// Base64 length; the site downsizes screenshots far below this before uploading.
const MAX_COVER = 300_000;
const JPEG_BASE64 = /^\/9j\/[A-Za-z0-9+/]+=*$/;
const WRITE_ATTEMPTS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_MS = 30 * DAY_MS;
const MAX_POSTS_PER_DAY = 10;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bearer = (request) => request.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sign(env, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SESSION_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

/** Exchanges a Google ID token, which lives one hour, for our own session token. */
async function login(request, env) {
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(bearer(request))}`);
  const claims = await response.json();
  if (!response.ok || claims.aud !== env.GOOGLE_CLIENT_ID) throw new HttpError(401, "Please sign in again");
  // The data file is public, so the Google account id is only stored as a salted hash.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(claims.sub + env.VOTER_SALT));
  const name = claims.given_name ?? "anonymous";
  const payload = encode(JSON.stringify({ voter: hex(digest).slice(0, 16), name, expires: Date.now() + SESSION_MS }));
  return { token: `${payload}.${await sign(env, payload)}`, name };
}

async function verify(request, env) {
  const [payload, signature] = bearer(request).split(".");
  if (!payload || signature !== (await sign(env, payload))) throw new HttpError(401, "Please sign in again");
  const session = JSON.parse(decode(payload));
  if (session.expires < Date.now()) throw new HttpError(401, "Please sign in again");
  return session;
}

/** Validates the fields a poster can edit and returns them cleaned up. */
function details({ title, description = "", tags }) {
  if (typeof title !== "string" || !title.trim() || title.length > MAX_TITLE) {
    throw new HttpError(400, `Title must have 1 to ${MAX_TITLE} characters`);
  }
  if (typeof description !== "string" || description.length > MAX_DESCRIPTION) {
    throw new HttpError(400, `Description must have at most ${MAX_DESCRIPTION} characters`);
  }
  if (!Array.isArray(tags) || tags.length > MAX_TAGS || !tags.every((t) => typeof t === "string" && TAG.test(t))) {
    throw new HttpError(400, `Up to ${MAX_TAGS} tags, lowercase letters, digits and dashes only`);
  }
  return { title: title.trim(), description: description.trim(), tags };
}

function ownArtifact(list, user, id) {
  const artifact = list.find((a) => a.id === id);
  if (!artifact) throw new HttpError(404, "Unknown artifact");
  if (artifact.owner !== user.voter) throw new HttpError(403, "You can only change your own posts");
  return artifact;
}

function submit(list, user, { url, cover, ...fields }) {
  const id = artifactId(url);
  if (!id) throw new HttpError(400, "Not a public Claude artifact link");
  const { title, description, tags } = details(fields);
  if (cover !== undefined && (typeof cover !== "string" || cover.length > MAX_COVER || !JPEG_BASE64.test(cover))) {
    throw new HttpError(400, "Screenshot must be a small JPEG image");
  }
  if (list.some((a) => a.id === id)) throw new HttpError(409, "This artifact was already posted");
  const recent = list.filter((a) => a.owner === user.voter && Date.now() - Date.parse(a.created) < DAY_MS);
  if (recent.length >= MAX_POSTS_PER_DAY) throw new HttpError(429, "Daily post limit reached, try again tomorrow");
  list.push({
    id,
    title,
    description,
    author: user.name,
    owner: user.voter,
    tags,
    created: new Date().toISOString(),
    voters: [user.voter],
    downvoters: [],
    cover: cover !== undefined,
  });
  return `Add artifact ${id}`;
}

/** Repeating the same vote takes it back; the opposite vote replaces it. */
function vote(list, user, { id, value }) {
  const artifact = list.find((a) => a.id === id);
  if (!artifact) throw new HttpError(404, "Unknown artifact");
  if (value !== 1 && value !== -1) throw new HttpError(400, "Vote must be 1 or -1");
  const chosen = value === 1 ? "voters" : "downvoters";
  const repeated = artifact[chosen].includes(user.voter);
  artifact.voters = artifact.voters.filter((v) => v !== user.voter);
  artifact.downvoters = artifact.downvoters.filter((v) => v !== user.voter);
  if (!repeated) artifact[chosen].push(user.voter);
  // Votes change no page, so they skip the site build; the site reads them live from here.
  return `Vote on artifact ${id} [skip ci]`;
}

function edit(list, user, { id, ...fields }) {
  Object.assign(ownArtifact(list, user, id), details(fields));
  return `Edit artifact ${id}`;
}

function remove(list, user, { id }) {
  list.splice(list.indexOf(ownArtifact(list, user, id)), 1);
  return `Delete artifact ${id}`;
}

const decode = (base64) => new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));

function encode(text) {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const dataUrl = (env, path) => `https://api.github.com/repos/${env.GITHUB_REPO}/contents/data/${path}`;
const githubHeaders = (env) => ({
  Authorization: `Bearer ${env.GITHUB_TOKEN}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "lesezeichen-worker",
});

async function saveCover(env, id, content) {
  const write = await fetch(dataUrl(env, `covers/${id}.jpg`), {
    method: "PUT",
    headers: githubHeaders(env),
    body: JSON.stringify({ message: `Add cover for artifact ${id}`, content }),
  });
  if (!write.ok) throw new Error(`GitHub cover write failed: ${write.status}`);
}

async function readList(env) {
  const read = await fetch(dataUrl(env, "artifacts.json"), { headers: githubHeaders(env) });
  if (!read.ok) throw new Error(`GitHub read failed: ${read.status}`);
  const file = await read.json();
  return { list: JSON.parse(decode(file.content)), sha: file.sha };
}

async function deleteCover(env, id) {
  const url = dataUrl(env, `covers/${id}.jpg`);
  const read = await fetch(url, { headers: githubHeaders(env) });
  if (read.status === 404) return;
  const { sha } = await read.json();
  const erase = await fetch(url, {
    method: "DELETE",
    headers: githubHeaders(env),
    body: JSON.stringify({ message: `Delete cover for artifact ${id}`, sha }),
  });
  if (!erase.ok) throw new Error(`GitHub cover delete failed: ${erase.status}`);
}

/** Applies `mutate` to the artifact list in the repo; retries when a concurrent write wins. */
async function update(env, mutate) {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const { list, sha } = await readList(env);
    const message = mutate(list);
    const content = encode(`${JSON.stringify(list, null, 2)}\n`);
    const write = await fetch(dataUrl(env, "artifacts.json"), {
      method: "PUT",
      headers: githubHeaders(env),
      body: JSON.stringify({ message, content, sha }),
    });
    if (write.ok) return list;
    if (write.status !== 409) throw new Error(`GitHub write failed: ${write.status}`);
  }
  throw new HttpError(503, "Busy, please try again");
}

const ROUTES = { "/submit": submit, "/vote": vote, "/edit": edit, "/delete": remove };

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.SITE_ORIGIN,
      "Access-Control-Allow-Headers": "Authorization",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    try {
      const { pathname } = new URL(request.url);
      // The site reads the list here because the static copy lags behind by a build and a cache period.
      if (request.method === "GET" && pathname === "/artifacts") {
        return Response.json((await readList(env)).list, { headers: cors });
      }
      if (request.method === "POST" && pathname === "/login") {
        return Response.json(await login(request, env), { headers: cors });
      }
      const action = request.method === "POST" && ROUTES[pathname];
      if (!action) throw new HttpError(404, "Not found");
      const user = await verify(request, env);
      const body = await request.json();
      const list = await update(env, (artifacts) => action(artifacts, user, body));
      // Saved after the entry so a rejected or duplicate post never leaves an orphaned image.
      if (action === submit && body.cover) await saveCover(env, list.at(-1).id, body.cover);
      if (action === remove) await deleteCover(env, body.id);
      return Response.json(list, { headers: cors });
    } catch (error) {
      if (!(error instanceof HttpError)) console.error(error);
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "Something went wrong";
      return Response.json({ error: message }, { status, headers: cors });
    }
  },
};
