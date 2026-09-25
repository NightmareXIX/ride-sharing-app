CREATE TYPE "public"."pool_status" AS ENUM('active', 'finished');--> statement-breakpoint
CREATE TABLE "pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"status" "pool_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "pools_finished_at" CHECK (("pools"."status" = 'finished') = ("pools"."finished_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "booking_status_history" ADD COLUMN "pool_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "pool_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "arrived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pools" ADD CONSTRAINT "pools_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pools_one_active_per_vehicle" ON "pools" USING btree ("vehicle_id") WHERE "pools"."status" = 'active';--> statement-breakpoint
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_pool_id_idx" ON "bookings" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "bookings_open_requests_idx" ON "bookings" USING btree ("requested_at") WHERE "bookings"."status" = 'REQUESTED';--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_pool_accepted" CHECK (("bookings"."pool_id" IS NULL) = ("bookings"."accepted_at" IS NULL));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_requested_unassigned" CHECK ("bookings"."status" <> 'REQUESTED' OR "bookings"."pool_id" IS NULL);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_assigned_has_pool" CHECK ("bookings"."status" NOT IN ('ACCEPTED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED') OR "bookings"."pool_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_arrived_at" CHECK (("bookings"."status" NOT IN ('DRIVER_ARRIVED', 'STARTED', 'COMPLETED') OR "bookings"."arrived_at" IS NOT NULL) AND ("bookings"."arrived_at" IS NULL OR "bookings"."accepted_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_started_at" CHECK (("bookings"."started_at" IS NOT NULL) = ("bookings"."status" IN ('STARTED', 'COMPLETED')));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_completed_at" CHECK (("bookings"."completed_at" IS NOT NULL) = ("bookings"."status" = 'COMPLETED'));