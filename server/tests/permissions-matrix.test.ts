import {
  PERMISSION_KEYS,
  legacyKeysToMatrix,
  matrixToLegacyKeys,
  parseRolePermissionsJson,
  encodeRolePermissionsForStorage,
  toLegacyPermissionKeys,
  effectiveResourceMatrix,
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
    expect(toLegacyPermissionKeys(encodeRolePermissionsForStorage([], { isFullAccess: true }))).toEqual(
      expect.arrayContaining([...PERMISSION_KEYS])
    );
  });

  it("corrupt JSON yields empty matrix / no legacy keys", () => {
    expect(toLegacyPermissionKeys("not-json")).toEqual([]);
    expect(toLegacyPermissionKeys("{}")).toEqual([]);
  });
});
