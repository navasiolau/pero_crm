# Design

## Context

Root approved164 onecritical formatter after155atomiccompletion. Existing feature/164 created from freshly fetched publishedorigin/staginged2f00966831597d8d3e9d773cd4efcfba874b3a;155/a6c8095 does not touch thisfile and no dependency merge is needed. Existing dependency160 acceptance confirmed byRoot; unknownexternal owners source preserved.

## Decisions

1. Use installed TypeScript5.9.3 formatter/printer, no new tool versions or source-wide lint rules. Before printing add only line separators at parsed object properties/array elements/conditional question-colon tokens and function params when count>3. Offsets come from same source AST; no regex rewrite of logic. Printer performs spacing/indentation. Stable formatting is required.
2. Compare canonical source AST before/after and TypeScript emittedJS AST before/after with literal text/operator/declaration-kind/typeOnly +children preserved. Ignore source positions/trivia/format-only metadata. Any mismatch STOP beforewrite. No renamed helper/business branch extraction.
3. Preserve comments/messages/SQL strings/templates and financial mutations exactly. Do not execute percentage writers/native DB for whitespace-only work. Targeted existing percentage/legacy tests and source typing/lint suffice; final CI/stage throughRoot.
4. Snapshot/source/formatter outputs are evidence of semantic preservation, not runtime speed/bundle savings. No benchmark or visual matrix added for unchanged UI.

## Migration Plan

No migration. Local semantic/check/review →authorizedowncommit→Root ordinarymerge/stageCI/acceptance. Source/frame/inert changes do not authorize main/production.
