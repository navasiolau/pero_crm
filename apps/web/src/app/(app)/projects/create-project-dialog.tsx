"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/server/clients/actions";
import { createProject } from "@/server/projects/actions";

import type { SelectOption } from "./projects-view";

const CURRENCIES = ["BYN", "RUB", "USD", "EUR"];

// Создание проекта (§6): проект = заказ клиента; изделия с ценами
// и инженерами добавляются позже в карточке проекта (вкладка «Изделия»).
export function CreateProjectDialog({
  open,
  onOpenChange,
  clients,
  managers,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: SelectOption[];
  managers: SelectOption[];
  onCreated: (id: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState("");
  const [managerId, setManagerId] = useState("");
  const [address, setAddress] = useState("");
  const [currency, setCurrency] = useState("BYN");
  // Мини-форма нового клиента
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [localClients, setLocalClients] = useState(clients);

  function reset() {
    setTitle("");
    setClientId("");
    setManagerId("");
    setAddress("");
    setCurrency("BYN");
    setNewClientOpen(false);
    setNewClientName("");
    setNewClientPhone("");
  }

  const valid = title.trim().length > 0 && clientId.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новый проект</DialogTitle>
          <DialogDescription>
            Проект появится в колонке «Лид» на канбане. Изделия с ценами
            добавляются в карточке проекта.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Название заказа *</Label>
            <Input
              id="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Кухня и шкаф для Ивановой…"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Клиент *</Label>
            {newClientOpen ? (
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <Input
                  placeholder="Имя клиента *"
                  value={newClientName}
                  onChange={(event) => setNewClientName(event.target.value)}
                />
                <Input
                  placeholder="Телефон *"
                  value={newClientPhone}
                  onChange={(event) => setNewClientPhone(event.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={
                      pending || !newClientName.trim() || !newClientPhone.trim()
                    }
                    onClick={() =>
                      startTransition(async () => {
                        const result = await createClient({
                          name: newClientName.trim(),
                          phone: newClientPhone.trim(),
                        });
                        if (result.ok && result.id) {
                          setLocalClients((prev) => [
                            ...prev,
                            { id: result.id!, name: newClientName.trim() },
                          ]);
                          setClientId(result.id);
                          setNewClientOpen(false);
                          toast.success("Клиент создан");
                        } else {
                          toast.error(result.error ?? "Ошибка");
                        }
                      })
                    }
                  >
                    Добавить клиента
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setNewClientOpen(false)}
                  >
                    Отмена
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <div className="flex-1">
                  <SearchableSelect
                    options={localClients.map((client) => ({
                      value: client.id,
                      label: client.name,
                    }))}
                    value={clientId}
                    onChange={setClientId}
                    placeholder="Выберите клиента…"
                    searchPlaceholder="Поиск клиента…"
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={() => setNewClientOpen(true)}
                >
                  Новый
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Менеджер</Label>
              <SearchableSelect
                options={managers.map((manager) => ({
                  value: manager.id,
                  label: manager.name,
                }))}
                value={managerId}
                onChange={setManagerId}
                placeholder="не назначен"
                searchPlaceholder="Поиск менеджера…"
                allowClear
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="address">Адрес</Label>
              <Input
                id="address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Адрес объекта"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Валюта</Label>
              <Select
                value={currency}
                onValueChange={(value) => setCurrency(value ?? "BYN")}
              >
                <SelectTrigger>
                  <SelectValue>{currency}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            disabled={!valid || pending}
            onClick={() =>
              startTransition(async () => {
                const result = await createProject({
                  title: title.trim(),
                  clientId,
                  managerId: managerId || undefined,
                  address: address.trim() || undefined,
                  currency,
                });
                if (result.ok && result.id) {
                  toast.success("Проект создан");
                  onOpenChange(false);
                  reset();
                  onCreated(result.id);
                } else {
                  toast.error(result.error ?? "Ошибка");
                }
              })
            }
          >
            {pending ? "Создание…" : "Создать проект"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
