CREATE TABLE "fares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"pickup_odometer_km" numeric(8, 3) NOT NULL,
	"dropoff_odometer_km" numeric(8, 3) NOT NULL,
	"actual_km" numeric(7, 3) NOT NULL,
	"shared_km" numeric(7, 3) NOT NULL,
	"direct_km" numeric(7, 3) NOT NULL,
	"seats" integer NOT NULL,
	"seat_multiplier" numeric(4, 2) NOT NULL,
	"ride_option" "ride_option" NOT NULL,
	"option_multiplier" numeric(4, 2) NOT NULL,
	"estimated_fare" numeric(10, 2) NOT NULL,
	"computed_fare" numeric(10, 2) NOT NULL,
	"final_fare" numeric(10, 2) NOT NULL,
	"distance_method" "distance_method" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fares_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "fares_final_within_estimate" CHECK ("fares"."final_fare" <= "fares"."estimated_fare"),
	CONSTRAINT "fares_shared_within_actual" CHECK ("fares"."shared_km" <= "fares"."actual_km")
);
--> statement-breakpoint
ALTER TABLE "fares" ADD CONSTRAINT "fares_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Hand-written: drizzle-kit doesn't model triggers. A recorded fare is never changed or
-- recalculated (NFR-41); reject_update_delete() comes from 0005.
CREATE TRIGGER "fares_append_only"
  BEFORE UPDATE OR DELETE ON "fares"
  FOR EACH ROW EXECUTE FUNCTION "reject_update_delete"();
