/* The three things OuterJoin needs done before a new client is worth adding at
   the source. The requester states each one on the "Email OJ" form and the
   answers ride along in the mail, so Mark can see what is still outstanding
   without a reply-and-wait.

   ONE list, imported by the form, the route and the mailer. Kept here rather
   than repeated in three files so a fourth item cannot be added to the form
   and quietly go missing from the email. */

export const CLIENT_REQUEST_CHECKLIST = [
  { key: "pmfDone", label: "PMF done" },
  { key: "linksDone", label: "Links file done" },
  { key: "rangingDone", label: "Ranging done" },
] as const;

export type ClientRequestChecklistKey =
  (typeof CLIENT_REQUEST_CHECKLIST)[number]["key"];

export type ClientRequestChecklist = Record<ClientRequestChecklistKey, boolean>;

/** Every item false — the honest starting point, and the shape of the reset. */
export function emptyChecklist(): ClientRequestChecklist {
  return Object.fromEntries(
    CLIENT_REQUEST_CHECKLIST.map((i) => [i.key, false]),
  ) as ClientRequestChecklist;
}

/* Read the answers off a request body. Only a literal `true` counts as done:
   a string "false", a 0 or a missing key must never read as "yes, that's
   finished" — this is a statement about work someone else is relying on. */
export function readChecklist(body: unknown): ClientRequestChecklist {
  const src = (body ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    CLIENT_REQUEST_CHECKLIST.map((i) => [i.key, src[i.key] === true]),
  ) as ClientRequestChecklist;
}

/** The labels of everything NOT ticked — what Mark actually acts on. */
export function outstandingItems(c: ClientRequestChecklist): string[] {
  return CLIENT_REQUEST_CHECKLIST.filter((i) => !c[i.key]).map((i) => i.label);
}

/** One line for the activity log, naming every item and its answer. */
export function checklistSummary(c: ClientRequestChecklist): string {
  return CLIENT_REQUEST_CHECKLIST
    .map((i) => `${i.label}: ${c[i.key] ? "yes" : "no"}`)
    .join(", ");
}
