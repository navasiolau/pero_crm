# Tasks

## 1. Implementation
- [x] 1.1 Сгруппировать поля, добавить точный integer step/draft helper; проверить границы/NULL/точную сумму/CAS/lost ACK тестами.
- [x] 1.2 Обновить header, ставки и два текстовых узла; проверить TypeScript и scoped lint, согласовать sticky removal с №43.

## 2. Validation
- [x] 2.1 Выполнить focused tests и strict OpenSpec validate.
- [ ] 2.2 Root проводит интеграцию, runtime/визуальную/staging приёмку.

## Evidence

Четыре новых input/draft/CAS/lostACK теста и 18 существующих quantity/scaling проверок: 22/22 PASS. TypeScript и scoped lint всех семи изменённых UI/helper файлов: PASS, 0 warnings/errors. Два согласованных текстовых узла удалены; sticky/top20 принадлежат №43 и переданы root для интеграции. Runtime/DB/browser/визуальные проверки не запускались; 2.2 остаётся открытым.
