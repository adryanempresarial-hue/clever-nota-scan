CREATE TABLE public.crm_email_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  nome TEXT,
  email TEXT,
  telefone TEXT,
  cpf TEXT,
  cep TEXT,
  endereco TEXT,
  origem TEXT,
  provedor TEXT,
  extra JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_email_contacts TO authenticated;
GRANT ALL ON public.crm_email_contacts TO service_role;

ALTER TABLE public.crm_email_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own email contacts"
ON public.crm_email_contacts
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX crm_email_contacts_user_idx ON public.crm_email_contacts (user_id, created_at DESC);