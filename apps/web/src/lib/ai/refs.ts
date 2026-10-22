export type AnswerSegment =
  | { type: "text"; text: string }
  | { type: "offset"; offset: number; text: string }
  | { type: "check"; id: string; text: string }
  | { type: "zip"; zip: number; text: string };

export interface KnownRefs {
  offsets: Set<number>;
  checks: Set<string>;
}

const REFERENCE = /(?<![\w@#])@(\d{1,7})(?!\w)|(?<![\w#&/])#([a-z][a-z0-9]*(?:-[a-z0-9]+)+|[a-z][a-z0-9]{2,})(?![\w-])|\bZIP[ -]?(\d{1,4})\b/g;

export function parseAnswer(text: string, known: KnownRefs): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let last = 0;
  const pushText = (value: string) => {
    if (!value) return;
    const previous = segments[segments.length - 1];
    if (previous?.type === "text") previous.text += value;
    else segments.push({ type: "text", text: value });
  };
  for (const match of text.matchAll(REFERENCE)) {
    const start = match.index ?? 0;
    const [raw, offset, check, zip] = match;
    let segment: AnswerSegment | null = null;
    if (offset !== undefined && known.offsets.has(Number(offset))) segment = { type: "offset", offset: Number(offset), text: raw };
    else if (check !== undefined && known.checks.has(check)) segment = { type: "check", id: check, text: raw };
    else if (zip !== undefined) segment = { type: "zip", zip: Number(zip), text: raw };
    if (!segment) continue;
    pushText(text.slice(last, start));
    segments.push(segment);
    last = start + raw.length;
  }
  pushText(text.slice(last));
  return segments;
}
