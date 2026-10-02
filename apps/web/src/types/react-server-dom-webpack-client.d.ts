// Next 15.5.20 подставляет для публичного React Flight модуля свой bundled client.
// Новых runtime-зависимостей нет; сигнатуры сверены с установленными exports.
declare module "react-server-dom-webpack/client" {
  export function createTemporaryReferenceSet(): Map<unknown, unknown>;
  export function encodeReply(value: unknown, options?: { temporaryReferences?: Map<unknown, unknown> }): Promise<string | FormData>;
  export function createFromFetch(response: Promise<Response>, options: { temporaryReferences?: Map<unknown, unknown>; callServer?: (id: string, args: unknown[]) => Promise<unknown> }): Promise<{ a: unknown; f?: unknown }>;
}
