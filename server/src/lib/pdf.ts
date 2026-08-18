/**
 * Minimal, dependency-free PDF writer.
 *
 * The architecture doc calls for Puppeteer-rendered HTML PDFs (for rich
 * Arabic/RTL layout). For the MVP — and to keep the server installable offline
 * without a 300 MB headless browser — documents are produced by this small
 * generator using the built-in Helvetica fonts. It emits valid, openable A4
 * PDFs for receipts, vouchers, payslips and tabular reports.
 *
 * Swap `renderPdf` for a Puppeteer-backed implementation later without touching
 * callers: the public API is `renderPdf(doc): Buffer`.
 */

export interface PdfDoc {
  /** Institution letterhead (name + address), centered above the title. */
  org?: { name: string; address: string };
  title: string;
  subtitle?: string;
  /** Key/value lines (receipts) or plain strings (notes). */
  lines?: Array<[string, string] | string>;
  /** Tabular data (reports). Rendered after `lines`. */
  table?: {
    headers: string[];
    rows: Array<Array<string | number>>;
    /** 0-based header indexes holding currency amounts — formatted with a Rs. prefix (PDF text is ASCII-only). */
    currencyCols?: number[];
    /** Append a bold "Total" row summing each currencyCols column after the last data row. */
    totalsRow?: boolean;
  };
  /** Footer note centred at the bottom of the last page. */
  footer?: string;
}

const PAGE_W = 595; // A4 @ 72dpi
const PAGE_H = 842;
const MARGIN_X = 50;
const MARGIN_TOP = 800;
const MARGIN_BOTTOM = 60;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

type Rgb = [number, number, number];

interface TextCmd {
  type: "text";
  x: number;
  y: number;
  size: number;
  bold: boolean;
  text: string;
  color: Rgb;
}

// Stroked rectangle — x/y is the bottom-left corner (PDF `re` operator convention).
interface RectCmd {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  color: Rgb;
  lineWidth: number;
}

interface LineCmd {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: Rgb;
  lineWidth: number;
}

// A JPEG image placed in a `w`x`h` box at (x, y) (bottom-left corner) —
// `imageIndex` refers into the `images` array passed to serializePdf.
interface ImageCmd {
  type: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  imageIndex: number;
}

type DrawCmd = TextCmd | RectCmd | LineCmd | ImageCmd;

// A JPEG to embed via PDF's DCTDecode filter, which IS the JPEG codec — the
// compressed bytes go into the PDF stream untouched, no decode/re-encode
// needed. width/height/numComponents come from parseJpegInfo below.
export interface EmbeddedImage {
  bytes: Buffer;
  width: number;
  height: number;
  numComponents: number;
}

// Minimal JPEG marker scanner — just enough to read the frame dimensions and
// component count from the Start-Of-Frame segment (no decode). Throws on
// anything that isn't a well-formed baseline/progressive JPEG.
export function parseJpegInfo(buf: Buffer): { width: number; height: number; numComponents: number } {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error("Not a valid JPEG (missing SOI marker)");
  }
  let offset = 2;
  while (offset < buf.length - 9) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    // SOF0-3 / SOF5-7 / SOF9-11 / SOF13-15 carry frame dimensions; excludes
    // DHT(C4)/JPG(C8)/DAC(CC), which share the numeric range but aren't SOF.
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      return {
        height: buf.readUInt16BE(offset + 5),
        width: buf.readUInt16BE(offset + 7),
        numComponents: buf.readUInt8(offset + 9),
      };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2; // markers with no payload length
      continue;
    }
    if (marker === 0xd9) break; // EOI
    offset += 2 + buf.readUInt16BE(offset + 2);
  }
  throw new Error("Could not find a JPEG frame header (unsupported or corrupt file)");
}

