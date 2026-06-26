
CREATE TABLE public.nota_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  arquivo TEXT,
  nome TEXT, cpf TEXT, cnpj TEXT, email TEXT, telefone TEXT,
  cep TEXT, endereco TEXT, numero TEXT, bairro TEXT, cidade TEXT, estado TEXT,
  nota_fiscal TEXT, data TEXT, valor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX nota_records_user_idx ON public.nota_records(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nota_records TO authenticated;
GRANT ALL ON public.nota_records TO service_role;
ALTER TABLE public.nota_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own records" ON public.nota_records FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.nota_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX nota_files_user_idx ON public.nota_files(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nota_files TO authenticated;
GRANT ALL ON public.nota_files TO service_role;
ALTER TABLE public.nota_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own files" ON public.nota_files FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.nota_records;
ALTER PUBLICATION supabase_realtime ADD TABLE public.nota_files;
