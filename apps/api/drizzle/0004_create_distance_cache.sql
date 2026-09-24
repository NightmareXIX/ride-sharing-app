CREATE TYPE "public"."distance_method" AS ENUM('routed', 'fallback');--> statement-breakpoint
CREATE TABLE "distance_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin_lat" numeric(9, 6) NOT NULL,
	"origin_lng" numeric(9, 6) NOT NULL,
	"dest_lat" numeric(9, 6) NOT NULL,
	"dest_lng" numeric(9, 6) NOT NULL,
	"distance_km" numeric(7, 3) NOT NULL,
	"method" "distance_method" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "distance_cache_pair" UNIQUE("origin_lat","origin_lng","dest_lat","dest_lng")
);
