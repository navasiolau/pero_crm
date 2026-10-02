# Local verification

№34 / feature/34 / file-captions-retired. Root owns Git/runtime/staging and combined visual33–38.

- RED: ordinary caption request reached forbidden storage boundary; SSR FileGrid rendered legacy caption instead of fileName, shared Uploader rendered caption input. Three meaningful failures across API/UI.
- GREEN: new tests5/5; targeted caption/ACL/stage/sketch regression18/18.
- Full web TypeScript PASS via existing pinned compiler.
- Scoped ESLint PASS via root-provided existing-dependency resolver (no dependency/config changes).
- OpenSpec strict validation PASS; root runtime/visual task remains unchecked.

Commands (CWD apps/web):

```text
node node_modules/tsx/dist/cli.mjs --test tests/file-captions-retired.test.ts tests/file-captions-ui.test.ts tests/product-attachments-upload-stage.test.ts tests/product-attachments-upload-acl.test.ts tests/product-sketch-cas.test.ts
node node_modules/typescript/bin/tsc --noEmit --pretty false
node D:/Projects/pero_crm_worktrees/correction-38/.playwright-mcp/corrections/lint-local.mjs <owned source/test paths>
```

No Prisma schema/data migration, DB/runtime/storage/SSH, Git mutation, restic or dumps. Product/Project page changes are caption mapping only. No FileViewer interaction or NoModel changes.
