import {
  PERMISSION_KEYS,
  legacyKeysToMatrix,
  matrixToLegacyKeys,
  parseRolePermissionsJson,
  encodeRolePermissionsForStorage,
  encodeRolePermissionsObject,
  toLegacyPermissionKeys,
  effectiveResourceMatrix,
  setResourceAction,
  computeOverrides,
  adminBaselineMatrix,
  clearAllResourceMatrix,
  normalizeRolePermissions,
  type PermissionKey,
} from "@makthab/shared";

describe("permission matrix adapters", () => {
  it("mode all expands to every legacy permission key", () => {
    const keys = matrixToLegacyKeys({ mode: "all" });
    expect(keys.sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it("round-trips Accountant legacy keys through matrix", () => {
    const input: PermissionKey[] = ["fees.manage", "finance.manage", "reports.access"];
    const matrix = legacyKeysToMatrix(input);
    expect(matrix.mode).toBe("matrix");
    const resources = effectiveResourceMatrix(matrix);
    expect(resources.fees).toMatchObject({
      view: true,
      create: true,
      update: true,
      delete: true,
    });
    expect(resources.attendance.view).toBe(false);
    expect(resources.dashboard.view).toBe(true); // implied by other views
    expect(matrixToLegacyKeys(matrix).sort()).toEqual([...input].sort());
  });

  it("round-trips Teacher attendance.mark", () => {
    const input: PermissionKey[] = ["attendance.mark"];
    const matrix = legacyKeysToMatrix(input);
    expect(matrixToLegacyKeys(matrix)).toEqual(input);
    const effective = effectiveResourceMatrix(matrix);
    expect(effective.attendance).toMatchObject({
      view: true,
      create: true,
      update: true,
      delete: false,
    });
  });

  it("parseRolePermissionsJson dual-reads legacy arrays and matrix objects", () => {
    const fromArray = parseRolePermissionsJson(JSON.stringify(["reports.access"]));
    expect(fromArray.mode).toBe("matrix");
    expect(effectiveResourceMatrix(fromArray).reports.view).toBe(true);

    const fromAll = parseRolePermissionsJson(JSON.stringify({ mode: "all" }));
    expect(fromAll).toEqual({ mode: "all" });

    const fromMatrix = parseRolePermissionsJson(
      encodeRolePermissionsForStorage(["fees.manage"])
    );
    expect(toLegacyPermissionKeys(JSON.stringify(fromMatrix))).toEqual(["fees.manage"]);
  });

  it("encodeRolePermissionsForStorage uses mode all for full-access roles", () => {
    expect(JSON.parse(encodeRolePermissionsForStorage([], { isFullAccess: true }))).toEqual({
      mode: "all",
    });
    expect(
      toLegacyPermissionKeys(encodeRolePermissionsForStorage([], { isFullAccess: true }))
    ).toEqual(expect.arrayContaining([...PERMISSION_KEYS]));
  });

  it("corrupt JSON yields empty matrix / no legacy keys", () => {
    expect(toLegacyPermissionKeys("not-json")).toEqual([]);
    expect(toLegacyPermissionKeys("{}")).toEqual([]);
  });

  it("setResourceAction implies view and clearing view clears the row", () => {
    let resources = clearAllResourceMatrix();
    resources = setResourceAction(resources, "fees", "create", true);
    expect(resources.fees).toMatchObject({ view: true, create: true });
    resources = setResourceAction(resources, "fees", "view", false);
    expect(resources.fees).toMatchObject({
      view: false,
      create: false,
      update: false,
      delete: false,
    });
  });

  it("computeOverrides marks diffs from Admin baseline", () => {
    const resources = adminBaselineMatrix();
    resources.fees.delete = false;
    const overrides = computeOverrides(resources);
    expect(overrides.fees).toEqual({ delete: false });
  });

  it("normalizeRolePermissions stores overrides when inheriting", () => {
    const resources = adminBaselineMatrix();
    resources.roles.view = false;
    resources.roles.create = false;
    resources.roles.update = false;
    resources.roles.delete = false;
    const normalized = normalizeRolePermissions({
      mode: "matrix",
      inheritsFromAdmin: true,
      resources,
    });
    expect(normalized.mode).toBe("matrix");
    if (normalized.mode === "matrix") {
      expect(normalized.overrides?.roles).toMatchObject({ view: false });
      expect(JSON.parse(encodeRolePermissionsObject(normalized)).overrides.roles.view).toBe(false);
    }
  });
});
