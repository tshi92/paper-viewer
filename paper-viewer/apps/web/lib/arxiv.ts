export type ArxivPaper = {
  arxivId: string;
  title: string;
  abstract: string;
  authors: string[];
  publishedAt: string;
  categories: string[];
  url: string;
};

function parseArxivXml(xml: string): ArxivPaper[] {
  const papers: ArxivPaper[] = [];
  const entries = xml.split("<entry>").slice(1);

  for (const entry of entries) {
    const get = (tag: string) => {
      const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return match ? match[1]!.trim() : "";
    };

    const idUrl = get("id");
    const arxivId = idUrl.replace("http://arxiv.org/abs/", "").replace(/v\d+$/, "");

    const authorMatches = [...entry.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)];
    const authors = authorMatches.map((m) => m[1]!.trim());

    const categoryMatches = [...entry.matchAll(/category term="([^"]+)"/g)];
    const categories = categoryMatches.map((m) => m[1]!);

    const title = get("title").replace(/\s+/g, " ");
    const abstract = get("summary").replace(/\s+/g, " ");

    papers.push({
      arxivId,
      title,
      abstract,
      authors,
      publishedAt: get("published"),
      categories,
      url: `https://arxiv.org/abs/${arxivId}`
    });
  }

  return papers;
}

export async function fetchArxivPapers(params: {
  categories: string[];
  keywords: string[];
  maxResults?: number;
}): Promise<ArxivPaper[]> {
  const { categories, keywords, maxResults = 40 } = params;

  // Build search query
  const parts: string[] = [];

  if (categories.length > 0) {
    const catQuery = categories.map((c) => `cat:${c}`).join("+OR+");
    parts.push(`(${catQuery})`);
  }

  if (keywords.length > 0) {
    const kwQuery = keywords.map((k) => `all:${encodeURIComponent(k)}`).join("+OR+");
    parts.push(`(${kwQuery})`);
  }

  const searchQuery = parts.length > 0 ? parts.join("+AND+") : "cat:cs.AI";

  const url = `http://export.arxiv.org/api/query?search_query=${searchQuery}&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;

  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }

    const response = await fetch(url, {
      headers: { "User-Agent": "PaperViewer/1.0 (research-workspace)" }
    });
    lastStatus = response.status;

    if (response.ok) {
      const xml = await response.text();
      return parseArxivXml(xml);
    }

    if (response.status !== 429 && response.status !== 503) {
      throw new Error(`arXiv API error: ${response.status}`);
    }
  }

  throw new Error(`arXiv API error: ${lastStatus} (after 3 retries)`);
}
