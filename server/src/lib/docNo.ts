import { feePaymentRepository, expenseRepository } from "../db";

// Human-readable, unique document numbers. Counts are safe under the API's
// single-writer request handling; the unique DB constraint is the backstop.

function stamp(d = new Date()): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Filesystem/URL-safe token derived from a free-text admission number (mirrors
// the same sanitization used for staff/student photo filenames in upload.ts) —
// admissionNo has no format constraint at the schema level, and this string
// also becomes part of the receipt's on-disk PDF filename.
function safeToken(s: string): string {
  return s.trim().replace(/[^a-zA-Z0-9_-]/g, "_") || "NA";
}

// Next running sequence (4-digit, zero-padded) among existing receiptNo values
// starting with `prefix`, where the whole remainder after `prefix` IS the
// sequence (used by the plain fallback scheme below). Derived from the max
// existing suffix, not count(): payments can be hard-deleted, so count()+1
// could collide with a surviving receiptNo (@unique). Same fix as
// nextVoucherNo below.
async function nextSeq(prefix: string): Promise<string> {
  const receiptNos = await feePaymentRepository.findReceiptNosStartingWith(prefix);
  const maxSeq = receiptNos.reduce((m, receiptNo) => {
    const seq = Number(receiptNo.slice(prefix.length));
    return Number.isFinite(seq) && seq > m ? seq : m;
  }, 0);
  return String(maxSeq + 1).padStart(4, "0");
}

// Next running sequence for a whole receipt-book (all `typePrefix` receipts
// system-wide, e.g. every "MF" receipt regardless of student/period) — this
// is what makes the trailing number act like a printed receipt book's serial
// number: every new receipt gets the next one, full stop, never resetting
// per student or period. Only counts receiptNo values that structurally end
// in "-<digits>-<4-digit seq>" (the shape this module produces), so it safely
// ignores anything else sharing the prefix — e.g. migrated legacy monthly
// receipts in the older `MF-<admNo>-<yyyy>-<mm>` shape (no seq segment).
async function nextGlobalSeq(typePrefix: string): Promise<string> {
  const receiptNos = await feePaymentRepository.findReceiptNosStartingWith(`${typePrefix}-`);
  const seqPattern = new RegExp(`^${typePrefix}-.+-\\d+-(\\d{4})$`);
  const maxSeq = receiptNos.reduce((m, receiptNo) => {
    const match = receiptNo.match(seqPattern);
    const seq = match ? Number(match[1]) : NaN;
    return Number.isFinite(seq) && seq > m ? seq : m;
  }, 0);
  return String(maxSeq + 1).padStart(4, "0");
}

/**
 * Receipt number for a fee payment, generated when it's recorded.
 *   monthly:   MF-<admissionNo>-<YYYYMM>-<seq>
 *   admission: ADM-<admissionNo>-<YYYY>-<seq>
 * `seq` is a single running sequence shared by every receipt of that type
 * (like a printed receipt book's serial number) — it always increments for
 * the next receipt issued, regardless of which student or period it's for.
 * Other fee types (annual/other) keep the original global RC-<YYYYMM>-<seq>
 * scheme — no admission-linked format was specified for them.
 *
 * This only governs newly-created payments. Historic receiptNo values already
 * in the DB are immutable once assigned — see PATCH /fees/:id.
 */
export async function nextReceiptNo(params: {
  feeType: string;
  admissionNo: string;
  feeYear: number;
  feeMonth?: number | null;
}): Promise<string> {
  const { feeType, feeYear, feeMonth } = params;
  const admissionNo = safeToken(params.admissionNo);

  if (feeType === "monthly") {
    const period = `${feeYear}${String(feeMonth ?? 0).padStart(2, "0")}`;
    const seq = await nextGlobalSeq("MF");
    return `MF-${admissionNo}-${period}-${seq}`;
  }
  if (feeType === "admission") {
    const seq = await nextGlobalSeq("ADM");
    return `ADM-${admissionNo}-${feeYear}-${seq}`;
  }
  const prefix = `RC-${stamp()}-`;
  return `${prefix}${await nextSeq(prefix)}`;
}

export async function nextVoucherNo(): Promise<string> {
  // Derive from the max existing suffix, not count(): expenses can be hard-
  // deleted, so count()+1 could collide with a surviving voucherNo (@unique).
  const voucherNos = await expenseRepository.findAllVoucherNos();
  const maxSeq = voucherNos.reduce((m, voucherNo) => {
    const seq = Number(voucherNo.split("-").pop());
    return Number.isFinite(seq) && seq > m ? seq : m;
  }, 0);
  return `EXP-${stamp()}-${String(maxSeq + 1).padStart(4, "0")}`;
}
