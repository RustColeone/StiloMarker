import test from "node:test";
import assert from "node:assert/strict";

import { loadModules } from "./helpers/mocks.mjs";

const { urldbService } = await loadModules();

test("urldb: serialize then parse round-trip", () => {
  const urldbContent = urldbService.serializeUrlDb([
    { name: "Reference", url: "https://example.com/reference.jpg", description: "Pose sheet" }
  ]);
  assert.match(urldbContent, /\[Reference\]/);
  assert.match(urldbContent, /url = https:\/\/example.com\/reference.jpg/);

  const parsedUrlDb = urldbService.parseUrlDb(urldbContent);
  assert.equal(parsedUrlDb.length, 1);
  assert.equal(parsedUrlDb[0].description, "Pose sheet");
});

test("urldb: entry body format round-trip", () => {
  const parsed = urldbService.parseUrlDb(
    urldbService.serializeUrlDb([
      { name: "Reference", url: "https://example.com/reference.jpg", description: "Pose sheet" }
    ])
  );
  const entryBody = urldbService.formatUrlDbEntryBody(parsed[0]);
  assert.match(entryBody, /url = https:\/\/example.com\/reference.jpg/);
  const parsedEntryBody = urldbService.parseUrlDbEntryBody(entryBody);
  assert.equal(parsedEntryBody.description, "Pose sheet");
});

test("urldb: rename and remove entries", () => {
  const urldbContent = urldbService.serializeUrlDb([
    { name: "Reference", url: "https://example.com/reference.jpg", description: "Pose sheet" }
  ]);
  const id = urldbService.parseUrlDb(urldbContent)[0].id;
  const renamedUrlDb = urldbService.updateUrlDbEntry(urldbContent, id, { name: "Reference 2" });
  assert.match(renamedUrlDb, /\[Reference 2\]/);
  const removedUrlDb = urldbService.removeUrlDbEntry(renamedUrlDb, urldbService.parseUrlDb(renamedUrlDb)[0].id);
  assert.equal(removedUrlDb, "");
});
