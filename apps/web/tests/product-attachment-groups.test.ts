import test from "node:test";
import assert from "node:assert/strict";
import { productAttachmentGroups } from "../src/lib/product-attachment-groups";

test("category-first measurement across all stages preserves original objects, IDs and metadata", () => {
  const files = ["PRODUCTION", "ASSEMBLY", "INSTALLATION"].map((stage, i) => Object.freeze({id: `measure-${i}`, category: "MEASUREMENT", stage, storedName: `existing-${i}`, mimeType: i ? "application/pdf" : "image/png"}));
  const groups = productAttachmentGroups(Object.freeze(files));
  assert.deepEqual(groups.measurement, files);
  assert.deepEqual(groups.production, []);
  assert.deepEqual(groups.installation, []);
  groups.measurement.forEach((file, i) => assert.strictEqual(file, files[i]));
});

test("production merges old assembly in original order; cover excluded without duplicates", () => {
  const files = Object.freeze([
    Object.freeze({id:"draw",category:"DRAWING",stage:"ASSEMBLY"}),
    Object.freeze({id:"cover",category:"PHOTO",stage:"PRODUCTION"}),
    Object.freeze({id:"model",category:"B3D",stage:"PRODUCTION"}),
    Object.freeze({id:"install",category:"DOCUMENT",stage:"INSTALLATION"}),
    Object.freeze({id:"measure",category:"MEASUREMENT",stage:"INSTALLATION"}),
  ]);
  const groups = productAttachmentGroups(files,"cover");
  assert.deepEqual(groups.production,[files[0],files[2]]);
  assert.deepEqual(groups.installation,[files[3]]);
  const displayed=[...groups.measurement,...groups.production,...groups.installation];
  assert.equal(new Set(displayed.map(file=>file.id)).size,4);
  assert.equal(displayed.length,4);
  assert.equal(files.length,5);
});

test("measurement chosen as cover stays measurement; only ordinary cover is excluded from documents", () => {
  const measurement=Object.freeze({id:"measurement-cover",category:"MEASUREMENT",stage:"INSTALLATION",storedName:"same-key"});
  const ordinary=Object.freeze({id:"ordinary",category:"DOCUMENT",stage:"PRODUCTION"});
  const groups=productAttachmentGroups([measurement,ordinary],measurement.id);
  assert.deepEqual(groups.measurement,[measurement]);assert.strictEqual(groups.measurement[0],measurement);
  assert.deepEqual(groups.production,[ordinary]);assert.deepEqual(groups.installation,[]);
});
