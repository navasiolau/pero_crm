# Tasks
## 1. Контракт
- [x] 1.1 FF/apply strictvalidate до code.
- [x] 1.2 RED→GREEN pure URLsecurity/liststate/tab tests.
## 2. Реализация
- [x] 2.1 Helpers и canonical query hook без preference writes; Product server/Header back/delete и ProjectvalidatedTabs.
- [x] 2.2 ProjectProducts/global table+kanban все links с контекстом, прежние layouts/fullscreen52 untouched; targeted tests.
## 3. Проверки
- [x] 3.1 Direct tests/typecheck/lint, sourcefreeze Root.
- [ ] 3.2 Root actual staging после ordinary merge.

Проверки: initial new test RED (отсутствующий helper), затем 10 navigation cases GREEN: URL allowlist, canonical list state, actual Tabs SSR/Header link/delete callback/table row/mobile links. Whole typecheck PASS; scoped lint existing canonical module closure PASS0/0. Dependencies localofflinefrozenignorescripts, localPrisma generate только private worktree, без DB. Runtime/hosted пока не проверены; root3.2 pending.
