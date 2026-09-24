ALTER TABLE "vehicles" ADD COLUMN "is_online" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "current_lat" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "current_lng" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_location_complete" CHECK (("vehicles"."current_lat" IS NULL) = ("vehicles"."current_lng" IS NULL));--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_online_needs_location" CHECK (NOT "vehicles"."is_online" OR "vehicles"."current_lat" IS NOT NULL);