import { toLegacyPermissionKeys } from "@makthab/shared";
import { roleRepository } from "../db";

// Resolve a role NAME to its permission-key set (from the DB-backed Role row).
// Used at login/refresh to bake permissions into the access token. Supports
// dual-read: legacy JSON string[] OR RolePermissions matrix / { mode: "all" }.
// An unknown role name (or a corrupt permissions column) resolves to no
// permissions rather than throwing — the user simply can't reach anything guarded.
export async function resolvePermissions(roleName: string): Promise<string[]> {
  const role = await roleRepository.findByName(roleName);
  if (!role) return [];
  return toLegacyPermissionKeys(role.permissions);
}
