/**
 * Issue #1030 - the CSV of the Salonansicht's exchange card: columns, directions, decimal comma,
 * BOM / semicolon / CRLF, and the formula-injection guard on every text cell. DB-free.
 */
import { describe, it, expect } from "vitest";
import {
  SALON_HOURS_CSV_HEADER,
  salonHoursCsv,
  salonHoursCsvFilename,
  type SalonHoursCsvInput,
} from "../salon-hours-csv";

function input(overrides: Partial<SalonHoursCsvInput> = {}): SalonHoursCsvInput {
  return {
    from: "2026-03-09",
    to: "2026-03-15",
    countedThrough: "2026-03-12",
    exchange: {
      fromOtherSalons: [
        {
          salonId: "b",
          salonName: "Süd",
          persons: 1,
          minutes: 90,
          people: [
            { employeeId: "e1", employeeName: "Ann Aa", employeeNumber: "100", minutes: 90 },
          ],
        },
        {
          salonId: null,
          salonName: null,
          persons: 1,
          minutes: 30,
          people: [{ employeeId: "e2", employeeName: "Bob Bb", employeeNumber: null, minutes: 30 }],
        },
      ],
      ownTeamElsewhere: [
        {
          salonId: "c",
          salonName: "Ost",
          persons: 1,
          minutes: 480,
          people: [
            { employeeId: "e3", employeeName: "Cy Cc", employeeNumber: "300", minutes: 480 },
          ],
        },
      ],
    },
    ...overrides,
  };
}

function lines(buffer: Buffer): string[] {
  return buffer.subarray(3).toString("utf8").split("\r\n");
}

describe("salonHoursCsv (Issue #1030)", () => {
  it("starts with the UTF-8 BOM and the fixed header", () => {
    const file = salonHoursCsv(input());
    expect([...file.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(lines(file)[0]).toBe("Von;Bis;Gezählt bis;Richtung;Salon;Person;Personalnummer;Stunden");
    expect(SALON_HOURS_CSV_HEADER).toBe(lines(file)[0]);
  });

  it("writes one line per direction, counterpart salon and person, hours with a decimal comma", () => {
    const rows = lines(salonHoursCsv(input())).slice(1, -1);
    expect(rows).toEqual([
      "2026-03-09;2026-03-15;2026-03-12;Aushilfe aus anderem Salon;Süd;Ann Aa;100;1,5",
      "2026-03-09;2026-03-15;2026-03-12;Aushilfe aus anderem Salon;ohne Stammsalon;Bob Bb;;0,5",
      "2026-03-09;2026-03-15;2026-03-12;Stammteam in anderem Salon;Ost;Cy Cc;300;8",
    ]);
  });

  it("ends with CRLF and has a header only when nothing was exchanged", () => {
    const empty = salonHoursCsv(
      input({ exchange: { fromOtherSalons: [], ownTeamElsewhere: [] }, countedThrough: null }),
    );
    expect(lines(empty)).toEqual([SALON_HOURS_CSV_HEADER, ""]);
  });

  it("leaves 'Gezählt bis' empty when nothing is counted yet", () => {
    const file = salonHoursCsv(input({ countedThrough: null }));
    expect(lines(file)[1].startsWith("2026-03-09;2026-03-15;;")).toBe(true);
  });

  it("neutralises a person name that starts like a formula", () => {
    const evil = input();
    evil.exchange.fromOtherSalons[0].people[0].employeeName = "=HYPERLINK(1)";
    evil.exchange.fromOtherSalons[0].salonName = "@Salon";
    const row = lines(salonHoursCsv(evil))[1];
    expect(row).toContain(";'@Salon;'=HYPERLINK(1);");
    expect(row).not.toContain(";=HYPERLINK");
  });

  it("quotes a cell with a semicolon", () => {
    const odd = input();
    odd.exchange.ownTeamElsewhere[0].salonName = "Ost; Nord";
    expect(lines(salonHoursCsv(odd)).join("\n")).toContain('"Ost; Nord"');
  });

  it("names the file after the window", () => {
    expect(salonHoursCsvFilename("2026-03-09", "2026-03-15")).toBe(
      "salon-austausch-2026-03-09-2026-03-15.csv",
    );
  });
});
