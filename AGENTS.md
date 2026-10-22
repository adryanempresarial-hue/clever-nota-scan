<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep fiscal document reading isolated in fiscal-reader modules and FiscalDocumentReader below FiscalTab; preserve the existing calculator and extraction services.
- Store fiscal runs with user-scoped RLS and a unique content hash; retain immutable extracted rows separately from reviewed corrections and calculate totals in integer cents.
- Fiscal imports use browser-local spreadsheet/text/PDF extraction and locally hosted OCR resources without AI fallback, so imports do not spend AI credits; preserve unrelated extraction services.
- Keep executable domain-rule tests under tests/ so test-runner imports do not enter application compilation.
- Fiscal reader result rows support optional source page/comp and nested payments with a legacy scalar fallback; share computed result/export rules to preserve existing history without a schema migration.
- The Fechamento Verdes Vales export fills the user's template in public/templates via fflate XML edits (preserves formulas/styles, forces recalc on open); never rebuild it with SheetJS, which drops styles.
- Keep combined closing selection in FiscalClosingExport, loading the complete private history with pagination and sharing selected-row assembly with tests; visible history filters must never limit export choices.
- Keep quick-search apartment matching and standard copy assembly in a browser-safe pure module; match CPF before exact normalized names and keep apartment metadata outside copied contact fields.
- Keep fiscal pencil edits on source credits/payments; derived-value pencils open their underlying inputs so totals, splits and exports remain consistent with original preservation.
- Keep import-date bounds in a shared pure module, using local calendar days and an exclusive next-day upper bound so quick search and fiscal history agree without affecting closing export selection.
- Store extracted contact UH separately from address number and copied fields, preserving leading zeros so guest headings never infer apartments from residential numbers.
