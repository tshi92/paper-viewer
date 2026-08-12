-- CreateTable
CREATE TABLE "ConferenceEntry" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "paperId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConferenceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConferenceEntry_venue_year_idx" ON "ConferenceEntry"("venue", "year");

-- CreateIndex
CREATE INDEX "ConferenceEntry_paperId_idx" ON "ConferenceEntry"("paperId");

-- CreateIndex
CREATE UNIQUE INDEX "ConferenceEntry_venue_year_paperId_key" ON "ConferenceEntry"("venue", "year", "paperId");

-- AddForeignKey
ALTER TABLE "ConferenceEntry" ADD CONSTRAINT "ConferenceEntry_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;
