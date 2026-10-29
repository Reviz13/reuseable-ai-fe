import { AvatarStateSchema } from "@ai/contracts";
import { aiAdmin } from "@/lib/aiAdmin";
import { aiServiceUrl } from "@/lib/env";
import { parseApp } from "@/lib/guard";
import { AssistantAdminSchema, PublicAssistantLooseSchema } from "@/lib/schemas";
import { AvatarPreview, AvatarSlot, ConfigForm } from "./forms";

// Read from contracts, not from ./forms: a "use client" module only hands a server page client references.
const STATES = AvatarStateSchema.options;

export const dynamic = "force-dynamic";

async function publicFrames(app: string) {
  try {
    const res = await fetch(`${aiServiceUrl()}/v1/assistants/${app}/public`, { cache: "no-store" });
    if (!res.ok) return {};
    return PublicAssistantLooseSchema.parse(await res.json()).avatar_frames;
  } catch {
    return {};
  }
}

export default async function AssistantPage({ params }: { params: Promise<{ app: string }> }) {
  const app = parseApp((await params).app);
  const [config, frames] = await Promise.all([
    aiAdmin(`/admin/${app}/assistant`, { schema: AssistantAdminSchema }),
    publicFrames(app),
  ]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Assistant</h1>
          <p>Name, persona, colours and avatar of the widget.</p>
        </div>
      </header>
      <div className="grid2">
        <section className="card">
          <h2>Configuration</h2>
          <ConfigForm app={app} config={config} />
        </section>
        <section className="card">
          <h2>Preview</h2>
          <AvatarPreview frames={frames} />
        </section>
      </div>
      <section className="card">
        <h2>Avatar (5 states)</h2>
        <div className="slots">
          {STATES.map((s) => (
            <AvatarSlot key={s} app={app} state={s} src={frames[s]} />
          ))}
        </div>
      </section>
    </>
  );
}
