import { orgProfileRepository } from "../db";

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
  const row = await orgProfileRepository.findActiveOrFirst();
  return row ? { name: row.name, address: row.address } : FALLBACK;
}
