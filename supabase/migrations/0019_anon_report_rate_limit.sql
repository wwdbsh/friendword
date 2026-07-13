-- Anonymous public-pitch reports are rate limited per reporter without
-- storing the address itself: the API writes a salted SHA-256 of the
-- caller's IP and counts recent rows before accepting another report.

ALTER TABLE public.reports
  ADD COLUMN reporter_ip_hash TEXT;

CREATE INDEX reports_ip_hash_created_at_idx
  ON public.reports (reporter_ip_hash, created_at DESC)
  WHERE reporter_ip_hash IS NOT NULL;
