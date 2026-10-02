"use client";

// Совместимый импорт не открывает старую форму и не вызывает долевые mutations.
export function TaskSplitDialog(_props: {
  task: {id: string; title: string} | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  void _props;
  return null;
}
