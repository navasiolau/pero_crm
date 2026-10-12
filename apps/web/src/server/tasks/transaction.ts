// Совместимые имена сохраняют identity общего адаптера и существующие callers/DI.
export {createMutationTransaction as createTaskTransaction,
  withMutationTransaction as withTaskTransaction,
  type MutationTransaction as TaskTransaction} from "@/server/transactions/coordinator";
