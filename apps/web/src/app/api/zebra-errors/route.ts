import zebraErrors from "../../../../../../data/zebra-errors.json";
import { jsonOk } from "../../../server/api-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return jsonOk(zebraErrors, { "Cache-Control": "public, max-age=300" });
}
