import samples from "../../../../../../data/samples.json";
import { jsonOk } from "../../../server/api-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return jsonOk(samples, { "Cache-Control": "public, max-age=300" });
}
