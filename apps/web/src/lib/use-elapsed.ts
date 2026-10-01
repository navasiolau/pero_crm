import { useEffect, useState } from "react";

export function formatElapsed(startedAt: string, now: number): string {
  const total = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function elapsedTextFor(
  startedAt: string | null,
  clock: { startedAt: string | null; now: number | null },
): string {
  if (!startedAt) return "";
  if (clock.startedAt !== startedAt || clock.now === null) return "—";
  return formatElapsed(startedAt, clock.now);
}

export function useElapsed(startedAt: string | null): string {
  const [clock, setClock] = useState<{ startedAt: string | null; now: number | null }>({
    startedAt: null,
    now: null,
  });
  useEffect(() => {
    if (!startedAt) return;
    setClock({ startedAt, now: Date.now() });
    const interval = setInterval(() => {
      setClock({ startedAt, now: Date.now() });
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);
  return elapsedTextFor(startedAt, clock);
}
