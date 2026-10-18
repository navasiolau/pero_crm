import { auth } from "@/auth";
import { verifyApiToken } from "@/server/plugins/tokens";
import { createKpApiHandler } from "./api-router";
import { createKpRequestAuthorizer } from "./api-auth";
import { kpAuthStore } from "./api-auth-db";
import { isKpEnabled } from "./config";

const authorize = createKpRequestAuthorizer({ store: kpAuthStore, verify: verifyApiToken, session: async () => auth(),
  configuredOrigin: process.env.AUTH_URL ?? process.env.NEXTAUTH_URL });
/** Production adapters загружаются после feature/auth gates, без импортных side effects. */
export const handleKpApi = createKpApiHandler({ enabled: isKpEnabled, authorize,
  service: { execute: async (action, context, input) => (await import("./api-service")).kpApiService.execute(action, context, input) } });
