# Tasks

## 1. Простое поле и перенос
- [x] 1.1 Ограничить Product projection соответствующими характеристиками и добавить прямое изменение пустой строки; проверить исключение мусора, CAS/generation/replay unit/native tests.
- [x] 1.2 Заменить карточку и создание плоским списком без кнопок/комментариев, добавить autosave ввода; проверить без blur/IME/flush/повтор и desktop/mobile UI.

## 2. Проверка и staging
- [x] 2.1 Пройти typecheck/lint/build, затронутые тесты и независимый review; проверить простое поле и перенос на существующей local DB, сохранить screenshots/evidence.
- [x] 2.2 Normal commit/merge/push staging, штатный CI/deployment; root проверяет actual SHA/образ, ввод и reload без дополнительных нажатий, ограниченный перенос из КП, фиксирует приёмку.
