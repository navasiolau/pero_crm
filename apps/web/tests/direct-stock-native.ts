import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { runDirectStockNative } from "./direct-stock-native-scenarios";
import { runDirectStockConcurrent } from "./direct-stock-concurrency-scenarios";
process.loadEnvFile(".env");
const target=new URL(process.env.DATABASE_URL??"");
assert.ok(["localhost","127.0.0.1"].includes(target.hostname)&&target.port==="5433"&&target.pathname==="/pero_crm","LOCAL_TARGET_GUARD");
const db=new PrismaClient();
void (async()=>{console.log(JSON.stringify(await runDirectStockNative(db)));console.log(JSON.stringify(await runDirectStockConcurrent(db,true)));})()
 .catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>db.$disconnect());
