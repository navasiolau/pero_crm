# Evidence

## Independent preparation

- 13.10.2026: `feature/170` создана от свежего `origin/staging=e986e2900f9a7911b4863ec3e6e3ecae3715545a`; номер 170 отсутствовал в local/remote refs всех трёх типов задачи.
- Прочитаны AGENTS, README, действующий план, OpenSpec и `D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md`. Infra, env, БД и HTTP-стенды не запускались.
- Diff сохраняет команды существующих suites, Node process isolation, отдельный lint, полный web tsc после Next build и bot tsc. `test` требует `success` обоих независимых jobs; jobs публикации по-прежнему имеют `needs: test`.
- Кэш готовой `.next` и fixture data отсутствует: Next кэширует только `.next/cache`, TypeScript — отдельный `tsconfig.tsbuildinfo`. Ключи/restore prefixes включают ОС, архитектуру, фактическую Node, lockfile и конфигурацию; ключи также включают исходники. Glob исходников не заходит в workspace `node_modules`.
- Docker dependency layers содержат все существующие workspace manifests до install, исходники web/packages идут после install. GHA scopes web/bot различаются.
- `git diff --check` прошёл на независимом diff. В точке `37b79f5` локальные lint/types/config ещё не запускались; после отдельного разрешения разработческой зависимости и завершения кода проведены проверки ниже.

## Local validation

- Locked dependencies установлены в собственный worktree `pnpm install --frozen-lockfile --ignore-scripts`; Prisma Client 6.19.3 сгенерирован без соединений. Offline store сначала оказался неполным; frozen install завершился с неизменным lockfile. Версии и manifests относительно №169 не изменены.
- `next typegen` сгенерировал свежие `apps/web/.next/types/routes.d.ts` и `validator.ts`; production build, сервер, DB/S3/HTTP не запускались. Next 15.5.20 подключает `NextTypesPlugin` по `hasAppDir && !isClient`, независимо от `ignoreBuildErrors`; встроенная проверка по-прежнему не покрывает `*.test.*` и `__tests__`.
- PASS: полный `pnpm --filter @pero/web exec node node_modules/typescript/bin/tsc --noEmit --incremental false`, включая test-файлы и свежие route types.
- PASS: affected ESLint `next.config.ts` и `tests/integration/runtime/containers.mjs`. Прямой Node запуск первоначально не получил `NODE_PATH` pnpm CMD shim; после указания существующего собственного virtual store lint прошёл. Зависимости или ESLint-конфигурация ради этого не менялись.
- CONFIG_PASS: YAML parse, синтаксис трёх inline Node scripts и runtime; `test` проверяет success всех трёх jobs, native зависит от успешных unit/build, публикация по-прежнему `needs: test`; ровно одна команда Next build и сохранённая команда suites. Проверены cache paths, связка artifact/точной Node и все workspace manifests до Docker install.
- Четыре проверки реального Next config loader подтвердили: только `GITHUB_ACTIONS=true` вместе с `PERO_CI_EXTERNAL_CHECKS=1` отключает встроенный lint/types. В остальных трёх сочетаниях встроенные проверки остаются. Runtime при этом не вызывался и GITHUB context для стенда не подменялся.
- PASS: `openspec validate ci-build-test-acceleration --strict`, `git diff --check`. Новых тестовых файлов, QA helpers/framework, benchmark, unit/native/CI-прогонов нет. MinIO Dockerfile, pins, тестовые cases, DB/S3 guards, process drain, tmpfs и cleanup сохранены; runtime дополнительно требует текущий Buildx image ID и точный `GITHUB_JOB=native-tests` перед start.

## Expected effect

Warm MinIO layer cache устраняет повторную source-компиляцию, исторически занимавшую 209,45 с. CI убирает встроенный повтор Next lint/types, исторически 53,29 с, а unit и build/checks перекрывают время независимых jobs. Next compiler и отдельный TypeScript incremental cache дополнительно сокращают повторную работу. Cold cache, загрузка артефакта и runner влияют на фактический результат; коэффициент ускорения пока не измерен и не заявляется. Ускорение unit между private/public runner не приписывается №170.

## Acceptance boundary

Runtime, MinIO Dockerfile и native cases №169 ещё не находятся в исходном staging №170. После отдельного поручения владельца выполнен разработческий normal merge `feature/169=8a0f0aec85b1c32e941edbfd5d4cd8469419b360` только в `feature/170`; merge commit `bd02d42f410b33e6b21e317245252c7922b0d9c3` сохранил обе ancestry. Единственный конфликт workflow разрешён с переносом исходных synthetic services/credentials/tmpfs/cleanup в обязательный `native-tests` job. Staging/main и тестовые файлы №169 не изменялись агентом №170. Принятая зависимость ещё должна прийти normal merge свежего staging. Приёмка native и фактическое ускорение №170 пока не подтверждены; main/production исключены.
