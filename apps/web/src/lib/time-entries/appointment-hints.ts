// Issue #604 - display only. Every hint is the server's decision (GET /appointment-hints and
// /appointment-hints/team); the client never derives one. This module holds the answer types, the
// paths, the German row texts and the link of a hint. Employee-facing texts never name the
// appointment system, and the link never carries a time: the entry form is not prefilled (D-13).

export type AppointmentHintKind = "AFTER_CLOCK_OUT" | "NO_ENTRY";

/** One hint of the caller's own person. */
export interface OwnAppointmentHint {
  /** Tenant-local day, `YYYY-MM-DD`. */
  date: string;
  kind: AppointmentHintKind;
  /** The latest appointment end of that day, `HH:mm`. */
  appointmentsUntil: string;
  /** The latest clock-out of that day, `HH:mm`; null when the day has no entry. */
  clockedOutAt: string | null;
}

export interface OwnAppointmentHintsAnswer {
  enabled: boolean;
  hints: OwnAppointmentHint[];
}

/** One hint of a person inside the caller's time-entry reach. */
export interface TeamAppointmentHint extends OwnAppointmentHint {
  employeeId: string;
  personName: string;
}

export interface TeamAppointmentHintsAnswer {
  enabled: boolean;
  hints: TeamAppointmentHint[];
}

export const APPOINTMENT_HINT_PATHS = {
  own: "/appointment-hints",
  team: "/appointment-hints/team",
  dismiss: "/appointment-hints/dismissals",
} as const;

/** The toast after „Stimmt so“ - the day stays recordable, so it says so. */
export const APPOINTMENT_HINT_DISMISSED_TOAST =
  "Hinweis ausgeblendet. Nachtragen kannst du trotzdem.";

/** The short explanation every hint row carries (Art. 13 DSGVO: nothing happens unseen). */
export const APPOINTMENT_HINT_TOOLTIP =
  "Dein Unternehmen gleicht deine Termine mit deiner erfassten Zeit ab. Clokr trägt nichts automatisch ein.";

/** The title and the subtitle of a hint row; `dayLabel` is the caller's own day wording („Di 24.11.“). */
export function appointmentHintTexts(
  hint: Pick<OwnAppointmentHint, "kind" | "appointmentsUntil" | "clockedOutAt">,
  dayLabel: string,
): { title: string; subtitle: string } {
  if (hint.kind === "AFTER_CLOCK_OUT") {
    return {
      title: `${dayLabel}: Termine bis ${hint.appointmentsUntil}`,
      subtitle: `Ausgestempelt hast du um ${hint.clockedOutAt ?? "–"}. Falls du länger gearbeitet hast, fehlt diese Zeit in deinem Stundenkonto.`,
    };
  }
  return {
    title: `${dayLabel}: Termine, aber keine Zeit erfasst`,
    subtitle: `Dein letzter Termin endete um ${hint.appointmentsUntil}. Falls du gearbeitet hast, fehlt diese Zeit in deinem Stundenkonto.`,
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The „Nachtragen“ target: the day of the list, never with a time. Null for a malformed day. */
export function appointmentHintHref(date: string): string | null {
  return DAY.test(date) ? `/ich/zeiten?view=list&date=${date}` : null;
}

/** „Stimmt so“: hides the hint for the day and kind permanently. */
export function dismissAppointmentHint(
  client: { post: <T>(path: string, body: unknown) => Promise<T> },
  hint: Pick<OwnAppointmentHint, "date" | "kind">,
): Promise<unknown> {
  return client.post(APPOINTMENT_HINT_PATHS.dismiss, { date: hint.date, kind: hint.kind });
}
