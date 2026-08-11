export type ArxivPaper = {
  arxivId: string;
  title: string;
  abstract: string;
  authors: string[];
  publishedAt: string;
  categories: string[];
  url: string;
};

function parseAtomXml(xml: string): ArxivPaper[] {
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

function parseRssXml(xml: string): ArxivPaper[] {
  const papers: ArxivPaper[] = [];
  const items = xml.split("<item>").slice(1);

  for (const item of items) {
    const get = (tag: string) => {
      const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return match ? match[1]!.trim() : "";
    };

    const link = get("link");
    const arxivMatch = link.match(/\/abs\/(\d{4}\.\d{4,5})/);
    if (!arxivMatch) continue;
    const arxivId = arxivMatch[1]!;

    const rawTitle = get("title").replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
    const title = rawTitle.replace(/\(arXiv:[\d.]+v?\d*.*\)$/i, "").trim();

    const rawDesc = get("description");
    const abstract = rawDesc.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

    const creatorTag = item.match(/<dc:creator>([^<]+)<\/dc:creator>/);
    const authors = creatorTag
      ? creatorTag[1]!.split(",").map((a) => a.trim()).filter(Boolean)
      : [];

    papers.push({
      arxivId,
      title,
      abstract,
      authors,
      publishedAt: get("pubDate") || new Date().toISOString(),
      categories: [],
      url: `https://arxiv.org/abs/${arxivId}`
    });
  }

  return papers;
}

async function fetchViaRss(categories: string[], maxResults: number): Promise<ArxivPaper[]> {
  const allPapers: ArxivPaper[] = [];
  const seen = new Set<string>();

  for (const cat of categories) {
    const url = `https://rss.arxiv.org/rss/${cat}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "PaperViewer/1.0 (research-workspace)" }
    });
    if (!res.ok) continue;

    const xml = await res.text();
    for (const p of parseRssXml(xml)) {
      if (!seen.has(p.arxivId)) {
        seen.add(p.arxivId);
        allPapers.push({ ...p, categories: [cat] });
      }
    }

    if (allPapers.length >= maxResults) break;
  }

  return allPapers.slice(0, maxResults);
}

async function fetchViaApi(searchQuery: string, maxResults: number): Promise<ArxivPaper[]> {
  // 一律走 https：部分网络环境会静默吞掉明文 http 请求导致挂起
  const url = `https://export.arxiv.org/api/query?search_query=${searchQuery}&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;

  const response = await fetch(url, {
    headers: { "User-Agent": "PaperViewer/1.0 (research-workspace)" }
  });

  if (!response.ok) {
    throw new Error(`arXiv API error: ${response.status}`);
  }

  return parseAtomXml(await response.text());
}

// arXiv 官方元数据（标题/作者/摘要）免费且权威，导入单篇时优先于 LLM 抽取。
export async function fetchArxivMetadata(arxivId: string): Promise<ArxivPaper | null> {
  const response = await fetch(`https://export.arxiv.org/api/query?id_list=${arxivId}`, {
    headers: { "User-Agent": "PaperViewer/1.0 (research-workspace)" },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    return null;
  }
  const papers = parseAtomXml(await response.text());
  return papers.find((p) => p.arxivId === arxivId) ?? papers[0] ?? null;
}

export async function fetchArxivPapers(params: {
  categories: string[];
  keywords: string[];
  maxResults?: number;
}): Promise<ArxivPaper[]> {
  const { categories, keywords, maxResults = 40 } = params;

  // Build search query for API fallback
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

  // Primary: RSS feed (CDN-served, no rate limiting)
  try {
    const papers = await fetchViaRss(categories, maxResults);
    if (papers.length > 0) return papers;
  } catch {
    // fall through to API
  }

  // Fallback: arXiv API (may 429 on shared IPs)
  return fetchViaApi(searchQuery, maxResults);
}
