"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"

// Бинарный переключатель: только светлая/тёмная, солнце плавно сменяется луной
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={isDark ? "Включить светлую тему" : "Включить тёмную тему"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      <Sun className="scale-100 rotate-0 opacity-100 transition-all duration-500 ease-in-out dark:scale-0 dark:-rotate-90 dark:opacity-0" />
      <Moon className="absolute scale-0 rotate-90 opacity-0 transition-all duration-500 ease-in-out dark:scale-100 dark:rotate-0 dark:opacity-100" />
    </Button>
  )
}
