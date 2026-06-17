import Link from "next/link";
import { prisma } from "@paper-viewer/db";
import { PaperUploadForm } from "@/components/paper-upload-form";
import { requireCurrentUser } from "@/lib/auth";

export default async function LibraryPage() {
  const user = await requireCurrentUser();
  const workspacePapers = await prisma.workspacePaper.findMany({
    where: {
      workspaceId: user.workspaceId,
      state: "visible"
    },
    include: {
      paper: {
        include: {
          files: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return (
    <section className="rounded border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">Library</h1>
        <PaperUploadForm />
      </div>
      <div className="divide-y divide-border">
        {workspacePapers.map(({ paper }) => (
          <div className="flex items-center justify-between px-4 py-4 hover:bg-surface" key={paper.id}>
            <Link className="min-w-0 flex-1" href={`/papers/${paper.id}`}>
              <h2 className="font-medium">{paper.title}</h2>
              <p className="mt-1 text-sm text-muted">{Array.isArray(paper.authors) ? paper.authors.join(", ") : ""}</p>
              <p className="mt-1 text-xs text-muted">
                {paper.source === "arxiv" || paper.source === "hermes" ? `arXiv:${paper.arxivId ?? ""}` : paper.source}
                {paper.files.length > 0 ? " · PDF ready" : ""}
              </p>
            </Link>
            {paper.arxivId ? (
              <a
                href={`https://arxiv.org/abs/${paper.arxivId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-3 shrink-0 rounded border border-border px-2.5 py-1 text-xs text-accent hover:bg-surface"
              >
                arXiv
              </a>
            ) : null}
          </div>
        ))}
        {workspacePapers.length === 0 ? <p className="px-4 py-8 text-sm text-muted">No papers yet.</p> : null}
      </div>
    </section>
  );
}
