import { prisma } from "./prisma";

export interface OrgHeader {
  name: string;
  address: string;
}

// Used only if the singleton row (id: 1) is missing, e.g. a DB that was
// migrated but never seeded — reports should still render, not 500.
const FALLBACK: OrgHeader = { name: "Makthab", address: "" };

// Institution letterhead (name + address) shown atop every generated PDF/XLSX
// report. Backed by the OrgProfile singleton table — see schema.prisma for
// the multi-tenant seam this sets up.
export async function getOrgHeader(): Promise<OrgHeader> {
  // The active profile is the institution letterhead. Fall back to the lowest-id
  // row if none is flagged active (e.g. a partially-migrated DB), then to a
  // constant so reports never 500.
  const row =
    (await prisma.orgProfile.findFirst({ where: { isActive: true } })) ??
    (await prisma.orgProfile.findFirst({ orderBy: { id: "asc" } }));
  return row ? { name: row.name, address: row.address } : FALLBACK;
}
