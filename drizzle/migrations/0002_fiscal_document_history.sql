CREATE TABLE public.fiscal_document_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL,
 file_hash text NOT NULL,
 file_name text NOT NULL,
 storage_path text,
 extracted_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
 corrected_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
 warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
 totals jsonb NOT NULL DEFAULT '[]'::jsonb,
 status text NOT NULL DEFAULT 'pending',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id, file_hash)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fiscal_document_runs TO authenticated;
GRANT ALL ON public.fiscal_document_runs TO service_role;
ALTER TABLE public.fiscal_document_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own fiscal documents" ON public.fiscal_document_runs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX fiscal_document_runs_owner_date ON public.fiscal_document_runs(user_id, created_at DESC);
CREATE TABLE public.fiscal_ai_access (
 user_id uuid PRIMARY KEY,
 blocked boolean NOT NULL DEFAULT false,
 reason text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.fiscal_ai_access TO authenticated;
GRANT ALL ON public.fiscal_ai_access TO service_role;
ALTER TABLE public.fiscal_ai_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own fiscal AI access" ON public.fiscal_ai_access FOR SELECT TO authenticated USING (auth.uid() = user_id);