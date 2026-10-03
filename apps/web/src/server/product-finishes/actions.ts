"use server";
import { auth } from "@/auth";
import { patchProductFinishCore } from "./core";
import type { ProductFinishCommand, ProductFinishResult } from "./contracts";
export async function patchProductFinishAction(input:ProductFinishCommand):Promise<ProductFinishResult>{const session=await auth();if(!session?.user)return{kind:"forbidden",error:"Не авторизован"};return patchProductFinishCore({id:session.user.id,name:session.user.name??"",roles:session.user.roles,source:"web"},input);}
