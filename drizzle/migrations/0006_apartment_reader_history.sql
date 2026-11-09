CREATE TABLE public.apartment_reader_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL,
 title text NOT NULL DEFAULT '',
 period text NOT NULL DEFAULT '',
 page_count integer NOT NULL DEFAULT 0,
 original_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
 reviewed_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
 source_files jsonb NOT NULL DEFAULT '[]'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.apartment_reader_runs TO authenticated;
GRANT ALL ON public.apartment_reader_runs TO service_role;
ALTER TABLE public.apartment_reader_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY apartment_reader_select ON public.apartment_reader_runs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY apartment_reader_insert ON public.apartment_reader_runs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY apartment_reader_update ON public.apartment_reader_runs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY apartment_reader_delete ON public.apartment_reader_runs FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX apartment_reader_user_date ON public.apartment_reader_runs (user_id, created_at DESC);
CREATE FUNCTION public.protect_apartment_reader_originals() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$ BEGIN
 IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.original_rows IS DISTINCT FROM OLD.original_rows OR NEW.source_files IS DISTINCT FROM OLD.source_files OR NEW.page_count IS DISTINCT FROM OLD.page_count THEN
 RAISE EXCEPTION 'Original apartment reading cannot be modified';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_apartment_reader_originals BEFORE UPDATE ON public.apartment_reader_runs FOR EACH ROW EXECUTE FUNCTION public.protect_apartment_reader_originals();