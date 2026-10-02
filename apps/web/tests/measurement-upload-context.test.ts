import assert from "node:assert/strict";
import test from "node:test";
import { measurementUploadFields, type MeasurementUploadContext } from "../src/lib/measurement-upload-context";
test("task photo retains original context; product photo uses real product/project and explicit measurement stage without fake task", () => {
  assert.deepEqual(measurementUploadFields({projectId:"project",taskId:"task"}),{projectId:"project",taskId:"task",category:"MEASUREMENT"});
  assert.deepEqual(measurementUploadFields({projectId:"project",productId:"product",stage:"PRODUCTION"}),{projectId:"project",productId:"product",category:"MEASUREMENT",stage:"PRODUCTION"});
});
test("missing, mixed and invalid-stage measurement contexts never form an upload", () => {
  for (const context of [{projectId:"project"},{projectId:"project",taskId:"task",productId:"product",stage:"PRODUCTION"},{projectId:"",productId:"product",stage:"PRODUCTION"},{projectId:"project",productId:"product",stage:"INSTALLATION"}]) {
    assert.throws(() => measurementUploadFields(context as MeasurementUploadContext));
  }
});
