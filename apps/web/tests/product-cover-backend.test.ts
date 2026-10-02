import assert from "node:assert/strict";
import test from "node:test";

import { canSetProductCover, validateProductCoverFile } from "../src/lib/product-cover";
import { setProductCoverCore } from "../src/server/products/cover-core";

const product = { id: "product-1", projectId: "project-1", status: "DESIGN" as const,
  engineerId: "engineer-1", sketchFileId: "old-cover" };
const image = { id: "image-1", projectId: "project-1", productId: "product-1",
  mimeType: "image/jpeg", category: "PHOTO" as const };

test("cover permission follows management precedence and own or participating DESIGN engineering", () => {
  for (const role of ["ADMIN", "DIRECTOR", "MANAGER"] as const)
    assert.equal(canSetProductCover({ id: "other", roles: [role] }, product), true);
  assert.equal(canSetProductCover({ id: "engineer-1", roles: ["ENGINEER"] }, product), true);
  assert.equal(canSetProductCover({ id: "participant", roles: ["ENGINEER"],
    engineeringParticipantProductIds: [product.id] }, product), true);
  assert.equal(canSetProductCover({ id: "engineer-1", roles: ["ENGINEER"] },
    { ...product, status: "PRODUCTION" }), false);
  assert.equal(canSetProductCover({ id: "other", roles: ["MANAGER", "ENGINEER"] },
    { ...product, status: "DONE" }), true);
  assert.equal(canSetProductCover({ id: "engineer-1", roles: ["ENGINEER", "ACCOUNTANT"] }, product), true,
    "Role union preserves an engineering grant");
  for (const role of ["ACCOUNTANT", "WORKER", "MOUNTER"] as const)
    assert.equal(canSetProductCover({ id: "engineer-1", roles: [role] }, product), false);
});

test("cover source must be a supported image bound to this exact product and project", () => {
  assert.equal(validateProductCoverFile(product, image), null);
  assert.match(validateProductCoverFile(product, { ...image, productId: "other-product" }) ?? "", /издел/);
  assert.match(validateProductCoverFile(product, { ...image, projectId: "other-project" }) ?? "", /проект/);
  assert.match(validateProductCoverFile(product, { ...image, mimeType: "application/octet-stream" }) ?? "", /изображ/);
  assert.match(validateProductCoverFile(product, { ...image, mimeType: "image/svg+xml" }) ?? "", /изображ/);
});

test("legacy gallery endpoint without captured baseline is explicitly rejected", async () => {
 const result=await setProductCoverCore({} as never,{id:"manager",roles:["MANAGER"]} as never,product.id,image.id);
 assert.equal(result.ok,false);if(!result.ok)assert.equal(result.kind,"validation");
});
