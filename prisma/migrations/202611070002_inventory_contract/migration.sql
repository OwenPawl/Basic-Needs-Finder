-- DropIndex
DROP INDEX "InventoryEvent_commandKey_key";

-- DropIndex
DROP INDEX "Reservation_idempotencyKey_key";

-- AlterTable
ALTER TABLE "Campus" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "Conversation" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "InventoryEvent" ADD COLUMN     "onHandAfter" INTEGER,
ADD COLUMN     "onHandBefore" INTEGER,
ADD COLUMN     "requestHash" TEXT,
ADD COLUMN     "reservationId" UUID,
ADD COLUMN     "reservedAfter" INTEGER,
ADD COLUMN     "reservedBefore" INTEGER,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "Listing" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "Membership" ALTER COLUMN "verifiedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "verifiedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "Message" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "Report" ALTER COLUMN "resolvedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "resolvedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "cancelledAt" TIMESTAMPTZ(3),
ADD COLUMN     "expiredAt" TIMESTAMPTZ(3),
ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMPTZ(3) USING "expiresAt" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "completedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "completedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "StockLot" ALTER COLUMN "receivedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "receivedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

-- CreateTable
CREATE TABLE "StockFoodDetails" (
    "stockLotId" UUID NOT NULL,
    "foodName" TEXT NOT NULL,
    "photo" TEXT NOT NULL,
    "dateLabel" TEXT NOT NULL,
    "bestBy" DATE NOT NULL,
    "opened" BOOLEAN NOT NULL DEFAULT false,
    "shelfStable" BOOLEAN NOT NULL DEFAULT true,
    "storage" TEXT NOT NULL,
    "allergens" TEXT[],
    "allergensKnown" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StockFoodDetails_pkey" PRIMARY KEY ("stockLotId")
);

-- CreateIndex
CREATE INDEX "InventoryEvent_stockLotId_createdAt_idx" ON "InventoryEvent"("stockLotId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryEvent_actorId_commandKey_key" ON "InventoryEvent"("actorId", "commandKey");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_memberId_idempotencyKey_key" ON "Reservation"("memberId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_id_stockLotId_campusId_key" ON "Reservation"("id", "stockLotId", "campusId");

-- AddForeignKey
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_reservationId_stockLotId_campusId_fkey" FOREIGN KEY ("reservationId", "stockLotId", "campusId") REFERENCES "Reservation"("id", "stockLotId", "campusId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockFoodDetails" ADD CONSTRAINT "StockFoodDetails_stockLotId_fkey" FOREIGN KEY ("stockLotId") REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve per-batch metadata from initial listing drafts.
INSERT INTO "StockFoodDetails" ("stockLotId", "foodName", photo, "dateLabel", "bestBy", opened, "shelfStable", storage, allergens, "allergensKnown")
SELECT lot.id, f."foodName", COALESCE(l.images[1], ''), f."dateLabel", f."bestBy", f.opened, f."shelfStable", f.storage, f.allergens, f."allergensKnown"
FROM "StockLot" lot JOIN "Listing" l ON l.id=lot."listingId" JOIN "FoodDetails" f ON f."listingId"=l.id;
ALTER TABLE "StockFoodDetails" ENABLE ROW LEVEL SECURITY;
-- Legacy events may lack snapshots; do not invent historical values.
-- All new inventory operations must provide the complete audit tuple.
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_snapshot_consistency" CHECK (
  ("onHandBefore" IS NULL AND "onHandAfter" IS NULL AND "reservedBefore" IS NULL AND "reservedAfter" IS NULL) OR
  ("onHandBefore" IS NOT NULL AND "onHandAfter" IS NOT NULL AND "reservedBefore" IS NOT NULL AND "reservedAfter" IS NOT NULL AND
   "onHandBefore">=0 AND "onHandAfter">=0 AND "reservedBefore">=0 AND "reservedAfter">=0 AND
   "reservedBefore"<="onHandBefore" AND "reservedAfter"<="onHandAfter" AND
   "onHandAfter"-"onHandBefore"="onHandDelta" AND "reservedAfter"-"reservedBefore"="reservedDelta")
);
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_request_hash" CHECK ("requestHash" IS NULL OR "requestHash" ~ '^[a-f0-9]{64}$');
