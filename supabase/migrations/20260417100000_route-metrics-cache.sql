-- Creates a dedicated cache table for Google Directions results.
-- Keyed on coordinates rounded to 5 decimal places (~1 m precision) per company.
-- Replaces the fragile exact-float-equality query against the trips table.
-- Run manually in Supabase SQL Editor before deploying code changes.

CREATE TABLE IF NOT EXISTS public.route_metrics_cache (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid         NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  origin_lat       decimal(8,5) NOT NULL,
  origin_lng       decimal(8,5) NOT NULL,
  dest_lat         decimal(8,5) NOT NULL,
  dest_lng         decimal(8,5) NOT NULL,
  distance_km      float8       NOT NULL,
  duration_seconds int4         NOT NULL,
  created_at       timestamptz  DEFAULT now(),
  UNIQUE (company_id, origin_lat, origin_lng, dest_lat, dest_lng)
);

CREATE INDEX IF NOT EXISTS idx_route_metrics_lookup
  ON public.route_metrics_cache (company_id, origin_lat, origin_lng, dest_lat, dest_lng);
