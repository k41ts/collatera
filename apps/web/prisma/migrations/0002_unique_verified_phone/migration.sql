-- Satu nomor HP hanya boleh terverifikasi di satu akun.
-- 1) Samakan format nomor lama ke +62…
UPDATE "public"."User" SET "phone" = regexp_replace("phone", '[\s().-]', '', 'g') WHERE "phone" IS NOT NULL;
UPDATE "public"."User" SET "phone" = '+62' || substr("phone", 2) WHERE "phone" LIKE '0%';
UPDATE "public"."User" SET "phone" = '+' || "phone" WHERE "phone" LIKE '62%';

-- 2) Nomor yang terverifikasi ganda: yang paling awal tetap, sisanya harus verifikasi ulang.
UPDATE "public"."User" u SET "phoneVerifiedAt" = NULL
WHERE u."phoneVerifiedAt" IS NOT NULL AND EXISTS (
  SELECT 1 FROM "public"."User" o
  WHERE o."phone" = u."phone" AND o."phoneVerifiedAt" IS NOT NULL
    AND (o."phoneVerifiedAt" < u."phoneVerifiedAt" OR (o."phoneVerifiedAt" = u."phoneVerifiedAt" AND o."id" < u."id"))
);

-- 3) Unique parsial (tidak bisa ditulis di schema.prisma).
CREATE UNIQUE INDEX "User_phone_verified_key" ON "public"."User"("phone") WHERE "phoneVerifiedAt" IS NOT NULL;
