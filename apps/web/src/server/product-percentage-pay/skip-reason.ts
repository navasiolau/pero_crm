/** Постоянная бизнес-причина; тот же текст защищён SQL-триггером №126. */
export const NO_ASSIGNEE_COMPLETION_REASON = "Сотрудник не назначен при завершении";

export function isPermanentUnassignedCompletion(completion: { state: string; reason?: string | null }) {
  return completion.state === "SKIPPED_ONCE" && completion.reason === NO_ASSIGNEE_COMPLETION_REASON;
}
