-- arXiv rebuilds its RSS once a day at 04:00 UTC, which is 12:00 Beijing. A
-- digest run before that reads the PREVIOUS day's build: stale every day, empty
-- on Mondays (the feed declares <skipDays>Saturday, Sunday</skipDays>), and it
-- drops Friday's build entirely, because Friday's own run has already completed
-- from Thursday's build by the time Friday's is published.
ALTER TABLE "ResearchPreferences" ALTER COLUMN "pushHour" SET DEFAULT 13;

-- The new default only reaches rows created from here on, so existing
-- workspaces would keep reading the stale feed. Move only the hours that are
-- provably in that window; a workspace that deliberately chose an afternoon or
-- evening hour already reads the current day's build and is left alone.
UPDATE "ResearchPreferences" SET "pushHour" = 13 WHERE "pushHour" < 12;
