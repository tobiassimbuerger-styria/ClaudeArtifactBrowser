const ARTIFACT_URL = /^https:\/\/claude\.ai\/public\/artifacts\/([0-9a-f-]{36})(?:[/?#]|$)/;
const TAG = /^[a-z0-9-]{1,20}$/;
const MAX_TITLE = 80;
const MAX_TAGS = 5;
const WRITE_ATTEMPTS = 3;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function verify(request, env) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  const claims = await response.json();
  if (!response.ok || claims.aud !== env.GOOGLE_CLIENT_ID) throw new HttpError(401, "Please sign in again");
  // The data file is public, so the Google account id is only stored as a salted hash.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(claims.sub + env.VOTER_SALT));
  const voter = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  return { voter, name: claims.given_name ?? "anonymous" };
}

function submit(list, user, { url, title, tags }) {
  const id = typeof url === "string" && ARTIFACT_URL.exec(url)?.[1];
  if (!id) throw new HttpError(400, "Not a public Claude artifact link");
  if (typeof title !== "string" || !title.trim() || title.length > MAX_TITLE) {
    throw new HttpError(400, `Title must have 1 to ${MAX_TITLE} characters`);
  }
  if (!Array.isArray(tags) || tags.length > MAX_TAGS || !tags.every((t) => typeof t === "string" && TAG.test(t))) {
    throw new HttpError(400, `Up to ${MAX_TAGS} tags, lowercase letters, digits and dashes only`);
  }
  if (list.some((a) => a.id === id)) throw new HttpError(409, "This artifact was already posted");
  list.push({
    id,
    title: title.trim(),
    author: user.name,
    tags,
    created: new Date().toISOString(),
    voters: [user.voter],
  });
  return `Add artifact ${id}`;
}

function vote(list, user, { id }) {
  const artifact = list.find((a) => a.id === id);
  if (!artifact) throw new HttpError(404, "Unknown artifact");
  const index = artifact.voters.indexOf(user.voter);
  if (index === -1) artifact.voters.push(user.voter);
  else artifact.voters.splice(index, 1);
  return `Vote on artifact ${id}`;
}

const decode = (base64) => new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));

function encode(text) {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Applies `mutate` to the artifact list in the repo; retries when a concurrent write wins. */
async function update(env, mutate) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/data/artifacts.json`;
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "lesezeichen-worker",
  };
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const read = await fetch(url, { headers });
    if (!read.ok) throw new Error(`GitHub read failed: ${read.status}`);
    const file = await read.json();
    const list = JSON.parse(decode(file.content));
    const message = mutate(list);
    const content = encode(`${JSON.stringify(list, null, 2)}\n`);
    const write = await fetch(url, { method: "PUT", headers, body: JSON.stringify({ message, content, sha: file.sha }) });
    if (write.ok) return list;
    if (write.status !== 409) throw new Error(`GitHub write failed: ${write.status}`);
  }
  throw new HttpError(503, "Busy, please try again");
}

const ROUTES = { "/submit": submit, "/vote": vote };

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.SITE_ORIGIN,
      "Access-Control-Allow-Headers": "Authorization",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    try {
      const action = request.method === "POST" && ROUTES[new URL(request.url).pathname];
      if (!action) throw new HttpError(404, "Not found");
      const user = await verify(request, env);
      const body = await request.json();
      const list = await update(env, (artifacts) => action(artifacts, user, body));
      return Response.json(list, { headers: cors });
    } catch (error) {
      if (!(error instanceof HttpError)) console.error(error);
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "Something went wrong";
      return Response.json({ error: message }, { status, headers: cors });
    }
  },
};
