import assert from "node:assert/strict";
import test from "node:test";
import {navItemsForRole} from "../src/lib/nav";
import type {Role} from "@prisma/client";
test("cancelled finish catalogue is absent for every real role union while product navigation remains",()=>{
 const roles:Role[]=["ADMIN","DIRECTOR","MANAGER","PROCUREMENT","ENGINEER","ACCOUNTANT","WORKER","MOUNTER"];
 for(const role of roles) assert.equal(navItemsForRole([role]).some(item=>item.href==="/finishes"),false);
 assert.ok(navItemsForRole(["MANAGER","ENGINEER"]).some(item=>item.href==="/products"));
});
