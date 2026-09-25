CREATE TABLE "driver_penalties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "driver_penalties" ADD CONSTRAINT "driver_penalties_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_penalties" ADD CONSTRAINT "driver_penalties_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_penalties_driver_id_idx" ON "driver_penalties" USING btree ("driver_id");--> statement-breakpoint
-- Hand-written: drizzle-kit doesn't model triggers. Penalty records are kept forever
-- (NFR-40); reject_update_delete() comes from 0005.
CREATE TRIGGER "driver_penalties_append_only"
  BEFORE UPDATE OR DELETE ON "driver_penalties"
  FOR EACH ROW EXECUTE FUNCTION "reject_update_delete"();
