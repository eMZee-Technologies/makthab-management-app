import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import type { OrgProfile } from "@prisma/client";
import {
  orgProfileCreateSchema,
  orgProfileUpdateSchema,
  orgProfileListQuery,
  type OrgProfileDto,
  type OrgProfileListQuery,
} from "@makthab/shared";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { validateBody, validateQuery } from "../middleware/validate";
import { requireAuth, requirePermission } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { uploadOrgImage, photoContentType } from "../lib/upload";
import { FILES_DIR } from "../lib/paths";

// Institution profiles (letterhead). The single active row is what renders in
// the app header and on generated PDF/XLSX reports. Reads of the active profile
// and its image are open to any authenticated user (the header needs them);
// list + all writes require `org.manage`.
export const orgProfileRouter = Router();
orgProfileRouter.use(requireAuth);

function toDto(row: OrgProfile): OrgProfileDto {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    isActive: row.isActive,
    headerImagePath: row.headerImagePath,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// GET /org-profile/active — the active profile (or null). Any authed role.
orgProfileRouter.get(
  "/active",
  asyncHandler(async (_req, res) => {
    const row =
      (await prisma.orgProfile.findFirst({ where: { isActive: true } })) ??
      (await prisma.orgProfile.findFirst({ orderBy: { id: "asc" } }));
    res.json({ data: row ? toDto(row) : null });
  })
);

// GET /org-profile — list all profiles (Admin / org.manage).
orgProfileRouter.get(
  "/",
  requirePermission("org.manage"),
  validateQuery(orgProfileListQuery),
  asyncHandler(async (_req, res) => {
    const q = res.locals.query as OrgProfileListQuery;
    const orderBy = q.sortBy ? { [q.sortBy]: q.sortOrder } : { name: "asc" as const };
    const items = await prisma.orgProfile.findMany({ orderBy });
    res.json({ data: items.map(toDto) });
  })
);

// POST /org-profile — create a new profile (inactive by default).
orgProfileRouter.post(
  "/",
  requirePermission("org.manage"),
  validateBody(orgProfileCreateSchema),
  asyncHandler(async (req, res) => {
    const dto = req.body as typeof orgProfileCreateSchema._output;
    const row = await prisma.orgProfile.create({
      data: { name: dto.name, address: dto.address },
    });
    res.status(201).json({ data: toDto(row) });
  })
);

// PATCH /org-profile/:id — update fields and/or activate. Setting isActive:true
// unsets every other row's active flag in the same transaction (single-active
// invariant). isActive:false is written as-is (the header falls back to the
// lowest-id row / a constant if that leaves none active).
orgProfileRouter.patch(
  "/:id",
  requirePermission("org.manage"),
  validateBody(orgProfileUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.orgProfile.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "not_found", "Organisation profile not found");

    const dto = req.body as typeof orgProfileUpdateSchema._output;
    const row = await prisma.$transaction(async (tx) => {
      if (dto.isActive === true) {
        await tx.orgProfile.updateMany({ where: { id: { not: id } }, data: { isActive: false } });
      }
      return tx.orgProfile.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
    });
    res.json({ data: toDto(row) });
  })
);

// DELETE /org-profile/:id — remove a profile. Blocked (400) for the active row:
// activate another first so there's always a letterhead to fall back to.
orgProfileRouter.delete(
  "/:id",
  requirePermission("org.manage"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.orgProfile.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "not_found", "Organisation profile not found");
    if (existing.isActive) {
      throw new AppError(400, "active_profile", "Cannot delete the active profile; activate another first");
    }
    if (existing.headerImagePath) {
      await fs.promises.rm(path.join(FILES_DIR, existing.headerImagePath), { force: true }).catch(() => {});
    }
    await prisma.orgProfile.delete({ where: { id } });
    res.json({ data: { id } });
  })
);

// POST /org-profile/:id/image — upload/replace the header background image.
orgProfileRouter.post(
  "/:id/image",
  requirePermission("org.manage"),
  uploadOrgImage,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError(400, "no_file", "No image uploaded (form field must be 'image')");
    }
    const id = Number(req.params.id);
    const existing = await prisma.orgProfile.findUnique({ where: { id } });
    if (!existing) {
      await fs.promises.rm(req.file.path, { force: true });
      throw new AppError(404, "not_found", "Organisation profile not found");
    }
    if (existing.headerImagePath) {
      await fs.promises.rm(path.join(FILES_DIR, existing.headerImagePath), { force: true });
    }
    const headerImagePath = `photos/${req.file.filename}`;
    const row = await prisma.orgProfile.update({ where: { id }, data: { headerImagePath } });
    res.json({ data: toDto(row) });
  })
);

// GET /org-profile/:id/image — stream the header image. Any authed role (the
// app header fetches it via an authed blob request).
orgProfileRouter.get(
  "/:id/image",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const row = await prisma.orgProfile.findUnique({
      where: { id },
      select: { headerImagePath: true },
    });
    if (!row) throw new AppError(404, "not_found", "Organisation profile not found");
    if (!row.headerImagePath) throw new AppError(404, "not_found", "Profile has no image");

    const abs = path.join(FILES_DIR, row.headerImagePath);
    if (!fs.existsSync(abs)) throw new AppError(404, "not_found", "Image file missing");

    res.setHeader("Content-Type", photoContentType(abs));
    const stream = fs.createReadStream(abs);
    stream.on("error", (err) => res.destroy(err));
    stream.pipe(res);
  })
);
