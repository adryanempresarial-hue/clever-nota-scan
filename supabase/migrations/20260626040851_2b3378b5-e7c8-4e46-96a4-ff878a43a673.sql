
CREATE POLICY "own bucket read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'nota-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own bucket insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'nota-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own bucket delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'nota-files' AND auth.uid()::text = (storage.foldername(name))[1]);
