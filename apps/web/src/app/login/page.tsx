import Link from "next/link"
import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { LoginForm } from "@/components/login-form"
import { Logo } from "@/components/logo"

export default async function LoginPage() {
  const session = await auth()
  if (session?.user) {
    redirect("/")
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link
          href="/login"
          className="flex items-center gap-2 self-center font-medium"
        >
          <Logo className="size-7" />
          PERO CRM
        </Link>
        <LoginForm />
      </div>
    </main>
  )
}
