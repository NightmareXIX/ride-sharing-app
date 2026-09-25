-- Hand-written in place of ADD COLUMN … GENERATED ALWAYS AS IDENTITY, which numbers the
-- rows already there in storage order. Updated rows move in storage, so that order isn't
-- when they were made. Existing rows are numbered by creation time first, then the column
-- becomes the identity, continuing after them. The end state matches the snapshot.
ALTER TABLE "pools" ADD COLUMN "seq" bigint;--> statement-breakpoint
UPDATE "pools" SET "seq" = "ordered"."n" FROM (
  SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS "n" FROM "pools"
) AS "ordered" WHERE "pools"."id" = "ordered"."id";--> statement-breakpoint
ALTER TABLE "pools" ALTER COLUMN "seq" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pools" ALTER COLUMN "seq" ADD GENERATED ALWAYS AS IDENTITY (sequence name "pools_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
SELECT setval('"pools_seq_seq"', coalesce((SELECT max("seq") FROM "pools"), 0) + 1, false);--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "seq" bigint;--> statement-breakpoint
UPDATE "bookings" SET "seq" = "ordered"."n" FROM (
  SELECT "id", row_number() OVER (ORDER BY "requested_at", "id") AS "n" FROM "bookings"
) AS "ordered" WHERE "bookings"."id" = "ordered"."id";--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "seq" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "seq" ADD GENERATED ALWAYS AS IDENTITY (sequence name "bookings_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
SELECT setval('"bookings_seq_seq"', coalesce((SELECT max("seq") FROM "bookings"), 0) + 1, false);--> statement-breakpoint
CREATE INDEX "pools_vehicle_seq_idx" ON "pools" USING btree ("vehicle_id","seq");--> statement-breakpoint
CREATE INDEX "booking_status_history_pool_id_idx" ON "booking_status_history" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "bookings_passenger_seq_idx" ON "bookings" USING btree ("passenger_id","seq");--> statement-breakpoint
ALTER TABLE "pools" ADD CONSTRAINT "pools_seq_unique" UNIQUE("seq");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_seq_unique" UNIQUE("seq");
