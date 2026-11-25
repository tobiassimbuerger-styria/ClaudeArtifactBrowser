import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const artifacts = JSON.parse(readFileSync("data/artifacts.json", "utf8"));
const escapeHtml = (text) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// The script replaces this list on load; it gives crawlers without JavaScript the content and the links.
const staticList = artifacts
  .map((a) => `<p><a href="a/${a.id}/">${escapeHtml(a.title)}</a> ${escapeHtml(a.description)}</p>`)
  .join("\n");
const template = readFileSync("index.html", "utf8")
  .replace('<base href="/">', () => `<base href="${base}/">`)
  .replace('<div id="grid"></div>', () => `<div id="grid">\n${staticList}\n</div>`);

function writePage(path, title, description) {
  const page = template
    .replace(/<title>.*<\/title>/, () => `<title>${title} – Artifact Browser</title>\n  <link rel="canonical" href="${base}/${path}/">`)
    .replace(/(<meta name="description" content=")[^"]*/, (_, prefix) => prefix + description);
  mkdirSync(`dist/${path}`, { recursive: true });
  writeFileSync(`dist/${path}/index.html`, page);
}

rmSync("dist", { recursive: true, force: true });
for (const file of ["app.js", "config.js", "style.css", "privacy.html", "data"]) cpSync(file, `dist/${file}`, { recursive: true });
writeFileSync("dist/index.html", template);
// GitHub Pages serves 404.html for unknown paths, which keeps links to not yet built pages working.
writeFileSync("dist/404.html", template);

// Static pages per artifact and per tag, so search engines get real URLs with their own titles.
for (const a of artifacts) {
  const title = escapeHtml(a.title);
  const summary = a.description ? `${escapeHtml(a.description)} ` : "";
  writePage(`a/${a.id}`, title, `${title}: ${summary}A public Claude artifact by ${escapeHtml(a.author)}. Tags: ${a.tags.join(", ")}.`);
}
const tags = [...new Set(artifacts.flatMap((a) => a.tags))];
for (const tag of tags) {
  const count = artifacts.filter((a) => a.tags.includes(tag)).length;
  writePage(`t/${tag}`, `Claude artifacts tagged ${tag}`, `Browse ${count} public Claude artifacts tagged ${tag}.`);
}

const paths = ["", ...artifacts.map((a) => `a/${a.id}/`), ...tags.map((tag) => `t/${tag}/`)];
writeFileSync(
  "dist/sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths
    .map((path) => `  <url><loc>${base}/${path}</loc></url>`)
    .join("\n")}\n</urlset>\n`,
);
writeFileSync("dist/robots.txt", `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
