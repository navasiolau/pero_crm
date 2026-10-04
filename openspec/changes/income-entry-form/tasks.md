# Tasks

## 1. Форма и связь статьи

- [x] 1.1 RED→GREEN: явно выбранная активная статья сохраняется для INCOME, неизвестная/деактивированная не записывается; деньги/nullable project/Expense requirement регрессии PASS.
- [x] 1.2 Передать active existing articles loader→view→dialog; статья первая, optional project второй/number-only, placeholder «Комментарий к приходу»; component/controller assertions PASS.
- [ ] 1.3 Исправить shared dialog intrinsic grid и bounded поля/адаптивную money row; реальные scrollWidth/clientWidth/bounding boxes/видимость footer на1440×900/390×844/360×800 подтверждены.

## 2. Проверка и staging

- [x] 2.1 Existing local native OUTERROLLBACK подтверждает INCOME selectedFK/project-null и project-linked/сохранность исходных денег, без providers; source tests/TSC/lint/build/strict OpenSpec и independent review PASS.
- [ ] 2.2 Ordinary commit/merge staging, CI PASS и actual deployed revision/image/health подтверждены; main/production не меняются.
- [ ] 2.3 Actual staging native selectedFK/money snapshots и focused browser поля/комментарий/options/геометрия на3viewports PASS с real observations/screenshots; собственные QA effects очищены и исходные данные сохранены.
