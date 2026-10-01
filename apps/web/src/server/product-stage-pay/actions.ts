"use server";

// Совместимость старых вкладок: ни один прежний endpoint не записывает
// Work/Task-веса, начисления или статус после ввода прямых долей изделия.
const RETIRED = "Настройка старого инженерного фонда закрыта. Обновите карточку изделия и используйте прямые доли участников";
async function retired(): Promise<{ ok: false; error: string }> { return { ok: false, error: RETIRED }; }

export async function configureEngineeringTaskSharesAction(_input: {
  productId: string; workId: string; shares: { taskId: string; units: number; expectedRevision: number }[]; expectedPoolRevision: number;
}) { void _input; return retired(); }
export async function configureEngineeringPoolAction(_input: {
  productId: string; ratePercent: string | null; workWeights: { workId: string; units: number }[]; expectedPoolRevision: number;
}) { void _input; return retired(); }
export async function createEngineeringWorkAction(_input: {
  productId: string; title: string; quantity: string; assigneeId: string; dueAt: Date; estimateMinutes: number;
  poolWeights: { workId: string; units: number }[]; expectedPoolRevision: number;
}) { void _input; return retired(); }
export async function convertUnpaidWorkToEngineeringAction(_input: {
  productId: string; workId: string; poolId: string; poolWeights: { workId: string; units: number }[];
  taskShares: { taskId: string; units: number; expectedRevision: number }[]; expectedPoolRevision: number; requestId: string;
}) { void _input; return retired(); }
export async function closeEngineeringStageAction(_input: { productId: string; expectedPoolRevision: number; requestId: string }) { void _input; return retired(); }
