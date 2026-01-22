-- Add skipCount to Session for skip-scene feature
ALTER TABLE "Session"
ADD COLUMN "skipCount" INTEGER NOT NULL DEFAULT 0;
