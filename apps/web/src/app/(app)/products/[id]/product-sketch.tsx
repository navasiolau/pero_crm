"use client";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { useOptionalProductInline } from "@/components/product-inline-provider";
import { ProductCoverLayout } from "./product-sketch-view";
export { ProductCoverLayout } from "./product-sketch-view";
export function ProductCoverClient(props:Omit<ComponentProps<typeof ProductCoverLayout>,"onRefresh"|"beforeMutation"|"registerGuard">){
  const router=useRouter();
  const inline=useOptionalProductInline();
  async function flushCritical(){
    if(!inline)return true;
    const saved=await Promise.all((["expectedPrice","quantity","engineerId"] as const).map(field=>inline.controller(field).flush()));
    return saved.every(Boolean);
  }
  return <ProductCoverLayout {...props} onRefresh={()=>router.refresh()} beforeMutation={flushCritical} registerGuard={inline?.registerGuard} />;
}
