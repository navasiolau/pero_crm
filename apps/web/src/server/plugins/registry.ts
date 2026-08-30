import { demoPlugin } from "@pero/plugin-demo";
import { fileStagesPlugin } from "@pero/plugin-file-stages";
import {
  CURRENT_API_VERSION,
  type PluginManifest,
} from "@pero/plugin-sdk";

// Реестр установленных плагинов. Установка ручная (§14): добавить пакет в
// packages/plugins/<id>, подключить workspace-зависимостью в apps/web и
// вписать манифест сюда.
const registry: PluginManifest[] = [demoPlugin, fileStagesPlugin];

export function listManifests(): PluginManifest[] {
  return registry;
}

export function getManifest(id: string): PluginManifest | undefined {
  return registry.find((p) => p.id === id);
}

/** Совместимость по Plugin API: текущая версия ядра N и предыдущая N-1. */
export function isApiCompatible(manifest: PluginManifest): boolean {
  return (
    manifest.apiVersion === CURRENT_API_VERSION ||
    manifest.apiVersion === CURRENT_API_VERSION - 1
  );
}
