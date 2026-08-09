export type CompanyRole = "PREPARER" | "REVIEWER" | "ADMIN" | "AUDITOR";

export interface ActorContext {
  actorId: string;
  companyRoles: Readonly<Record<string, readonly CompanyRole[]>>;
}

export class AuthorizationError extends Error {
  readonly code = "FORBIDDEN";

  constructor(message = "O ator não possui autorização para esta operação") {
    super(message);
    this.name = "AuthorizationError";
  }
}
export function assertCompanyRole(
  actor: ActorContext,
  companyId: string,
  acceptedRoles: readonly CompanyRole[],
): void {
  const granted = actor.companyRoles[companyId] ?? [];
  if (!acceptedRoles.some((role) => granted.includes(role))) {
    throw new AuthorizationError();
  }
}
