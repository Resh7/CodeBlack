import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("packages the production worker, client, bindings, and migrations", async () => {
  const serverPath = `${root}/dist/server/index.js`;
  const clientManifestPath = `${root}/dist/client/.vite/manifest.json`;
  const hostingPath = `${root}/dist/.openai/hosting.json`;
  const migrationsPath = `${root}/dist/.openai/drizzle`;

  await Promise.all([access(serverPath), access(clientManifestPath), access(hostingPath), access(migrationsPath)]);

  const [server, clientManifestText, hostingText, migrations] = await Promise.all([
    readFile(serverPath, "utf8"),
    readFile(clientManifestPath, "utf8"),
    readFile(hostingPath, "utf8"),
    readdir(migrationsPath),
  ]);
  const manifest = JSON.parse(clientManifestText);
  const hosting = JSON.parse(hostingText);

  assert.match(server, /Batch Operations Control Center/);
  assert.ok(Object.keys(manifest).length > 0, "client manifest must contain built assets");
  assert.equal(hosting.d1, "DB");
  assert.equal(hosting.r2, "BUCKET");
  assert.deepEqual(
    migrations.filter((name) => name.endsWith(".sql")).sort(),
    ["0000_lush_miracleman.sql", "0001_wet_thing.sql", "0002_complete_mimic.sql", "0003_special_slapstick.sql"],
  );
});
