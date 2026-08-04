import {
  emptyResourceMatrix,
  parseRolePermissionsJson,
  type RolePermissions,
} from "@makthab/shared";
import { roleRepository } from "../db";

export type ResolvedRoleAccess = {
  permissionMatrix: RolePermissions;
  permissionsVersion: number;
};

// Resolve a role NAME to its permission matrix + version (from the DB-backed
// Role row). Used at login/refresh to bake grants into the access token.
// Unknown / corrupt roles resolve to an empty matrix rather than throwing.
export async function resolveRoleAccess(roleName: string): Promise<ResolvedRoleAccess> {
  const role = await roleRepository.findByName(roleName);
  if (!role) {
    return {
      permissionMatrix: {
        mode: "matrix",
        inheritsFromAdmin: false,
        resources: emptyResourceMatrix(),
      },
      permissionsVersion: 0,
    };
  }
  return {
    permissionMatrix: parseRolePermissionsJson(role.permissions),
    permissionsVersion: role.permissionsVersion,
  };
}
