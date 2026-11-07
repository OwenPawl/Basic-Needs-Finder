import { z } from "zod";

// Session contract returned by the `my_session`, `upsert_profile`, and
// `verify_campus_membership` RPCs (prisma/migrations/202611070004_student_auth).
// It never contains email or other contact data. UI code may use these helpers
// to decide what to show, but every mutation is authorized again in the
// database; hiding a button is not authorization.

const membership = z.object({
  membership_id: z.uuid(),
  campus_id: z.uuid(),
  campus_name: z.string(),
  campus_is_demo: z.boolean(),
  role: z.enum(["student", "staff", "admin"]),
  verified: z.boolean(),
  staff_location_ids: z.array(z.uuid()),
});

export const sessionSchema = z.object({
  user: z.object({ id: z.uuid(), display_name: z.string() }).nullable(),
  email_confirmed: z.boolean(),
  memberships: z.array(membership),
});

export type Session = z.infer<typeof sessionSchema>;
export type Membership = z.infer<typeof membership>;

export function parseSession(value: unknown): Session {
  return sessionSchema.parse(value);
}

/** Next onboarding step for a signed-in account. */
export type SessionStage =
  | "needs-profile"
  | "needs-email-confirmation"
  | "needs-campus-verification"
  | "verified";

export function sessionStage(
  session: Session,
  campusId?: string,
): SessionStage {
  if (!session.user) return "needs-profile";
  if (!session.email_confirmed) return "needs-email-confirmation";
  return verifiedMembership(session, campusId)
    ? "verified"
    : "needs-campus-verification";
}

export function verifiedMembership(
  session: Session,
  campusId?: string,
): Membership | undefined {
  return session.memberships.find(
    (m) => m.verified && (!campusId || m.campus_id === campusId),
  );
}

export function canActAsStudent(session: Session, campusId: string): boolean {
  return Boolean(verifiedMembership(session, campusId));
}

export function canStaffLocation(
  session: Session,
  campusId: string,
  locationId: string,
): boolean {
  const m = verifiedMembership(session, campusId);
  return Boolean(
    m &&
    (m.role === "staff" || m.role === "admin") &&
    m.staff_location_ids.includes(locationId),
  );
}

export function isCampusAdmin(session: Session, campusId: string): boolean {
  return verifiedMembership(session, campusId)?.role === "admin";
}
