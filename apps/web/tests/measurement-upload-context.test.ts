import assert from "node:assert/strict";
import test from "node:test";
import {measurementUploadFields, type MeasurementUploadContext} from "../src/lib/measurement-upload-context";

test("task and product measurement use exact real bindings and section without fake task or metadata", () => {
  assert.deepEqual(measurementUploadFields({projectId:"project",taskId:"task"}),{projectId:"project",taskId:"task",section:"MEASUREMENT"});
  assert.deepEqual(measurementUploadFields({projectId:"project",productId:"product"}),{projectId:"project",productId:"product",section:"MEASUREMENT"});
});
test("missing and mixed measurement contexts never form an upload", () => {
  for (const context of [{projectId:"project"},{projectId:"project",taskId:"task",productId:"product"},{projectId:"",productId:"product"}]) assert.throws(() => measurementUploadFields(context as MeasurementUploadContext));
});
