-- =============================================================================
-- Migration: 002_leads
-- Description: Creates the leads table for the law firm landing page contact
--              form, with Row Level Security (RLS) and appropriate indexes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ENUM types
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE legal_area_enum AS ENUM (
    'criminal',
    'civil',
    'family',
    'real_estate',
    'corporate',
    'labor',
    'administrative',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE preferred_contact_enum AS ENUM ('phone', 'email', 'whatsapp');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Table definition
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.leads (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Contact details
  full_name        TEXT          NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 100),
  email            TEXT          NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone            TEXT          NOT NULL CHECK (char_length(phone) BETWEEN 9 AND 20),

  -- Inquiry details
  legal_area       legal_area_enum         NOT NULL DEFAULT 'other',
  message          TEXT          NOT NULL CHECK (char_length(message) BETWEEN 10 AND 2000),
  preferred_contact preferred_contact_enum NOT NULL DEFAULT 'phone',

  -- Compliance & tracking
  consent          BOOLEAN       NOT NULL DEFAULT FALSE,
  source           TEXT                   DEFAULT 'website' CHECK (char_length(source) <= 100),
  ip_address       INET,

  -- CRM workflow
  status           TEXT          NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'contacted', 'consultation_scheduled', 'closed_won', 'closed_lost')),
  notes            TEXT,
  assigned_to      UUID          REFERENCES auth.users (id) ON DELETE SET NULL,

  -- Timestamps
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.leads IS
  'Prospective client enquiries submitted via the law firm contact form.';

-- ---------------------------------------------------------------------------
-- 3. Auto-update updated_at
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_set_updated_at ON public.leads;
CREATE TRIGGER leads_set_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_leads_created_at  ON public.leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status      ON public.leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_email       ON public.leads (email);
CREATE INDEX IF NOT EXISTS idx_leads_legal_area  ON public.leads (legal_area);

-- ---------------------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Public can INSERT only (anonymous form submission via service-role key)
-- No SELECT/UPDATE/DELETE for anonymous users
CREATE POLICY "anon_insert_leads"
  ON public.leads
  FOR INSERT
  TO anon
  WITH CHECK (
    consent = TRUE        -- must have given consent
    AND char_length(full_name) >= 2
    AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  );

-- Authenticated staff can read all leads
CREATE POLICY "auth_select_leads"
  ON public.leads
  FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated staff can update leads (e.g. change status, add notes)
CREATE POLICY "auth_update_leads"
  ON public.leads
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Only service_role (admin) can hard-delete leads
-- No DELETE policy for authenticated — use soft-delete via status field

-- ---------------------------------------------------------------------------
-- 6. Grant minimum required privileges
-- ---------------------------------------------------------------------------

GRANT INSERT ON public.leads TO anon;
GRANT SELECT, UPDATE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
