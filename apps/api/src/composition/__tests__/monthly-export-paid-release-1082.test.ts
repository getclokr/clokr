/**
 * Issue #1082 (D-06) - the Monatsexport names the paid release days of a Betriebsurlaub: the
 * optional column "Freistellung" and its legend are drawn exactly when some listed row has release
 * days, the value is the decimal-comma day count, and nothing is printed otherwise. DB-free, with
 * the recording stub of monthly-export-render-617.test.ts.
 */
import { describe, it, expect } from "vitest";
import PDFDocument from "pdfkit";
import {
  drawMonthlyExport,
  MONTHLY_EXPORT_PAID_RELEASE_LEGEND,
  type MonthlyExportData,
  type MonthlyExportRow,
} from "../pdf";

function createRecordingDoc(): { doc: PDFKit.PDFDocument; texts: string[] } {
  const texts: string[] = [];
  const target: Record<string, unknown> = {
    y: 100,
    x: 36,
    page: { width: 842, height: 595, margins: { top: 36, bottom: 36, left: 36, right: 36 } },
  };
  const proxy = new Proxy(target, {
    get(obj, prop: string) {
      if (prop === "text") {
        return (str: unknown) => {
          texts.push(String(str));
          return proxy;
        };
      }
      if (prop === "heightOfString") return () => 12;
      if (prop === "widthOfString") return (str: string) => String(str).length * 3.6;
      if (prop in obj) return obj[prop];
      return () => proxy;
    },
    set(obj, prop: string, value) {
      obj[prop] = value;
      return true;
    },
  }) as unknown as PDFKit.PDFDocument;
  return { doc: proxy, texts };
}

const NO_ABSENCE = {
  vacation: 0,
  sick: 0,
  sickChild: 0,
  overtimeComp: 0,
  special: 0,
  education: 0,
  unpaid: 0,
  maternity: 0,
  parental: 0,
  paidRelease: 0,
};

function makeRow(overrides: Partial<MonthlyExportRow> = {}): MonthlyExportRow {
  return {
    employeeName: "P1082x, Vorname",
    employeeNumber: "N-1",
    status: "CONFIRMED",
    workedMinutes: 9150,
    expectedMinutes: 9600,
    balanceMinutes: -450,
    balanceAdjustmentMinutes: 0,
    closingBalanceMinutes: 1200,
    datevWorkedMinutes: 9150,
    absenceDays: { ...NO_ABSENCE },
    section9: false,
    vacation: null,
    ...overrides,
  };
}

function makeData(rows: MonthlyExportRow[]): MonthlyExportData {
  return {
    tenantName: "Testfirma",
    monthLabel: "September 2026",
    year: 2026,
    month: 9,
    generatedAt: "15.10.2026, 12:00",
    vacationYear: { year: 2026, asOf: "30.09.2026" },
    rows,
  };
}

function render(rows: MonthlyExportRow[]): string[] {
  const { doc, texts } = createRecordingDoc();
  drawMonthlyExport(doc, makeData(rows));
  return texts;
}

describe("Monatsexport column Freistellung (Issue #1082, D-06)", () => {
  it("draws neither the column nor its legend while nobody has release days", () => {
    const texts = render([makeRow(), makeRow({ employeeNumber: "N-2" })]);
    expect(texts.length).toBeGreaterThan(10); // not vacuous: the document was rendered
    expect(texts).not.toContain("Frei-");
    expect(texts).not.toContain("stellung");
    expect(texts).not.toContain(MONTHLY_EXPORT_PAID_RELEASE_LEGEND);
  });

  it("draws the header, the value with a decimal comma and the legend once when some row has release days", () => {
    const texts = render([
      makeRow({ absenceDays: { ...NO_ABSENCE, paidRelease: 2.5 } }),
      makeRow({ employeeNumber: "N-2" }),
    ]);
    expect(texts).toContain("Frei-");
    expect(texts).toContain("stellung");
    expect(texts).toContain("2,5");
    expect(texts.filter((t) => t === MONTHLY_EXPORT_PAID_RELEASE_LEGEND)).toHaveLength(1);
  });

  it("states in the legend that the DATEV file carries the days only with a configured Lohnart", () => {
    expect(MONTHLY_EXPORT_PAID_RELEASE_LEGEND).toContain("Betriebsurlaub");
    expect(MONTHLY_EXPORT_PAID_RELEASE_LEGEND).toContain("DATEV");
    expect(MONTHLY_EXPORT_PAID_RELEASE_LEGEND).toContain("Lohnart");
  });

  it("keeps the table on one page with the new column and every other optional column visible", () => {
    const row = makeRow({
      balanceAdjustmentMinutes: 60,
      absenceDays: {
        vacation: 1,
        sick: 1,
        sickChild: 1,
        overtimeComp: 1,
        special: 1,
        education: 1,
        unpaid: 1,
        maternity: 1,
        parental: 1,
        paidRelease: 1,
      },
    });
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true });
    drawMonthlyExport(doc, makeData([row]));
    expect(doc.bufferedPageRange().count).toBe(1);
    doc.end();
  });
});
