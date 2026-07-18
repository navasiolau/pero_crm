"use client";

import { Component, type ReactNode } from "react";

interface Props {
  pluginName: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

// Изоляция ошибок рендера слота: сбойный плагин показывает заглушку,
// остальная страница продолжает работать.
export class SlotErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[plugins] Слот модуля "${this.props.pluginName}" упал:`, error);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-muted-foreground">
          Модуль «{this.props.pluginName}» завершился с ошибкой при отрисовке.
        </div>
      );
    }
    return this.props.children;
  }
}
