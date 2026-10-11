# Tasks

## 1. RED контрактов таймера

- [x] 1.1 Зафиксировать actual action/core RED для719/720/721/1200минут по manualstop/switch/completion/autostop и oldclosedminutes0; tests показывают uncapped1200/несогласованныйstop/переписываниеhistory до production правок.
- [x] 1.2 Зафиксировать stale stop/autostop race и ordinary reassignment с работающим timer; state tests доказывают closed720 не меняется, старая запись пользователя закрывается атомарно, IN_PROGRESS/engineeringreject/recipient/quantity guards сохраняются.

## 2. Общий механизм

- [x] 2.1 Реализовать pure snapshot и central stop/start вtime/timers.ts; injectedclock tests719/720/721/1200/0/59sec подтверждают minutes/deadline/autoStopped, live same-taskID сохранён, closedtimer/manualhistory не выбраны.
- [x] 2.2 Включить getActiveTimer/autostop/explicitstop вexistingwithTaskTransaction и подключить commonhelper; actual action Rolematrix/lateCAS tests показывают auth/execution-beforewrite, own/currenttaskscope и no secondactive/no closedoverwrite.
- [x] 2.3 Заменить completion private timer/rawUPDATE наcommonhelper сединственным instant; actualcompletion/time/spent/payroll/engineering/quantity tests подтверждают cap и unchanged financial/status/manual contracts, publicsignature unchanged.
- [x] 2.4 Подключить actualordinary assignee-change close доtaskupdate втойжеtransaction; auditfailure rollback/IN_PROGRESSkeep/noautostartnewuser/engineeringreject tests PASS.

## 3. Совместимость и локальная проверка

- [x] 3.1 Сохранить time-autostop-role-boundary/product-delete-timer tests, адаптировать только legitimate transaction/query fixtures/internal-callcount кstrongerstate assertions; прежние5role grants/revoked/deleted/noauth иserializeddelete/start проходят.
- [x] 3.2 Проверить actual manual721/1200/1440allowed и1441reject для office/combined; purefield/readonlyfinance denied, historicalclosed0/1200/manual1200exactlyunchanged. Manual/spent source diff0.
- [x] 3.3 Выполнить relevant task/time/work/engineering/softdelete/RoleUnion suites, agreedtsc/scopedlint/diff/OpenSpec; evidence содержит exact команды/уровни/PASS, метрики4formulas→1/legacyrawUPDATE0 без удаления полезныхtests.

## 4. Native и независимое ревью

- [x] 4.1 Создать inert nativeexisting5433runner сexactownedmanifest/sourcepins/PRE/outbounddeny/rootquiescentapproval иlockedFK/fingerprintcleanup; independent PROTOCOL_GO/root EXECUTE_ONCE получены доSQL.
- [x] 4.2 Выполнить actual2clientconcurrency start/switch/stop/autostop/completion/reassign сinjectedclock иactualSQL; oneactive/cap720/lateclosedimmutable/manualhistory/auditrollback, exactcleanup/fullprotectedFP/own0/disconnect PASS, unexpectedSTOPбезretry/cleanup.
- [x] 4.3 Пройти independent FINAL_CODE_REVIEW_GO exact4source/6tests иfocusedreruns замечаний; исходники соседних133/130неперенесены, integration risks явно переданыroot.

## 5. Actual staging

- [ ] 5.1 Только послеownercommitpermission/normalmerge/CI проверитьactualstagingSHA/image/health/W07, sameHTTP/browser/nativeclock-role-race scenarios иviewportbaseline1440×900/390×844/360×800; сохранностьprotecteddata подтверждена,132/133affectedintegrationповторноaccepted. Main/productionнеизменены; localproofневыдаётсязаstagePASS.
