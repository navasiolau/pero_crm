"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TelegramLinkDialog } from "@/components/telegram-link-dialog";

export function TelegramFinanceLinkSettings() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setOpen(true)}>Telegram</Button>
      <TelegramLinkDialog open={open} onOpenChange={setOpen} onUnlinked={() => window.location.replace("/telegram/finance")} />
    </>
  );
}
