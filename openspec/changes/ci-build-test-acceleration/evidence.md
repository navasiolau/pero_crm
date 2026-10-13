# Evidence

## Independent preparation

- 13.10.2026: `feature/170` создана от свежего `origin/staging=e986e2900f9a7911b4863ec3e6e3ecae3715545a`; номер 170 отсутствовал в local/remote refs всех трёх типов задачи.
- Прочитаны AGENTS, README, действующий план, OpenSpec и `D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md`. Infra, env, БД и HTTP-стенды не запускались.
- Diff сохраняет команды существующих suites, Node process isolation, отдельный lint, полный web tsc после Next build и bot tsc. `test` требует `success` обоих независимых jobs; jobs публикации по-прежнему имеют `needs: test`.
- Кэш готовой `.next` и fixture data отсутствует: Next кэширует только `.next/cache`, TypeScript — отдельный `tsconfig.tsbuildinfo`. Ключи/restore prefixes включают ОС, архитектуру, фактическую Node, lockfile и конфигурацию; ключи также включают исходники. Glob исходников не заходит в workspace `node_modules`.
- Docker dependency layers содержат все существующие workspace manifests до install, исходники web/packages идут после install. GHA scopes web/bot различаются.
- `git diff --check` прошёл на независимом diff. Полные локальные lint/types/config проверки назначены один раз после завершения кода и accepted normal merge №169; на этой подготовительной точке они ещё не запускались.

## Acceptance boundary

Runtime, MinIO Dockerfile и native cases №169 ещё не находятся в исходном staging №170. Переноса файлов или merge непринятого №169 нет. Приёмка native и фактическое ускорение №170 пока не подтверждены; main/production исключены.
