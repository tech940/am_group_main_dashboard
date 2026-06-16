-- AM Finance analytics/register performance indexes.
-- Run outside a transaction because the concurrent indexes below cannot run inside one.

create index concurrently if not exists finance_sheet_hyp_idx
  on public.finance_sheet (hyp);

create index concurrently if not exists finance_sheet_tl_idx
  on public.finance_sheet (tl);

create index concurrently if not exists finance_sheet_sales_executive_idx
  on public.finance_sheet (sales_executive);

create index concurrently if not exists finance_sheet_branch_idx
  on public.finance_sheet (branch);

create index concurrently if not exists finance_sheet_bank_login_idx
  on public.finance_sheet (bank_login);

create index concurrently if not exists finance_sheet_bank_in_proforma_idx
  on public.finance_sheet (bank_in_proforma);

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
grant usage on schema extensions to postgres, anon, authenticated, service_role;

drop index concurrently if exists public.finance_sheet_search_trgm_idx;

create index concurrently if not exists finance_sheet_search_trgm_idx
  on public.finance_sheet using gin (
    lower(
      coalesce(customer_name, '') || ' ' ||
      coalesce(mobile_no, '') || ' ' ||
      coalesce(model, '') || ' ' ||
      coalesce(invoice_number, '') || ' ' ||
      coalesce(vehicle_registration_number_to_sale, '') || ' ' ||
      coalesce(hyp, '') || ' ' ||
      coalesce(branch, '') || ' ' ||
      coalesce(sales_executive, '') || ' ' ||
      coalesce(tl, '') || ' ' ||
      coalesce(main_dealer, '') || ' ' ||
      coalesce(location, '') || ' ' ||
      coalesce(bank_login, '') || ' ' ||
      coalesce(bank_in_proforma, '')
    ) gin_trgm_ops
  );
