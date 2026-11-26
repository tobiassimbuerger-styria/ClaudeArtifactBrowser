import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { artifactId } from "./artifact-url.mjs";

const UUID = "07afd3e4-2596-47ef-bcec-dc643ad7d0a3";
const SHORT_ID = "9j53nCVcrSdZyCHtxUZkWJ";

test("accepts every Claude artifact link form", () => {
  assert.equal(artifactId(`https://claude.ai/public/artifacts/${UUID}`), UUID);
  assert.equal(artifactId(`https://claude.site/artifacts/${UUID}`), UUID);
  assert.equal(artifactId(`https://claude.ai/artifact/${SHORT_ID}`), SHORT_ID);
  assert.equal(artifactId(`https://claude.ai/artifact/${SHORT_ID}?utm=x#top`), SHORT_ID);
  assert.equal(artifactId(`https://claude.ai/public/artifacts/${UUID}/`), UUID);
});

test("rejects everything that is not a Claude artifact link", () => {
  const rejected = [
    `https://evil.com/artifact/${SHORT_ID}`,
    `https://claude.ai.evil.com/artifact/${SHORT_ID}`,
    `https://evil.com/?next=https://claude.ai/artifact/${SHORT_ID}`,
    `https://user@evil.com/claude.ai/artifact/${SHORT_ID}`,
    `https://claude.ai@evil.com/artifact/${SHORT_ID}`,
    `https://xclaude.ai/artifact/${SHORT_ID}`,
    `https://claude.aix/artifact/${SHORT_ID}`,
    `http://claude.ai/artifact/${SHORT_ID}`,
    `HTTPS://CLAUDE.AI/artifact/${SHORT_ID}`,
    ` https://claude.ai/artifact/${SHORT_ID}`,
    `javascript:alert(1)//https://claude.ai/artifact/${SHORT_ID}`,
    `https://claude.ai/artifact/${SHORT_ID}<script>`,
    "https://claude.ai/artifact/../login",
    "https://claude.ai/artifact/short",
    "https://claude.ai/chat/07afd3e4-2596-47ef-bcec-dc643ad7d0a3",
    "https://claude.ai/",
    `https://claude.site/artifact/${SHORT_ID}`,
    "",
    null,
    undefined,
    42,
    { toString: () => `https://claude.ai/artifact/${SHORT_ID}` },
  ];
  for (const url of rejected) assert.equal(artifactId(url), null, `should reject ${String(url)}`);
});

test("every stored artifact has an id that a Claude link can produce", () => {
  const stored = JSON.parse(readFileSync(new URL("../data/artifacts.json", import.meta.url), "utf8"));
  for (const { id } of stored) {
    const viaPublic = artifactId(`https://claude.ai/public/artifacts/${id}`);
    const viaShort = artifactId(`https://claude.ai/artifact/${id}`);
    assert.ok(viaPublic === id || viaShort === id, `invalid stored id ${id}`);
  }
});
