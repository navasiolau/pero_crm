"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/auth";

export async function authenticate(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.type === "CredentialsSignin") {
        return "Неверный email или пароль";
      }
      return "Что-то пошло не так. Попробуйте ещё раз.";
    }
    // NEXT_REDIRECT при успешном входе — пробрасываем дальше
    throw error;
  }
}
