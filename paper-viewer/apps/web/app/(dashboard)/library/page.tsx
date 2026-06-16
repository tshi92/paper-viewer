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
    <div className="grid grid-cols-[360px_1fr] gap-6">
      <PaperUploadForm />
      <section className="rounded border border-border bg-white">
        <div className="border-b border-border px-4 py-3">
          <h1 className="text-lg font-semibold">Library</h1>
        </div>
        <div className="divide-y divide-border">
          {workspacePapers.map(({ paper }) => (
            <Link className="block px-4 py-4 hover:bg-surface" href={`/papers/${paper.id}`} key={paper.id}>
              <h2 className="font-medium">{paper.title}</h2>
              <p className="mt-1 text-sm text-muted">{Array.isArray(paper.authors) ? paper.authors.join(", ") : ""}</p>
              <p className="mt-2 text-sm text-muted">{paper.files.length > 0 ? "PDF ready" : "No PDF"}</p>
            </Link>
          ))}
          {workspacePapers.length === 0 ? <p className="px-4 py-8 text-sm text-muted">No papers uploaded yet.</p> : null}
        </div>
      </section>
    </div>
  );
}
