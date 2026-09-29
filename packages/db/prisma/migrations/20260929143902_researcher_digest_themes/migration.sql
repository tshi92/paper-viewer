-- Monthly issues moved from per-direction "observations" to cross-researcher
-- "themes". An issue in the old shape cannot be shown by the new page, and
-- every issue is regenerated from stored papers by the next run, so the old
-- rows go rather than living on behind a second renderer.
DELETE FROM "ResearcherDigest" WHERE NOT ("content" ? 'themes');
