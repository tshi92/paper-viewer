-- Trim ReadingState from six values to four. `saved` and `archived` overlapped
-- with labels, so existing rows fold into the nearest surviving state:
--   saved    -> reading  (still in the pipeline, just parked)
--   archived -> skipped  (taken out of the pipeline)
-- Postgres cannot drop enum values in place, so the type is recreated. The two
-- UPDATEs MUST run before the type swap: the `USING state::text::"ReadingState_new"`
-- cast below fails on any row still holding a removed value.
BEGIN;

UPDATE "ReadingStateRecord" SET "state" = 'reading' WHERE "state" = 'saved';
UPDATE "ReadingStateRecord" SET "state" = 'skipped' WHERE "state" = 'archived';

-- AlterEnum
CREATE TYPE "ReadingState_new" AS ENUM ('new', 'reading', 'discussed', 'skipped');
ALTER TABLE "public"."ReadingStateRecord" ALTER COLUMN "state" DROP DEFAULT;
ALTER TABLE "ReadingStateRecord" ALTER COLUMN "state" TYPE "ReadingState_new" USING ("state"::text::"ReadingState_new");
ALTER TYPE "ReadingState" RENAME TO "ReadingState_old";
ALTER TYPE "ReadingState_new" RENAME TO "ReadingState";
DROP TYPE "public"."ReadingState_old";
ALTER TABLE "ReadingStateRecord" ALTER COLUMN "state" SET DEFAULT 'new';

COMMIT;
