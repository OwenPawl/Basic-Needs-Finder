-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('STUDENT', 'STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "ListingKind" AS ENUM ('OFFER', 'REQUEST');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('OPEN', 'FULFILLED', 'CLOSED', 'REMOVED');

-- CreateEnum
CREATE TYPE "StockStatus" AS ENUM ('PLEDGED', 'RECEIVED', 'REMOVED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InventoryEventKind" AS ENUM ('RECEIPT', 'RESERVE', 'CANCEL', 'EXPIRE', 'PICKUP', 'CORRECTION', 'REMOVE');

-- CreateTable
CREATE TABLE "Campus" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emailDomains" TEXT[],
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "authSubject" UUID,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'STUDENT',
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "building" TEXT NOT NULL,
    "hours" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAssignment" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "locationId" UUID NOT NULL,

    CONSTRAINT "StaffAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "categoryId" TEXT NOT NULL,
    "locationId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "ListingKind" NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'OPEN',
    "quantity" INTEGER,
    "images" TEXT[],
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodDetails" (
    "listingId" UUID NOT NULL,
    "foodName" TEXT NOT NULL,
    "dateLabel" TEXT NOT NULL,
    "bestBy" DATE NOT NULL,
    "opened" BOOLEAN NOT NULL DEFAULT false,
    "shelfStable" BOOLEAN NOT NULL DEFAULT true,
    "storage" TEXT NOT NULL,
    "allergens" TEXT[],
    "allergensKnown" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FoodDetails_pkey" PRIMARY KEY ("listingId")
);

-- CreateTable
CREATE TABLE "StockLot" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "status" "StockStatus" NOT NULL DEFAULT 'PLEDGED',
    "pledged" INTEGER NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3),

    CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "stockLotId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryEvent" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "stockLotId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "kind" "InventoryEventKind" NOT NULL,
    "onHandDelta" INTEGER NOT NULL,
    "reservedDelta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "commandKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationParticipant" (
    "conversationId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "campusId" UUID NOT NULL,

    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("conversationId","memberId")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Campus_slug_key" ON "Campus"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_authSubject_key" ON "User"("authSubject");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_campusId_key" ON "Membership"("userId", "campusId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_id_campusId_key" ON "Membership"("id", "campusId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_id_campusId_key" ON "Location"("id", "campusId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAssignment_membershipId_locationId_key" ON "StaffAssignment"("membershipId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE INDEX "Listing_campusId_kind_status_createdAt_idx" ON "Listing"("campusId", "kind", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Listing_categoryId_campusId_idx" ON "Listing"("categoryId", "campusId");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_id_campusId_key" ON "Listing"("id", "campusId");

-- CreateIndex
CREATE INDEX "StockLot_campusId_locationId_status_idx" ON "StockLot"("campusId", "locationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockLot_id_campusId_key" ON "StockLot"("id", "campusId");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_idempotencyKey_key" ON "Reservation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Reservation_status_expiresAt_idx" ON "Reservation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Reservation_memberId_createdAt_idx" ON "Reservation"("memberId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryEvent_commandKey_key" ON "InventoryEvent"("commandKey");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_id_campusId_key" ON "Conversation"("id", "campusId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_membershipId_campusId_fkey" FOREIGN KEY ("membershipId", "campusId") REFERENCES "Membership"("id", "campusId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_locationId_campusId_fkey" FOREIGN KEY ("locationId", "campusId") REFERENCES "Location"("id", "campusId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_authorId_campusId_fkey" FOREIGN KEY ("authorId", "campusId") REFERENCES "Membership"("id", "campusId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_locationId_campusId_fkey" FOREIGN KEY ("locationId", "campusId") REFERENCES "Location"("id", "campusId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodDetails" ADD CONSTRAINT "FoodDetails_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_listingId_campusId_fkey" FOREIGN KEY ("listingId", "campusId") REFERENCES "Listing"("id", "campusId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_locationId_campusId_fkey" FOREIGN KEY ("locationId", "campusId") REFERENCES "Location"("id", "campusId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_stockLotId_campusId_fkey" FOREIGN KEY ("stockLotId", "campusId") REFERENCES "StockLot"("id", "campusId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_memberId_campusId_fkey" FOREIGN KEY ("memberId", "campusId") REFERENCES "Membership"("id", "campusId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_stockLotId_campusId_fkey" FOREIGN KEY ("stockLotId", "campusId") REFERENCES "StockLot"("id", "campusId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_actorId_campusId_fkey" FOREIGN KEY ("actorId", "campusId") REFERENCES "Membership"("id", "campusId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_listingId_campusId_fkey" FOREIGN KEY ("listingId", "campusId") REFERENCES "Listing"("id", "campusId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_campusId_fkey" FOREIGN KEY ("conversationId", "campusId") REFERENCES "Conversation"("id", "campusId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_memberId_campusId_fkey" FOREIGN KEY ("memberId", "campusId") REFERENCES "Membership"("id", "campusId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_senderId_fkey" FOREIGN KEY ("conversationId", "senderId") REFERENCES "ConversationParticipant"("conversationId", "memberId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_campusId_fkey" FOREIGN KEY ("reporterId", "campusId") REFERENCES "Membership"("id", "campusId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_listingId_campusId_fkey" FOREIGN KEY ("listingId", "campusId") REFERENCES "Listing"("id", "campusId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Inventory counters are guarded in PostgreSQL, not only in the UI.
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_nonnegative" CHECK ("pledged" > 0 AND "onHand" >= 0 AND "reserved" >= 0 AND "reserved" <= "onHand");
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_receipt_boundary" CHECK ((status != 'PLEDGED' OR ("onHand" = 0 AND "reserved" = 0 AND "receivedAt" IS NULL)) AND (status != 'RECEIVED' OR "receivedAt" IS NOT NULL));
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_positive_quantity" CHECK (quantity > 0);
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_positive_quantity" CHECK (quantity IS NULL OR quantity > 0);
ALTER TABLE "Message" ADD CONSTRAINT "Message_nonempty_body" CHECK (length(trim(body)) BETWEEN 1 AND 10000);
-- Default deny for hosted browser/data-API access. The auth task must introduce
-- and test explicit RLS policies. Database owner commands can still migrate/seed.
ALTER TABLE "Campus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Location" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Listing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FoodDetails" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockLot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Reservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConversationParticipant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Report" ENABLE ROW LEVEL SECURITY;
