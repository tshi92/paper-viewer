import { prisma } from "@paper-viewer/db";
import { requireCurrentUser } from "@/lib/auth";

export default async function PreferencesPage() {
  const user = await requireCurrentUser();

  const prefs = await prisma.researchPreferences.findUnique({
    where: { workspaceId: user.workspaceId }
  });

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">Research Preferences</h1>
      <p className="mt-1 text-sm text-muted">Configure your daily paper discovery.</p>

      <form className="mt-6 grid gap-5" action="/api/settings/preferences" method="post">
        <div>
          <label className="text-sm font-medium" htmlFor="topics">Research Topics</label>
          <p className="text-xs text-muted">Your main research directions, one per line.</p>
          <textarea
            className="mt-1 w-full rounded border border-border px-3 py-2"
            id="topics"
            name="topics"
            rows={4}
            placeholder={"LLM serving and inference optimization\nMixture of Experts\nDistributed training systems"}
            defaultValue={prefs?.topics.join("\n") ?? ""}
          />
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="keywords">Keywords</label>
          <p className="text-xs text-muted">Specific keywords for arXiv search, comma separated.</p>
          <input
            className="mt-1 w-full rounded border border-border px-3 py-2"
            id="keywords"
            name="keywords"
            placeholder="MoE, KV cache, RLHF, speculative decoding"
            defaultValue={prefs?.keywords.join(", ") ?? ""}
          />
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="arxivCategories">arXiv Categories</label>
          <p className="text-xs text-muted">Comma separated. e.g. cs.AI, cs.CL, cs.LG, cs.DC, cs.PF</p>
          <input
            className="mt-1 w-full rounded border border-border px-3 py-2"
            id="arxivCategories"
            name="arxivCategories"
            placeholder="cs.AI, cs.CL, cs.LG"
            defaultValue={prefs?.arxivCategories.join(", ") ?? ""}
          />
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="excludedTopics">Excluded Topics</label>
          <p className="text-xs text-muted">Topics you want to exclude, one per line.</p>
          <textarea
            className="mt-1 w-full rounded border border-border px-3 py-2"
            id="excludedTopics"
            name="excludedTopics"
            rows={2}
            placeholder={"Computer vision\nBioinformatics"}
            defaultValue={prefs?.excludedTopics.join("\n") ?? ""}
          />
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="papersPerDay">Papers per day</label>
          <input
            className="mt-1 w-32 rounded border border-border px-3 py-2"
            id="papersPerDay"
            name="papersPerDay"
            type="number"
            min={1}
            max={20}
            defaultValue={prefs?.papersPerDay ?? 10}
          />
        </div>

        <button className="rounded bg-accent px-4 py-2 font-medium text-white" type="submit">
          Save preferences
        </button>
      </form>
    </div>
  );
}
