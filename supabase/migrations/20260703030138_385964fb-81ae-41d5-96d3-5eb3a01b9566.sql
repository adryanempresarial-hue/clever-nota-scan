
CREATE TABLE public.crm_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  arquivo text NOT NULL DEFAULT '',
  documento_tipo text,
  campos jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_records TO authenticated;
GRANT ALL ON public.crm_records TO service_role;
ALTER TABLE public.crm_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own crm" ON public.crm_records FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
