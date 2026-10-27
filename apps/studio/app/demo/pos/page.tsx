import { aiServiceUrl } from "@/lib/env";
import { DemoPos } from "./DemoPos";

// Read AI_SERVICE_URL per request (never at build time) and hand it to the client as a prop.
export const dynamic = "force-dynamic";

export default function DemoPosPage() {
  return <DemoPos aiServiceUrl={aiServiceUrl()} />;
}
