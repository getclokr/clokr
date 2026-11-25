import { fmtDecimalDe } from "./pdf-format";
import { CSV_BOM, csvCell as cell } from "../utils/csv-cell";
import type { SalonHoursExchange, SalonHoursExchangeGroup } from "./salon-hours-cells";

/**
 * Issue #1030 (P-06) - pure serialisation of the Salonansicht's exchange card as a CSV: per person
 * the hours they worked in the other direction of the exchange (an Aushilfe from another salon, or a
 * member of the Stammteam in another salon), the accounting basis between two salons - not the whole
 * raster.
 *
 * No Prisma, no clock, no rule: the answer arrives fully built from `assembleSalonHours`, so the file
 * shows exactly the figures of the card. Hours come from MINUTES through `fmtDecimalDe` with a decimal
 * comma (German spreadsheet); every TEXT cell goes through the shared `csvCell` guard
 * (`utils/csv-cell.ts`, formula injection), numeric cells stay numbers.
 *
 * Format as the other exports: UTF-8 with BOM, `;` as separator, CRLF line ends, RFC 4180 quoting.
 */

/** The eight column titles, in file order. */
export const SALON_HOURS_CSV_HEADER = [
  "Von",
  "Bis",
  "Gezählt bis",
  "Richtung",
  "Salon",
  "Person",
  "Personalnummer",
  "Stunden",
].join(";");

const DIRECTION_FROM_OTHER = "Aushilfe aus anderem Salon";
const DIRECTION_OWN_ELSEWHERE = "Stammteam in anderem Salon";
const NO_HOME_SALON = "ohne Stammsalon";

/** The subset of the `GET /salon-hours` answer the file reads. */
export interface SalonHoursCsvInput {
  from: string;
  to: string;
  countedThrough: string | null;
  exchange: Pick<SalonHoursExchange, "fromOtherSalons" | "ownTeamElsewhere">;
}

/** `salon-austausch-<from>-<to>.csv` for `YYYY-MM-DD` bounds. */
export function salonHoursCsvFilename(from: string, to: string): string {
  return `salon-austausch-${from}-${to}.csv`;
}

function linesOf(
  input: SalonHoursCsvInput,
  direction: string,
  groups: readonly SalonHoursExchangeGroup[],
): string[] {
  const lines: string[] = [];
  for (const group of groups) {
    for (const person of group.people) {
      lines.push(
        [
          input.from,
          input.to,
          input.countedThrough ?? "",
          cell(direction),
          cell(group.salonId === null ? NO_HOME_SALON : (group.salonName ?? "")),
          cell(person.employeeName),
          cell(person.employeeNumber ?? ""),
          fmtDecimalDe(person.minutes / 60, 2),
        ].join(";"),
      );
    }
  }
  return lines;
}

/** The number of data lines the file will carry (the audit row records it). */
export function salonHoursCsvLineCount(input: SalonHoursCsvInput): number {
  const count = (groups: readonly SalonHoursExchangeGroup[]) =>
    groups.reduce((sum, g) => sum + g.people.length, 0);
  return count(input.exchange.fromOtherSalons) + count(input.exchange.ownTeamElsewhere);
}

/** The file: BOM + header + one line per (direction, counterpart salon, person), CRLF. */
export function salonHoursCsv(input: SalonHoursCsvInput): Buffer {
  const lines = [
    SALON_HOURS_CSV_HEADER,
    ...linesOf(input, DIRECTION_FROM_OTHER, input.exchange.fromOtherSalons),
    ...linesOf(input, DIRECTION_OWN_ELSEWHERE, input.exchange.ownTeamElsewhere),
  ];
  return Buffer.concat([CSV_BOM, Buffer.from(`${lines.join("\r\n")}\r\n`, "utf8")]);
}
