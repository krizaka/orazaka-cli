/**
 * @file demo.documents.ts
 * @description The documents Eric checks in the demo — invented from start to finish: no real person, address,
 * company number or lease. Every name is generic, every place is a city, the e-mail domains are reserved
 * (RFC 2606), and the SIRET and the GST/QST numbers are runs of zeros that no register holds.
 *
 * Pure data, plus a tiny PDF writer: the document-authenticity Studio examines a real PDF file (its metadata, its
 * structure, its fonts), so the demo gives it one, built here rather than shipped as a binary.
 */

/**
 * A residential lease for the flat Lumen Atelier — a Montréal studio — rents in Lyon for the designer who runs its
 * European showroom. In French and in euros because it is a lease under French law, and the Studio's rulesets are the
 * French and Belgian residential lease law (a Québec ruleset is proposed in krizaka/orazaka-packs#7); everything Lumen
 * Atelier buys and sells at home is in Canadian dollars (the invoice below). Two clauses are deliberately wrong, so the
 * compliance check has something real to say: a deposit of two months' rent (the law caps it at one) and a ban on
 * receiving visitors (a clause the law deems unwritten).
 */
export const DEMO_LEASE = [
  "CONTRAT DE LOCATION — LOGEMENT NON MEUBLÉ (loi n° 89-462 du 6 juillet 1989)",
  "",
  "Entre les soussignés : la société SCI Les Ateliers du Rhône, bailleur, domiciliée 12 rue de la Charité, 69002 Lyon, SIRET 000 000 000 00000, représentée par Mme Claire Martin, gérante ;",
  "et M. Julien Bernard, locataire, demeurant actuellement 8 avenue Jean Jaurès, 69007 Lyon.",
  "",
  "Article 1 — Objet. Le bailleur loue au locataire un appartement de trois pièces de 64 m², 4 rue des Potiers, 69004 Lyon, à usage d'habitation principale.",
  "Article 2 — Durée. Le bail est consenti pour une durée de trois ans à compter du 1er novembre 2026.",
  "Article 3 — Loyer. Le loyer mensuel est fixé à 980 € hors charges, payable le 5 de chaque mois ; les charges font l'objet d'une provision mensuelle de 90 €.",
  "Article 4 — Dépôt de garantie. Le locataire verse à la signature un dépôt de garantie de 1 960 €.",
  "Article 5 — Jouissance des lieux. Le locataire ne pourra pas recevoir de visites après 22 heures, ni héberger un tiers, même temporairement.",
  "Article 6 — Diagnostics. Sont annexés au présent bail le diagnostic de performance énergétique (DPE, classe D), le constat de risque d'exposition au plomb et l'état des risques.",
  "Article 7 — Clause résolutoire. À défaut de paiement d'un seul terme de loyer à son échéance, le bail sera résilié de plein droit un mois après un commandement de payer resté infructueux.",
  "",
  "Fait à Lyon, le 15 octobre 2026, en deux exemplaires.",
].join("\n");

/**
 * The supplier invoice whose PDF the authenticity check examines: glazes bought from a Québec supplier, invented, in
 * Canadian dollars with the two Québec sales taxes at their real rates — GST (TPS) 5 % and QST (TVQ) 9.975 %, both on
 * the subtotal. Amounts are in cents so the arithmetic is checked, not typed (demo-seed.test.ts).
 */
export const DEMO_INVOICE = {
  lines: [
    { label: "Émail céladon, 25 kg", cents: 64_000 },
    { label: "Émail ambre, 25 kg", cents: 65_500 },
  ],
  gstRate: 0.05,
  qstRate: 0.09975,
} as const;

/** Rounds half up to the cent, as an invoice does. */
const cents = (value: number) => Math.round(value);
const subtotal = DEMO_INVOICE.lines.reduce((sum, line) => sum + line.cents, 0);
const gst = cents(subtotal * DEMO_INVOICE.gstRate);
const qst = cents(subtotal * DEMO_INVOICE.qstRate);
/** The invoice's totals, in cents of CAD. */
export const DEMO_INVOICE_TOTALS = { subtotal, gst, qst, total: subtotal + gst + qst } as const;

/** "1 295,00 $" — Québec French, as the supplier prints it (spaces, not U+202F: the PDF font is WinAnsi). */
const money = (amount: number) =>
  `${Math.floor(amount / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${String(amount % 100).padStart(2, "0")} $`;
const row = (label: string, amount: number) => `${label} ${".".repeat(Math.max(3, 38 - label.length))} ${money(amount).padStart(12)}`;

/** The lines printed on the invoice. */
export const DEMO_INVOICE_LINES = [
  "Emaux & Terres inc. — Facture n° 2026-0412",
  "TPS 000000000 RT0001 · TVQ 0000000000 TQ0001",
  "Client : Lumen Atelier, Montréal (Québec)",
  "Date : 6 octobre 2026 · Montants en dollars canadiens (CAD)",
  ...DEMO_INVOICE.lines.map((line) => row(line.label, line.cents)),
  row("Sous-total", DEMO_INVOICE_TOTALS.subtotal),
  row("TPS 5 %", DEMO_INVOICE_TOTALS.gst),
  row("TVQ 9,975 %", DEMO_INVOICE_TOTALS.qst),
  row("Total", DEMO_INVOICE_TOTALS.total),
  "Contact : facturation@example.com",
];

/** Escapes a line for a PDF literal string. */
const pdfText = (line: string) => line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/**
 * A minimal, valid single-page PDF (Helvetica, WinAnsi): the lines, a producer, a creation date. Written by hand so
 * the demo needs no PDF library; byte offsets in the cross-reference table are computed, not guessed.
 */
export function demoInvoicePdf(lines: readonly string[] = DEMO_INVOICE_LINES): Buffer {
  const content = ["BT", "/F1 12 Tf", "72 760 Td", "16 TL", ...lines.map((line) => `(${pdfText(line)}) '`), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Producer (Emaux et Terres invoicing) /Creator (Emaux et Terres invoicing) /CreationDate (D:20261006091500-04'00') /ModDate (D:20261006091500-04'00') >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
