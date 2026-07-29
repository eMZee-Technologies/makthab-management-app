import { roleRepository } from "../db";

// Resolve a role NAME to its permission-key set (from the DB-backed Role row).
// Used at login/refresh to bake permissions into the access token. An unknown
// role name (or a corrupt permissions column) resolves to no permissions rather
// than throwing — the user simply can't reach anything guarded.
export async function resolvePermissions(roleName: string): Promise<string[]> {
  const role = await roleRepository.findByName(roleName);
  if (!role) return [];
  try {
    const parsed = JSON.parse(role.permissions);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}
