# Design
## Context
Foundation54 сохраняет tombstones и фильтрует operational доступ, Finance59 не теряет historical lookup. Timer start55 теперь serialized existingglobalTaskTx. Project delete writer отсутствует; новый handler не вызывает physical Prisma deletes.
## Goals / Non-Goals
**Goals:** atomic parent/livechild tombstones, precise aggregate CAS, retained history, exact warning.
**Non-Goals:** restore UI, финансовые операции, физическое удаление, schema56, runtime/storage/Git агента.
## Decisions
- Baseline read после inlineflush содержит Project.updatedAt и SHA256 sorted children{id,updatedAt,deletedAt,deletedById}; Project.updatedAt не меняется на каждом child write, поэтому один parent CAS недостаточен для stale confirm.
- GlobalTaskTx, lockProject→allProducts ORDER BY id. Manager check до disclosure, receipt project-delete:UUID в same tx с audit.
- Active TimeEntry count через task.projectId охватывает common tasks и любые product tasks. Nullrate/frozen states не обрабатываются, ничего не начисляется.
- updateMany только deletedAt=null children; прежние individual markers не трогаются. Номера остаются уникальными, генераторы54 сохраняют все rows.
- Exactwarning используется в shared dialog; дополнительный текст поясняет сохранение истории. UI redirects /projects только по точному ACK.
## Risks / Trade-offs
- Childmetadata changed → explicit re-confirm, не автоматическая подстановка serverbaseline.
- ORM updatedAt меняется у новых tombstones → это служебный timestamp, monetary fields/snapshots неизменны.
