# Приёмка №199 — 29.10.2026

Исходный staging: afb4c7bc147d907bbd3717a22186978108fb7412. CI40784784669 (№338) остановлен KP_CI_PIPELINE_ERROR/runtime-image-verify/CI_TARGET_REFUSED:kp-runtime-projection. Публикация не выполнялась. Задача и реализация199 согласованы владельцем отдельно.

## Причина

В логе CI Docker29.4.2/overlayfs/io.containerd.snapshotter.v1. Renderer-OCI и renderer-runtime имеют одинаковые manifest e0d854a0981693f538bea16144c797fe2279afeedbc695af7a2435521367528c и config9651daf477b2231b788b10e64d83febe356736e9af3f07d74b3b08d46249f192. Guard ожидает image.Id=configDigest. Read-only local Docker29.6.1 подтвердил Id=Descriptor.digest (index по тегу, manifest при --platform), а не config digest. Новый режим допускает только точный runtime manifest ожидаемого OCI; непроверенный index не принимается.

## Local

- RED на существующем renderer OCI-тесте с настоящей формой containerd metadata: CI_TARGET_REFUSED:kp-runtime-projection.
- GREEN: renderer22/22; runtime target guards13/13. Добавлены отказ чужого ID/Descriptor/index mediaType/platform/layers/order и обязательный полный graph proof до metadata. Graph-only не допускается для bot/final receipt; повреждённый blob отклоняется.
- Проверка CI scheduling PASS; целевой ESLint и Node syntax PASS; git diff --check и strict OpenSpec PASS.
- Общая проверка применяется к renderer smoke, metadata extraction, image migrations, web/fault и template smoke; запуск идёт по проверенному actual image.Id. В image.json configDigest остаётся digest OCI-конфигурации. Labels/provenance/bounds/owner/cleanup guards сохраняются.
- Docker daemon/рабочие сервисы/БД не менялись. Реальный Linux Docker runtime нового кандидата подтверждается только следующим CI; локальные synthetic tests не выдаются за него.

## Staging — принят e9b8eb09

- После явного разрешения владельца: функциональный3550a28c, обычный merge e9b8eb09cef6e1c81272a9dce0e07781dad8e7bf.
- [CI339](https://github.com/navasiolau/pero_crm/actions/runs/40786733614) —7/7 jobs SUCCESS. Linux Docker29 подтвердил renderer projection и smoke; web metadata, package smoke,86/86 image migrations, обычный/fault HTTP runtime и полный cleanup прошли. PostgreSQL81 и HTTP32 PASS; отдельные runtime guards13 PASS.
- Реальный staging автоматически развернул ту же ревизию: web OCI index4345ed68aa6123dd71614c71f8766a2d5d3c8b6277b829232a90517642580514, renderer indexbe9ea85e32e41d05a10f7fb72728bf1f790f0bcfcb8f98f966d069e2a19516a1. Оба healthy, DB ID/startedAt/том и внешний W07 сохранены. Actual native и browser приёмка №197 на этом SHA пройдены; её подробности в logistics-ttn-waiver/evidence.md.
- Main и production не изменялись. Приёмка относится к указанному SHA; последующие code changes требуют проверки затронутого поведения.
