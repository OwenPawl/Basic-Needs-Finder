import { describe, expect, it } from "vitest";
import {
  canActAsStudent,
  canStaffLocation,
  isCampusAdmin,
  parseSession,
  sessionStage,
} from "../src/lib/session";

const campus = "00000000-0000-4000-8000-000000000001";
const union = "00000000-0000-4000-8000-000000000010";
const mail = "00000000-0000-4000-8000-000000000011";
const base = {
  user: { id: "00000000-0000-4000-8000-000000000901", display_name: "Rowan" },
  email_confirmed: true,
  memberships: [
    {
      membership_id: "00000000-0000-4000-8000-000000000921",
      campus_id: campus,
      campus_name: "Demo Campus",
      campus_is_demo: true,
      role: "staff",
      verified: true,
      staff_location_ids: [union],
    },
  ],
};

describe("session contract", () => {
  it("parses the RPC shape and rejects unknown roles", () => {
    expect(parseSession(base).memberships[0].role).toBe("staff");
    expect(() =>
      parseSession({
        ...base,
        memberships: [{ ...base.memberships[0], role: "owner" }],
      }),
    ).toThrow();
  });

  it("reports the next onboarding step", () => {
    expect(sessionStage(parseSession({ ...base, user: null }))).toBe(
      "needs-profile",
    );
    expect(
      sessionStage(parseSession({ ...base, email_confirmed: false })),
    ).toBe("needs-email-confirmation");
    expect(sessionStage(parseSession({ ...base, memberships: [] }))).toBe(
      "needs-campus-verification",
    );
    expect(sessionStage(parseSession(base), campus)).toBe("verified");
  });

  it("scopes staff authority to assigned locations of a verified membership", () => {
    const session = parseSession(base);
    expect(canActAsStudent(session, campus)).toBe(true);
    expect(canStaffLocation(session, campus, union)).toBe(true);
    expect(canStaffLocation(session, campus, mail)).toBe(false);
    expect(isCampusAdmin(session, campus)).toBe(false);
    const unverified = parseSession({
      ...base,
      memberships: [{ ...base.memberships[0], verified: false }],
    });
    expect(canActAsStudent(unverified, campus)).toBe(false);
    expect(canStaffLocation(unverified, campus, union)).toBe(false);
  });
});
