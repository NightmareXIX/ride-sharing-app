CREATE TYPE "public"."stop_type" AS ENUM('pickup', 'dropoff');--> statement-breakpoint
CREATE TABLE "route_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"type" "stop_type" NOT NULL,
	"sequence" integer NOT NULL,
	"lat" numeric(9, 6) NOT NULL,
	"lng" numeric(9, 6) NOT NULL,
	"planned_odometer_km" numeric(8, 3) NOT NULL,
	"actual_odometer_km" numeric(8, 3),
	"reached_at" timestamp with time zone,
	"distance_method" "distance_method" NOT NULL,
	CONSTRAINT "route_stops_pool_sequence" UNIQUE("pool_id","sequence"),
	CONSTRAINT "route_stops_booking_type" UNIQUE("booking_id","type"),
	CONSTRAINT "route_stops_sequence_positive" CHECK ("route_stops"."sequence" >= 1),
	CONSTRAINT "route_stops_planned_non_negative" CHECK ("route_stops"."planned_odometer_km" >= 0),
	CONSTRAINT "route_stops_reached" CHECK (("route_stops"."reached_at" IS NULL) = ("route_stops"."actual_odometer_km" IS NULL)),
	CONSTRAINT "route_stops_reading_is_planned" CHECK ("route_stops"."actual_odometer_km" IS NULL OR "route_stops"."actual_odometer_km" = "route_stops"."planned_odometer_km")
);
--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Hand-written: drizzle-kit doesn't model triggers. A stop that has been reached keeps its
-- reading forever (NFR-41); stops still ahead may be reached or re-planned.
CREATE FUNCTION "reject_reached_stop_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."reached_at" IS NOT NULL THEN
    RAISE EXCEPTION 'a reached route stop is final; % is not allowed', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "route_stops_reached_final"
  BEFORE UPDATE OR DELETE ON "route_stops"
  FOR EACH ROW EXECUTE FUNCTION "reject_reached_stop_change"();
--> statement-breakpoint
-- Hand-written: a database with a trip already running gets stops for it. Passengers
-- aboard come first, their pickups reached at km 0 and their drop-offs one after another;
-- then everyone waiting, pickup then drop-off, each a direct ride further on.
WITH "ordered" AS (
  SELECT "bookings".*,
    row_number() OVER w AS "n",
    count(*) FILTER (WHERE "bookings"."status" = 'STARTED') OVER (PARTITION BY "bookings"."pool_id") AS "aboard",
    coalesce(sum("bookings"."direct_km") OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS "before"
  FROM "bookings"
  JOIN "pools" ON "pools"."id" = "bookings"."pool_id"
  WHERE "pools"."status" = 'active'
    AND "bookings"."status" IN ('ACCEPTED', 'DRIVER_ARRIVED', 'STARTED')
  WINDOW w AS (
    PARTITION BY "bookings"."pool_id"
    ORDER BY ("bookings"."status" = 'STARTED') DESC, "bookings"."accepted_at", "bookings"."id"
  )
)
INSERT INTO "route_stops" (
  "pool_id", "booking_id", "type", "sequence", "lat", "lng",
  "planned_odometer_km", "actual_odometer_km", "reached_at", "distance_method"
)
SELECT "pool_id", "id", 'pickup'::"stop_type",
  CASE WHEN "n" <= "aboard" THEN "n" ELSE 2 * "n" - 1 END,
  "pickup_lat", "pickup_lng",
  CASE WHEN "n" <= "aboard" THEN 0 ELSE "before" END,
  CASE WHEN "n" <= "aboard" THEN 0 END,
  CASE WHEN "n" <= "aboard" THEN "started_at" END,
  'fallback'::"distance_method"
FROM "ordered"
UNION ALL
SELECT "pool_id", "id", 'dropoff'::"stop_type",
  CASE WHEN "n" <= "aboard" THEN "aboard" + "n" ELSE 2 * "n" END,
  "dest_lat", "dest_lng", "before" + "direct_km", NULL, NULL, 'fallback'::"distance_method"
FROM "ordered";
