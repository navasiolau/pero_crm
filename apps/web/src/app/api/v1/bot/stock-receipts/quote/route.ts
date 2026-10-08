import { stockPurchaseHttp } from "@/server/warehouse/stock-purchase-http";
export async function POST(request: Request) { return stockPurchaseHttp(request, "quote"); }
