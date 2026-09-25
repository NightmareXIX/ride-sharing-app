ALTER TABLE "fares" ADD COLUMN "route_distance_method" "distance_method";--> statement-breakpoint
-- Hand-written backfill: until now a ride's actual km was its direct km, so the ride was
-- measured the way the estimate was. Fares are append-only (NFR-41); this schema change
-- is the one write that may fill the new column, so the trigger is off only around it.
ALTER TABLE "fares" DISABLE TRIGGER "fares_append_only";--> statement-breakpoint
UPDATE "fares" SET "route_distance_method" = "distance_method";--> statement-breakpoint
ALTER TABLE "fares" ENABLE TRIGGER "fares_append_only";--> statement-breakpoint
ALTER TABLE "fares" ALTER COLUMN "route_distance_method" SET NOT NULL;
