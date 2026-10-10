-- Новые логистические расходы относятся непосредственно к проектам, без статьи.
-- Исторические ненулевые связи и денежные снимки сохраняются.
ALTER TABLE "LogisticsPosting" ALTER COLUMN "expenseArticleId" DROP NOT NULL;
-- check_logistics_posting_total уже использует IS DISTINCT FROM: NULL/NULL допустим,
-- несовпадение статьи исторического проведения и его Payment по-прежнему запрещено.
