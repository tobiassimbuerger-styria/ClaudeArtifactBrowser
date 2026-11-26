// claude.site/artifacts is the retired public link form; it redirects to claude.ai/public/artifacts.
const ARTIFACT_URL =
  /^https:\/\/(?:claude\.(?:ai\/public|site)\/artifacts\/([0-9a-f-]{36})|claude\.ai\/artifact\/([0-9A-Za-z]{16,32}))(?:[/?#]|$)/;

/** Returns the artifact id of a Claude artifact link, or null for anything else. */
export function artifactId(url) {
  const match = typeof url === "string" && ARTIFACT_URL.exec(url);
  return match ? (match[1] ?? match[2]) : null;
}
