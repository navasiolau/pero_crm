import type { InlineSaveController } from "./inline-save-controller";
import { flushSketchCriticalFields } from "./product-sketch-ui";
export async function flushProductStatusBarrier(controllers:readonly InlineSaveController[],guards:readonly (()=>Promise<boolean>)[]):Promise<boolean>{
  if(!await flushSketchCriticalFields(controllers))return false;
  for(const guard of guards)if(!await guard())return false;
  return true;
}
