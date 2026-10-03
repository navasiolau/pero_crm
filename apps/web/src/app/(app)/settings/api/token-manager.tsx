"use client";

import { useState, useTransition } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createToken, revokeToken } from "@/server/plugins/actions";

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const AVAILABLE_SCOPES = [
  {id:"calendar.reminders",label:"calendar.reminders — доставка личных напоминаний"},
  { id: "read", label: "read — чтение" },
  { id: "write", label: "write — команды и операции" },
  { id: "admin", label: "admin — полный доступ" },
];

export function TokenManager({ tokens }: { tokens: TokenRow[] }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleScope(scope: string, checked: boolean) {
    setScopes((prev) =>
      checked ? [...prev, scope] : prev.filter((s) => s !== scope),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await createToken(name, scopes);
            if (result.ok && result.token) {
              setCreatedToken(result.token);
              setName("");
              toast.success("Токен создан");
            } else {
              toast.error(result.error ?? "Не удалось создать токен");
            }
          });
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-56 flex-col gap-1.5">
            <Label htmlFor="token-name">Название</Label>
            <Input
              id="token-name"
              placeholder="Например: Telegram-бот"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-4">
            {AVAILABLE_SCOPES.map((scope) => (
              <label
                key={scope.id}
                className="flex items-center gap-1.5 text-sm"
              >
                <Checkbox
                  checked={scopes.includes(scope.id)}
                  onCheckedChange={(checked) =>
                    toggleScope(scope.id, checked === true)
                  }
                />
                {scope.label}
              </label>
            ))}
          </div>
          <Button type="submit" disabled={pending || scopes.length === 0}>
            <Plus className="mr-1 size-4" /> Создать
          </Button>
        </div>
      </form>

      {createdToken ? (
        <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <code className="flex-1 truncate text-sm">{createdToken}</code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(createdToken);
              toast.success("Скопировано");
            }}
          >
            <Copy className="mr-1 size-4" /> Копировать
          </Button>
        </div>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Название</TableHead>
            <TableHead>Префикс</TableHead>
            <TableHead>Права</TableHead>
            <TableHead>Создан</TableHead>
            <TableHead>Последнее использование</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {tokens.map((token) => (
            <TableRow key={token.id}>
              <TableCell>{token.name}</TableCell>
              <TableCell>
                <code>{token.prefix}…</code>
              </TableCell>
              <TableCell className="space-x-1">
                {token.scopes.map((scope) => (
                  <Badge key={scope} variant="secondary">
                    {scope}
                  </Badge>
                ))}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {new Date(token.createdAt).toLocaleString("ru-RU")}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {token.lastUsedAt
                  ? new Date(token.lastUsedAt).toLocaleString("ru-RU")
                  : "—"}
              </TableCell>
              <TableCell className="text-right">
                {token.revokedAt ? (
                  <Badge variant="destructive">отозван</Badge>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Отозвать токен"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await revokeToken(token.id);
                        if (result.ok) {
                          toast.success("Токен отозван");
                        } else {
                          toast.error(result.error ?? "Ошибка");
                        }
                      })
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {tokens.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={6}
                className="text-center text-muted-foreground"
              >
                Токенов пока нет
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
