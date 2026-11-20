import { z } from "zod";
import { ROLE_VALUES } from "@/lib/roles";
import type { User } from "@prisma/client";

export const userSettingsValue = z.object({
  email: z.email(),
  name: z.string().min(1),
  position: z.string().nullable(),
  phone: z.string().nullable(),
  telegram: z.string().nullable(),
  roles: z.array(z.enum(ROLE_VALUES)).min(1),
  payScheme: z.enum(["PIECE", "PERCENT_PROJECT", "PERCENT_TURNOVER", "NONE"]),
  payPercent: z.string().regex(/^\d+(\.\d+)?$/).nullable(),
  active: z.boolean(),
}).strict();

export const userSettingsChange = z.object({
  before: userSettingsValue,
  after: userSettingsValue,
  revision: z.number().int().nonnegative(),
}).strict();

export function reversibleUserSettings(user: Pick<User, keyof z.infer<typeof userSettingsValue>>) {
  return {
    email: user.email, name: user.name, position: user.position, phone: user.phone, telegram: user.telegram,
    roles: user.roles, payScheme: user.payScheme, payPercent: user.payPercent?.toString() ?? null, active: user.active,
  };
}
