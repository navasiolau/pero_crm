import {conversionAssert} from "./planner";
export type PriceOperation="inventory"|"seal"|"apply";
export function validatePricePacket(input:unknown):asserts input is Record<string,unknown>&{operation:"inspect";priceOperation:PriceOperation;revision:string;image:string} {
 conversionAssert(input&&typeof input==="object"&&!Array.isArray(input),"PRICE_PACKET_REQUIRED");const row=input as Record<string,unknown>;
 conversionAssert(row.operation==="inspect","PRICE_OUTER_INSPECT_REQUIRED");conversionAssert(["inventory","seal","apply"].includes(String(row.priceOperation)),"PRICE_OPERATION_REQUIRED");
 const expected=row.priceOperation==="inventory"?["operation","priceOperation","revision","image"]:row.priceOperation==="seal"?["operation","priceOperation","revision","image","manifest","rates"]:["operation","priceOperation","revision","image","manifest","sealed"];
 conversionAssert(Object.keys(row).sort().join("|")===expected.sort().join("|"),"PRICE_UNKNOWN_INPUT_FIELDS_STOP");
}
export function createPricePacket(priceOperation:PriceOperation,payload:Record<string,unknown>) {
 conversionAssert(!Object.hasOwn(payload,"operation")&&!Object.hasOwn(payload,"priceOperation"),"PRICE_PACKET_OPERATION_OVERRIDE_STOP");
 const packet={operation:"inspect" as const,priceOperation,...payload};validatePricePacket(packet);return packet;
}
