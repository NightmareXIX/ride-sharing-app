ALTER TABLE "vehicles" ADD COLUMN "occupied_seats" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Hand-written: a database that already has a trip running starts with the seats its
-- bookings hold, so occupied_seats matches them from the first accept on.
UPDATE "vehicles" SET "occupied_seats" = held."seats"
FROM (
  SELECT "pools"."vehicle_id", sum("bookings"."seats")::integer AS "seats"
  FROM "bookings"
  JOIN "pools" ON "pools"."id" = "bookings"."pool_id"
  WHERE "pools"."status" = 'active'
    AND "bookings"."status" IN ('ACCEPTED', 'DRIVER_ARRIVED', 'STARTED')
  GROUP BY "pools"."vehicle_id"
) AS held
WHERE "vehicles"."id" = held."vehicle_id";--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_occupied_seats_range" CHECK ("vehicles"."occupied_seats" BETWEEN 0 AND "vehicles"."capacity");
