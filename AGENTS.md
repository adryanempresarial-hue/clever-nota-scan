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
- Parse structured spreadsheets and ZIP/DOCX locally; send only unstructured document content to an authenticated server function with request-local AI providers.
