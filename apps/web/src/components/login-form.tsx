"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"

import { authenticate } from "@/app/login/actions"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Входим…" : "Войти"}
    </Button>
  )
}

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [errorMessage, formAction] = useActionState(authenticate, undefined)

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">С возвращением</CardTitle>
          <CardDescription>
            Войдите в свою учётную запись PERO CRM
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@pero.local"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Пароль</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>
              {errorMessage && (
                <p className="text-sm text-destructive" role="alert">
                  {errorMessage}
                </p>
              )}
              <Field>
                <SubmitButton />
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
