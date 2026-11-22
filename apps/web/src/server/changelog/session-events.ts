/** Коды входа и выхода, известные исторической модели журнала. */
export const journalSessionEventWhere = {
  entity: { in: ["user", "authentication", "session"] },
  action: { in: ["login", "logout", "auth.login", "auth.logout", "session.login", "session.logout", "signIn", "signOut"] },
};
