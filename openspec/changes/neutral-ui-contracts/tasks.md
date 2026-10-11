# Tasks

## 1. Baseline and scope

- [x] 1.1 Получить ROOT_RELEASE для точного scope design.md; подтвердить feature/153 и base d121f0798e963f32d13f52c9bde57c0aa82b7929, source inventory 12/4, отсутствие чужих изменений и уведомление задачи147 об import-hunk conflict.
- [x] 1.2 Сохранить physical/Git source pins существующих 11 source и четырёх tests, compiler/options до изменений; проверки не запускают реальную БД/storage/mutations, артефакты остаются вне коммита.

## 2. Contract move

- [x] 2.1 Перенести дословные определения TaskDetails и FileListItem в lib/task-details.ts и lib/viewable-file.ts; проверить declaration AST/порядок полей/optional/null/TaskStatus, отсутствие новых runtime exports и неизменность getViewableFileSource.
- [x] 2.2 Перенаправить все type consumers из точного source/test списка design.md, сохранив UI runtime imports; RG/AST должен показать одно определение каждого DTO и 0 обратных server→components импортов этих типов.

## 3. Local verification

- [x] 3.1 Сравнить executable emit до/после для существующих 15 файлов с одинаковыми compiler/options, без maps/comments; required результат — равные bytes/runtime-import inventory по каждому пути и только пустой module marker нового type-only модуля.
- [x] 3.2 Проверить неизменность реализации DTO: две дословные declarations, byte-identical executable mapper и существующие meaningful serialization/access/privacy fixtures; полное дополнительное сравнение TaskDetails JSON честно обозначить NOT_RUN_OPTIONAL, отсутствие real DB/storage/mutations подтвердить scope/guards.
- [x] 3.3 Пройти семь существующих suites file-list-view, work-shares-settlement, engineer-access, task-file-list, task-work-reward-ui, plain-file-list, file-list-printing; сохранить реальные counts/exit/output pins, все содержательные assertions и прежние SSR/handler сценарии.
- [x] 3.4 После ROOT_HEAVY_TSC_SLOT пройти TSC --noEmit --incremental false, lint изменённых путей, git diff --check и openspec validate neutral-ui-contracts --strict; сохранить результаты и lockfile/dependency version equality; full75550 проверяет source до единственного последующего удаления unused type-import, final source подтверждён fresh emit/AST/lint по явному root решению; ничего не заявлять за NOT_RUN.

## 4. Review and staging

- [x] 4.1 Пройти независимый review точного source/test diff и доказательств; после CODE_GO создать только атомарный разрешённый владельцем коммит153, проверить path inventory и передать root SHA без push/merge.
- [ ] 4.2 После root normal merge/CI получить фактическую staging-приёмку SHA/image/health и затронутого read-only просмотра задач/файлов, сохранив UI/данные/ACL; до доказательства обозначать STAGING_NOT_RUN, main и production не изменять.