const BLACK: Rgb = [0, 0, 0];
// Letterhead palette — a muted navy/blue pair reads as "official" without the
// harsh contrast of pure black on a document meant to be skimmed.
const ORG_NAME_COLOR: Rgb = hexRgb("#1F4E79");
const ORG_ADDRESS_COLOR: Rgb = hexRgb("#595959");
const TITLE_COLOR: Rgb = hexRgb("#2E75B6");

function hexRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Standard-14 Helvetica supports ASCII cleanly; drop anything outside that
// range (Arabic needs a Puppeteer/embedded-font path — out of scope for MVP).
function toAscii(s: string): string {
  let out = "";
  for (const ch of String(s ?? "")) {
    const code = ch.codePointAt(0) ?? 0;
    out += code >= 32 && code <= 126 ? ch : code === 8377 ? "Rs." : "?";
  }
  return out;
}

function esc(s: string): string {
  return toAscii(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// PDF text is ASCII-only (see toAscii above), so the ₹ glyph is written out
// and toAscii maps it to "Rs." at render time — kept as a real ₹ char here so
// the mapping stays in one place.
function formatCurrency(n: number): string {
  return "₹" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function truncate(s: string, maxChars: number): string {
  const a = toAscii(s);
  return a.length <= maxChars ? a : a.slice(0, Math.max(0, maxChars - 1)) + "…".replace("…", "~");
}

// Rough width of an ASCII string in points for a given Helvetica size. Uses the
// same ~0.6em-per-char assumption the table truncation budget relies on (a
// deliberate slight over-estimate so text stays inside its box).
const CHAR_WIDTH_EM = 0.6;
function estTextWidth(s: string, size: number, _bold = false): number {
  return toAscii(s).length * size * CHAR_WIDTH_EM;
}

// Lay a PdfDoc out into a list of pages, each a list of draw commands.
function layout(doc: PdfDoc): DrawCmd[][] {
  const pages: DrawCmd[][] = [[]];
  let page = 0;
  let y = MARGIN_TOP;

  const newPage = () => {
    pages.push([]);
    page += 1;
    y = MARGIN_TOP;
  };
  const push = (
    text: string,
    size: number,
    bold: boolean,
    x = MARGIN_X,
    advance = size + 7,
    color: Rgb = BLACK
  ) => {
    if (y - advance < MARGIN_BOTTOM) newPage();
    pages[page].push({ type: "text", x, y, size, bold, text, color });
    y -= advance;
  };
  const cellAt = (text: string, size: number, bold: boolean, x: number, color: Rgb = BLACK) => {
    pages[page].push({ type: "text", x, y, size, bold, text, color });
  };
  const center = (text: string, size: number, bold: boolean) => {
    const w = estTextWidth(text, size, bold);
    return MARGIN_X + Math.max(0, (CONTENT_W - w) / 2);
  };
  // Roughly one text line at the body-copy size — used to space the
  // letterhead from the report title by a couple of blank lines.
  const LINE_HEIGHT = 14;

  // Institution letterhead: name (bold, navy) then address (grey), both
  // centered above the report title.
  if (doc.org) {
    const NAME_SIZE = 14;
    const ADDR_SIZE = 10;
    cellAt(doc.org.name, NAME_SIZE, true, center(doc.org.name, NAME_SIZE, true), ORG_NAME_COLOR);
    y -= NAME_SIZE + 4;
    if (doc.org.address) {
      if (y - (ADDR_SIZE + 4) < MARGIN_BOTTOM) newPage();
      cellAt(
        doc.org.address,
        ADDR_SIZE,
        false,
        center(doc.org.address, ADDR_SIZE, false),
        ORG_ADDRESS_COLOR
      );
      y -= ADDR_SIZE + 4;
    }
    // Two blank lines between the letterhead and the report title.
    if (y - LINE_HEIGHT * 2 < MARGIN_BOTTOM) newPage();
    y -= LINE_HEIGHT * 2;
  }

  // Title and subtitle render as ONE line ("Title - Subtitle"), matching the
  // XLSX writer's single-heading convention. An ASCII hyphen is used (not the
  // XLSX em-dash) because PDF text is ASCII-only — toAscii would turn "—" into
  // "?". Shrink from 13pt (deliberately smaller than the 14pt org name above,
  // so the letterhead reads as the primary heading) until it fits the
  // content width so long combos (e.g. "Attendance Report - 7/2026 - class
  // 5") don't overflow. Centered, and coloured a lighter blue than the org
  // name to keep the visual hierarchy without resorting to plain black.
  const heading = doc.subtitle ? `${doc.title} - ${doc.subtitle}` : doc.title;
  let headingSize = 13;
  while (headingSize > 8 && estTextWidth(heading, headingSize, true) > CONTENT_W) {
    headingSize -= 1;
  }
  push(heading, headingSize, true, center(heading, headingSize, true), headingSize + 7, TITLE_COLOR);
  y -= 6;

  for (const line of doc.lines ?? []) {
    if (Array.isArray(line)) {
      if (y - 18 < MARGIN_BOTTOM) newPage();
      cellAt(line[0], 11, true, MARGIN_X);
      cellAt(String(line[1]), 11, false, MARGIN_X + 170);
      y -= 18;
    } else {
      push(line, 11, false);
    }
  }

  if (doc.table && doc.table.headers.length > 0) {
    y -= 8;
    const { headers, rows, currencyCols = [], totalsRow = false } = doc.table;
    const cols = headers.length;
    const fmt = (v: string | number, i: number) =>
      currencyCols.includes(i) && typeof v === "number" ? formatCurrency(v) : String(v);

    // Build the totals row up front so its (potentially widest) cells are
    // included when sizing columns.
    const totals: Array<string | number> | null =
      totalsRow && currencyCols.length > 0
        ? headers.map((_, i) =>
            currencyCols.includes(i)
              ? rows.reduce((sum, r) => sum + (Number(r[i]) || 0), 0)
              : i === 0
                ? "Total"
                : ""
          )
        : null;
    const allRows = totals ? [...rows, totals] : rows;

    // Content-aware column widths: weight each column by its longest formatted
    // string (header + every row), clamped, so wide values (Receipt/Student/
    // Payee) get proportionally more room than short numeric columns instead of
    // an equal split that truncates them.
    const MIN_WEIGHT = 5;
    const MAX_WEIGHT = 34;
    const weights = headers.map((h, i) => {
      let longest = toAscii(String(h)).length;
      for (const row of allRows) {
        const len = toAscii(fmt(row[i], i)).length;
        if (len > longest) longest = len;
      }
      return Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, longest));
    });
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const colWidths = weights.map((w) => (w / weightSum) * CONTENT_W);
    const colX: number[] = [];
    let acc = MARGIN_X;
    for (let i = 0; i < cols; i++) {
      colX.push(acc);
      acc += colWidths[i];
    }
    // Per-column character budget from its own allocated width (10pt cells).
    const colMaxChars = colWidths.map((w) => Math.max(4, Math.floor(w / 6)));

    const drawRow = (cells: Array<string | number>, bold: boolean) => {
      if (y - 16 < MARGIN_BOTTOM) newPage();
      cells.forEach((c, i) => {
        cellAt(truncate(fmt(c, i), colMaxChars[i]), 10, bold, colX[i]);
      });
      y -= 16;
    };
    drawRow(headers, true);
    for (const row of rows) drawRow(row, false);
    if (totals) drawRow(totals, true);
  }

  if (doc.footer) {
    pages[page].push({ type: "text", x: MARGIN_X, y: 40, size: 9, bold: false, text: doc.footer, color: BLACK });
  }

  return pages;
}

function contentStream(cmds: DrawCmd[]): string {
  return cmds
    .map((c) => {
      if (c.type === "image") {
        // Images draw into the unit square via the CTM: scale to w/h, translate to x/y.
        return `q\n${c.w} 0 0 ${c.h} ${c.x} ${c.y} cm\n/Im${c.imageIndex} Do\nQ`;
      }
      const [r, g, b] = c.color;
      if (c.type === "text") {
        const rg = `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`;
        return `${rg}\nBT /${c.bold ? "F2" : "F1"} ${c.size} Tf ${c.x} ${c.y} Td (${esc(c.text)}) Tj ET`;
      }
      const RG = `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG`;
      const lw = `${c.lineWidth} w`;
      if (c.type === "rect") {
        return `${RG}\n${lw}\n${c.x} ${c.y} ${c.w} ${c.h} re S`;
      }
      return `${RG}\n${lw}\n${c.x1} ${c.y1} m ${c.x2} ${c.y2} l S`;
    })
    .join("\n");
}

export function renderPdf(doc: PdfDoc): Buffer {
  return serializePdf(layout(doc));
}

// Serialise a list of pages (each a list of draw commands) into a minimal,
// valid PDF-1.4 byte stream — the shared backend for both renderPdf (tabular
// reports) and renderReceiptPdf (the bordered fee-receipt card). `images`
// are embedded as XObjects and shared across every page's /Resources (simplest
// correct option — an unreferenced resource entry is harmless, and receipts
// only ever carry at most one image anyway).
function serializePdf(pages: DrawCmd[][], images: EmbeddedImage[] = []): Buffer {
  const nPages = pages.length;

  // Object numbering: 1 catalog, 2 pages, 3 F1, 4 F2, then per page a page obj
  // and a content obj, then one object per embedded image.
  const objects: string[] = [];
  const pageObjNums: number[] = [];
  for (let i = 0; i < nPages; i++) pageObjNums.push(5 + i * 2);

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${nPages} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
  objects[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;

  const imageBaseObjNum = 5 + nPages * 2;
  const imageObjNums = images.map((_, i) => imageBaseObjNum + i);
  images.forEach((img, i) => {
    const colorSpace = img.numComponents === 1 ? "DeviceGray" : "DeviceRGB";
    // The JPEG's own compressed bytes go in as-is (DCTDecode = the JPEG codec).
    // latin1 round-trips arbitrary binary losslessly (1 byte <-> 1 code point),
    // matching how content streams are already handled below.
    const raw = img.bytes.toString("latin1");
    objects[imageObjNums[i]] =
      `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
      `/ColorSpace /${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\n` +
      `stream\n${raw}\nendstream`;
  });
  const xObjectDict =
    images.length > 0
      ? ` /XObject << ${imageObjNums.map((n, i) => `/Im${i} ${n} 0 R`).join(" ")} >>`
      : "";

  pages.forEach((cmds, i) => {
    const pageNum = 5 + i * 2;
    const contentNum = 6 + i * 2;
    const stream = contentStream(cmds);
    objects[pageNum] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xObjectDict} >> /Contents ${contentNum} 0 R >>`;
    objects[contentNum] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });

  // Serialise with a proper xref table.
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  const total = objects.length - 1; // highest object number
  for (let n = 1; n <= total; n++) {
    offsets[n] = Buffer.byteLength(body, "latin1");
    body += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= total; n++) {
    xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(body + xref + trailer, "latin1");
}

// ---------------------------------------------------------------------------
// Fee receipt — a single bordered card (modelled on the institution's printed
// receipt book), distinct from the tabular PdfDoc layout above.
// ---------------------------------------------------------------------------

export interface ReceiptDoc {
  org: { name: string; address: string };
  receiptNo: string;
  /** Display-ready date, e.g. "05-Jul-2026". */
  date: string;
  studentName: string;
  admissionNo: string;
  /** Display-ready label, e.g. "Monthly Fee". */
  feeType: string;
  /** Display-ready period, e.g. "July 2026" or "2024". */
  period: string;
  amountPaid: number;
  /**
   * The Admin/Accountant who collected this payment, shown as an authorized
   * signatory. `image` (a parsed JPEG, see parseJpegInfo) is optional — a
   * staff member who hasn't uploaded a signature yet still gets a printed
   * name/role line, just without the image above it.
   */
  signature?: { image?: EmbeddedImage; staffName: string; staffRole: string };
}

const RECEIPT_BORDER_COLOR: Rgb = hexRgb("#1F4E79");
const RECEIPT_LABEL_COLOR: Rgb = hexRgb("#404040");
const RECEIPT_RULE_COLOR: Rgb = hexRgb("#BFBFBF");
const RECEIPT_AMOUNT_COLOR: Rgb = hexRgb("#1F4E79");

// Shrink `size` down to `minSize` until `text` fits `maxW`, mirroring the
// report-title auto-shrink in layout() above.
function fitSize(text: string, maxSize: number, minSize: number, maxW: number, bold: boolean): number {
  let size = maxSize;
  while (size > minSize && estTextWidth(text, size, bold) > maxW) size -= 1;
  return size;
}

function layoutReceipt(doc: ReceiptDoc): { cmds: DrawCmd[]; images: EmbeddedImage[] } {
  const cmds: DrawCmd[] = [];
  const images: EmbeddedImage[] = [];
  const text = (x: number, y: number, t: string, size: number, bold: boolean, color: Rgb = BLACK) =>
    cmds.push({ type: "text", x, y, size, bold, text: t, color });
  const rect = (x: number, y: number, w: number, h: number, color: Rgb, lineWidth: number) =>
    cmds.push({ type: "rect", x, y, w, h, color, lineWidth });
  const hRule = (x1: number, y: number, x2: number, color: Rgb = RECEIPT_RULE_COLOR, lineWidth = 0.75) =>
    cmds.push({ type: "line", x1, y1: y, x2, y2: y, color, lineWidth });
  const image = (x: number, y: number, w: number, h: number, img: EmbeddedImage) => {
    images.push(img);
    cmds.push({ type: "image", x, y, w, h, imageIndex: images.length - 1 });
  };
  const centerX = (t: string, size: number, bold: boolean, boxX: number, boxW: number) =>
    boxX + Math.max(0, (boxW - estTextWidth(t, size, bold)) / 2);
  const rightX = (t: string, size: number, bold: boolean, edgeX: number) =>
    edgeX - estTextWidth(t, size, bold);

  const BOX_X = 60;
  const BOX_W = PAGE_W - BOX_X * 2;
  const BOX_TOP = 790;
  const BOX_H = 400;
  const BOX_BOTTOM = BOX_TOP - BOX_H;
  const PAD = 18;
  const innerLeft = BOX_X + PAD;
  const innerRight = BOX_X + BOX_W - PAD;

  rect(BOX_X, BOX_BOTTOM, BOX_W, BOX_H, RECEIPT_BORDER_COLOR, 1.5);

  let y = BOX_TOP - PAD - 8;

  // Header row: Receipt No (left) — FEE RECEIPT (center) — Date (right).
  text(innerLeft, y, `Receipt No: ${doc.receiptNo}`, 9, false, RECEIPT_LABEL_COLOR);
  text(centerX("FEE RECEIPT", 14, true, BOX_X, BOX_W), y - 1, "FEE RECEIPT", 14, true, RECEIPT_BORDER_COLOR);
  const dateLabel = `Date: ${doc.date}`;
  text(rightX(dateLabel, 9, false, innerRight), y, dateLabel, 9, false, RECEIPT_LABEL_COLOR);
  y -= 16;
  hRule(innerLeft, y, innerRight);
  y -= 24;

  // Institution letterhead, centered.
  const nameSize = fitSize(doc.org.name, 15, 10, BOX_W - PAD * 2, true);
  text(centerX(doc.org.name, nameSize, true, BOX_X, BOX_W), y, doc.org.name, nameSize, true, ORG_NAME_COLOR);
  y -= nameSize + 5;
  if (doc.org.address) {
    const addrSize = fitSize(doc.org.address, 10, 7, BOX_W - PAD * 2, false);
    text(centerX(doc.org.address, addrSize, false, BOX_X, BOX_W), y, doc.org.address, addrSize, false, ORG_ADDRESS_COLOR);
    y -= addrSize + 6;
  }
  y -= 6;
  hRule(innerLeft, y, innerRight);
  y -= 26;

  // Labeled fields, each with a fill-in-the-blank style rule beneath it.
  // Values are truncated to their available width (label-to-border) so an
  // unusually long value (e.g. a long student name) can't overflow past the
  // card's border — same defensive pattern as the table columns in layout().
  const LABEL_W = 130;
  const fieldRow = (label: string, value: string, opts?: { bold?: boolean; color?: Rgb; size?: number }) => {
    const size = opts?.size ?? 11;
    const valueX = innerLeft + LABEL_W;
    const maxChars = Math.max(4, Math.floor((innerRight - valueX) / (size * CHAR_WIDTH_EM)));
    text(innerLeft, y, label, size, true, RECEIPT_LABEL_COLOR);
    text(valueX, y, truncate(value || "-", maxChars), size, opts?.bold ?? false, opts?.color ?? BLACK);
    y -= 8;
    hRule(innerLeft, y, innerRight);
    y -= 22;
  };

  fieldRow("Student Name", doc.studentName);
  fieldRow("Admission No", doc.admissionNo);
  fieldRow("Fee Type", doc.feeType);
  fieldRow("Period", doc.period);
  fieldRow("Payment Date", doc.date);
  fieldRow("Amount Paid", formatCurrency(doc.amountPaid), {
    bold: true,
    color: RECEIPT_AMOUNT_COLOR,
    size: 13,
  });

  y -= 2;
  const thankYou = "Thank you for your payment.";
  text(centerX(thankYou, 10, false, BOX_X, BOX_W), y, thankYou, 10, false, RECEIPT_LABEL_COLOR);

  // Two signature lines anchored to the bottom of the card (independent of
  // the field stack above — there's always headroom, see the sizing note
  // below): the collecting staff member's authorized signature on the left,
  // the fee-payer's on the right (blank, for a printed copy).
  const sigY = BOX_BOTTOM + PAD + 16;
  const colW = 150;

  const authX1 = innerLeft;
  const authX2 = authX1 + colW;
  // The signature image fills the open space above the rule — mirroring the
  // blank space left for a handwritten signature above the "Receiver's
  // Signature" rule on the right — and the printed Name/Role label stacks
  // below the rule, same as a conventional signature block.
  if (doc.signature?.image) {
    const imgW = 90;
    const imgH = 28;
    image(authX1 + (colW - imgW) / 2, sigY + 10, imgW, imgH, doc.signature.image);
  }
  hRule(authX1, sigY, authX2);
  const staffName = doc.signature?.staffName ?? "Authorized Signatory";
  text(centerX(staffName, 8, false, authX1, colW), sigY - 10, staffName, 8, false, RECEIPT_LABEL_COLOR);
  const staffRole = doc.signature?.staffRole ?? "";
  if (staffRole) {
    text(centerX(staffRole, 8, false, authX1, colW), sigY - 19, staffRole, 8, false, RECEIPT_LABEL_COLOR);
  }

  const sigX2 = innerRight;
  const sigX1 = sigX2 - colW;
  hRule(sigX1, sigY, sigX2);
  const sigLabel = "Receiver's Signature";
  text(centerX(sigLabel, 8, false, sigX1, colW), sigY - 10, sigLabel, 8, false, RECEIPT_LABEL_COLOR);

  return { cmds, images };
}

// Render a single fee receipt as a bordered card near the top of an A4 page,
// modelled on the institution's printed receipt book (see docs — the six
// fields below plus receipt no/date are the ones specified for this template;
// BOX_H=400 leaves comfortable headroom under the six field rows + footer
// before it would ever reach the signature line's fixed y-position).
export function renderReceiptPdf(doc: ReceiptDoc): Buffer {
  const { cmds, images } = layoutReceipt(doc);
  return serializePdf([cmds], images);
}
