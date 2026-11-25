import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const artifacts = JSON.parse(readFileSync("data/artifacts.json", "utf8"));
const template = readFileSync("index.html", "utf8").replace('<base href="/">', () => `<base href="${base}/">`);
const escapeHtml = (text) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

rmSync("dist", { recursive: true, force: true });
for (const file of ["app.js", "config.js", "style.css", "data"]) cpSync(file, `dist/${file}`, { recursive: true });
writeFileSync("dist/index.html", template);
// GitHub Pages serves 404.html for unknown paths, which keeps links to not yet built artifact pages working.
writeFileSync("dist/404.html", template);

// One static page per artifact, so search engines get a real URL with its own title.
for (const a of artifacts) {
  const title = escapeHtml(a.title);
  const description = `${title} – a public Claude artifact by ${escapeHtml(a.author)}. Tags: ${a.tags.join(", ")}.`;
  const page = template
    .replace(/<title>.*<\/title>/, () => `<title>${title} – Lesezeichen</title>\n  <link rel="canonical" href="${base}/a/${a.id}/">`)
    .replace(/(<meta name="description" content=")[^"]*/, (_, prefix) => prefix + description);
  mkdirSync(`dist/a/${a.id}`, { recursive: true });
  writeFileSync(`dist/a/${a.id}/index.html`, page);
}

const urls = [`${base}/`, ...artifacts.map((a) => `${base}/a/${a.id}/`)];
writeFileSync(
  "dist/sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((url) => `  <url><loc>${url}</loc></url>`)
    .join("\n")}\n</urlset>\n`,
);
writeFileSync("dist/robots.txt", `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
