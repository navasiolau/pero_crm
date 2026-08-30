import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";

// Параметры по OWASP Password Storage Cheat Sheet: 19 MiB памяти, t=2, p=1.
// Соль и параметры зашиваются в строку хэша, verify читает их из неё.
const ARGON2_OPTS = { memory: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2_OPTS);
}

export function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  return argon2Verify(passwordHash, password);
}
