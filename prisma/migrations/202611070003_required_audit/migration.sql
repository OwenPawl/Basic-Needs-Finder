-- Only the seven original, explicitly fictional seed events need repair.
-- Preserve real/unknown history: any other incomplete audit row fails migration.
UPDATE "InventoryEvent" e SET "onHandBefore"=v.ob, "onHandAfter"=v.oa,
  "reservedBefore"=v.rb, "reservedAfter"=v.ra, "requestHash"=v.hash
FROM (VALUES
('demo-receipt-100','RECEIPT',0,6,0,0,'818748acc4896a5fccbb07303577e6b610b63b515a3e646a50895f1c94ead3c6','00000000-0000-4000-8000-000000000023'::uuid,'00000000-0000-4000-8000-000000001100'::uuid),
('demo-hold-100','RESERVE',6,6,0,1,'b996d4710cbc9e9ff1ceffc59f393ca9b7133f7bdf5301227256b87ef4165f98','00000000-0000-4000-8000-000000000022'::uuid,'00000000-0000-4000-8000-000000001100'::uuid),
('demo-receipt-101','RECEIPT',0,4,0,0,'7de63ba99779ea3072706c862a45d82b56726d553a777bda03de96e534b9d1c6','00000000-0000-4000-8000-000000000023'::uuid,'00000000-0000-4000-8000-000000001101'::uuid),
('demo-receipt-104','RECEIPT',0,3,0,0,'1420f88a4b2679ec919cdb968976aa182ebcd49d1685074b8433012265190d1b','00000000-0000-4000-8000-000000000023'::uuid,'00000000-0000-4000-8000-000000001104'::uuid),
('demo-receipt-105','RECEIPT',0,2,0,0,'b32d7abd106d4f64462aa6e87a1876b7508e68ee51cb4a830ac76ed9577f3de6','00000000-0000-4000-8000-000000000023'::uuid,'00000000-0000-4000-8000-000000001105'::uuid),
('demo-receipt-107','RECEIPT',0,1,0,0,'636eb6c6be8bdeccf16cd8a22b1b0c88690a378567243a7462865d549127e56d','00000000-0000-4000-8000-000000000023'::uuid,'00000000-0000-4000-8000-000000001107'::uuid),
('demo-hold-107','RESERVE',1,1,0,1,'636eb6c6be8bdeccf16cd8a22b1b0c88690a378567243a7462865d549127e56d','00000000-0000-4000-8000-000000000022'::uuid,'00000000-0000-4000-8000-000000001107'::uuid)) AS v(key,kind,ob,oa,rb,ra,hash,actor,lot)
WHERE e."commandKey"=v.key AND e.kind::text=v.kind AND e."actorId"=v.actor AND e."stockLotId"=v.lot
  AND e."onHandDelta"=v.oa-v.ob AND e."reservedDelta"=v.ra-v.rb
  AND e.reason IN ('Fictional seed receipt','Fictional seed hold')
  AND e."campusId"='00000000-0000-4000-8000-000000000001'::uuid
  AND EXISTS (SELECT 1 FROM "Campus" c WHERE c.id=e."campusId" AND c."isDemo")
  AND (e."onHandBefore" IS NULL OR e."requestHash" IS NULL);

ALTER TABLE "InventoryEvent"
  ALTER COLUMN "onHandBefore" SET NOT NULL,
  ALTER COLUMN "onHandAfter" SET NOT NULL,
  ALTER COLUMN "reservedBefore" SET NOT NULL,
  ALTER COLUMN "reservedAfter" SET NOT NULL,
  ALTER COLUMN "requestHash" SET NOT NULL;
