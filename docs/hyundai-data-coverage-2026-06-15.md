# Hyundai Analytics Data Coverage

Generated: 2026-06-15T10:24:38.689Z

Scope: all `hyundai_*` analytics tables **except warranty** (`hyundai_warranty_*`).

Canonical Hyundai dealer codes in app:
- Jammu: `N5216`, `N6846`, `N6847`
- Udhampur: `N5217`, `N6848`, `N6849`

## Summary

| Table | Status | Rows | Size | Business date range | Dealers |
|-------|--------|------|------|---------------------|---------|
| `hyundai_ro_billing_report` | present | 63,488 | 38.22 MB | 2021-01-01 → 2026-06-11 | 11 |
| `hyundai_repair_order_list` | present | 1,18,795 | 67.48 MB | 2021-01-01 → 2026-06-04 | 8 |
| `hyundai_call_center_complaints` | present | 1,031 | 0.84 MB | — → — | 8 |
| `hyundai_ew_report` | present | 3,746 | 2.32 MB | 2021-01-09 → 2026-06-04 | 8 |
| `hyundai_adv_wise_lubricants_vas` | present | 14,768 | 10.44 MB | — | 6 |
| `hyundai_service_appointment` | present | 10,944 | 5.55 MB | — | 6 |
| `hyundai_demo_car_list` | present | 3,536 | 2.65 MB | — | 1 |
| `hyundai_customer_complaint_list` | present | 118 | 0.29 MB | 2026-05-05 → 2026-06-04 | 2 |
| `hyundai_operation_wise_analysis_report` | missing_from_supabase (backup JSON exists) | — | — | — | — |
| `hyundai_psf_yearly` | missing_from_supabase (backup JSON exists) | — | — | — | — |

## RO Billing (`hyundai_ro_billing_report`)
- **Rows:** 63,488
- **Size:** 38.22 MB
- **Business dates (bill_date):** 2021-01-01 → 2026-06-11 (0 null)
- **Import freshness (uploaded_at):** 2026-06-04 12:00:45.613+00 → 2026-06-15 08:22:55.079+00
- **Rows by year:** 2021: 17,651, 2022: 20,323, 2023: 11,476, 2024: 5,677, 2025: 5,828, 2026: 2,533

| Dealer | Branch | Rows | Date range | Latest upload |
|--------|--------|------|------------|---------------|
| N5203 | other | 40,205 | 2021-01-01 → 2026-05-14 | 2026-06-15 08:22:55.079+00 |
| N6819 | other | 10,686 | 2021-01-01 → 2026-06-03 | 2026-06-13 05:47:02.283+00 |
| N6815 | other | 5,449 | 2021-01-01 → 2026-05-14 | 2026-06-08 15:06:20.302+00 |
| N5804 | other | 3,680 | 2021-01-01 → 2026-06-11 | 2026-06-13 05:29:06.899+00 |
| N5701 | other | 3,275 | 2021-01-02 → 2026-05-13 | 2026-06-07 05:26:21.595+00 |
| N5216 | jammu | 50 | 2026-06-01 → 2026-06-02 | 2026-06-04 12:00:45.613+00 |
| N6847 | jammu | 50 | 2026-06-01 → 2026-06-04 | 2026-06-04 12:04:40.271+00 |
| N6845 | other | 49 | 2026-06-01 → 2026-06-04 | 2026-06-04 12:02:31.54+00 |
| N6848 | udhampur | 28 | 2026-06-01 → 2026-06-04 | 2026-06-04 12:05:48+00 |
| N6846 | jammu | 10 | 2026-06-01 → 2026-06-03 | 2026-06-04 12:03:33.182+00 |
| N6844 | other | 6 | 2026-06-04 → 2026-06-04 | 2026-06-04 12:01:58.501+00 |

## Open RO / Repair Orders (`hyundai_repair_order_list`)
- **Rows:** 1,18,795
- **Size:** 67.48 MB
- **Business dates (r_o_date):** 2021-01-01 → 2026-06-04 (0 null)
- **Import freshness (uploaded_at):** 2026-06-04 08:59:25.885+00 → 2026-06-15 10:23:02.663+00
- **Rows by year:** 2021: 19,585, 2022: 24,346, 2023: 22,819, 2024: 23,409, 2025: 21,313, 2026: 7,323

| Dealer | Branch | Rows | Date range | Latest upload |
|--------|--------|------|------------|---------------|
| N5203 | other | 1,06,716 | 2021-01-27 → 2026-05-15 | 2026-06-15 10:23:02.663+00 |
| N5804 | other | 4,701 | 2021-04-23 → 2026-06-03 | 2026-06-13 05:00:21.946+00 |
| N6815 | other | 3,713 | 2021-01-01 → 2026-05-14 | 2026-06-13 05:10:28.465+00 |
| N6819 | other | 3,200 | 2021-01-18 → 2026-05-23 | 2026-06-13 05:13:48.757+00 |
| (null) | unknown | 359 | 2026-05-10 → 2026-05-23 | 2026-06-04 08:59:25.885+00 |
| N5701 | other | 50 | 2021-07-13 → 2026-05-13 | 2026-06-13 04:56:51.544+00 |
| N6826 | other | 30 | 2026-05-01 → 2026-05-14 | 2026-06-13 05:16:58.978+00 |
| N5216 | jammu | 24 | 2026-05-30 → 2026-05-31 | 2026-06-04 12:51:19.868+00 |
| N6847 | jammu | 2 | 2026-06-04 → 2026-06-04 | 2026-06-04 10:58:29.867+00 |

## Call Center Complaints (`hyundai_call_center_complaints`)
- **Rows:** 1,031
- **Size:** 0.84 MB
- **Business dates (complaint_date):** null → null (1031 null)
- **Import freshness (uploaded_at):** 2026-06-04 10:18:57.608+00 → 2026-06-11 14:24:34.103+00

| Dealer | Branch | Rows | Date range | Latest upload |
|--------|--------|------|------------|---------------|
| N5203 | other | 842 | — → — | 2026-06-06 08:52:39.705+00 |
| N5804 | other | 150 | — → — | 2026-06-08 05:39:17.504+00 |
| N5701 | other | 22 | — → — | 2026-06-07 06:15:58.239+00 |
| N6815 | other | 12 | — → — | 2026-06-08 15:15:01.465+00 |
| N6819 | other | 2 | — → — | 2026-06-11 14:24:34.103+00 |
| ACTIVE | other | 1 | — → — | 2026-06-04 10:18:57.608+00 |
| N5216 | jammu | 1 | — → — | 2026-06-04 12:06:20.483+00 |
| N6848 | udhampur | 1 | — → — | 2026-06-04 11:13:25.852+00 |

## Extended Warranty (`hyundai_ew_report`)
- **Rows:** 3,746
- **Size:** 2.32 MB
- **Business dates (reg_date):** 2021-01-09 → 2026-06-04 (0 null)
- **Import freshness (uploaded_at):** 2026-06-04 12:13:54.994+00 → 2026-06-08 16:56:46.368+00
- **Rows by year:** 2021: 648, 2022: 739, 2023: 805, 2024: 845, 2025: 513, 2026: 196

| Dealer | Branch | Rows | Date range | Latest upload |
|--------|--------|------|------------|---------------|
| N5203 | other | 2,526 | 2021-01-09 → 2026-05-28 | 2026-06-06 12:11:10.207+00 |
| N5804 | other | 655 | 2021-01-11 → 2026-05-21 | 2026-06-08 07:42:51.849+00 |
| N5701 | other | 188 | 2021-03-27 → 2026-05-08 | 2026-06-07 11:36:51.847+00 |
| N6815 | other | 149 | 2021-03-27 → 2026-05-08 | 2026-06-08 16:56:46.368+00 |
| N6819 | other | 138 | 2021-04-17 → 2026-05-04 | 2026-06-06 12:11:10.207+00 |
| N6826 | other | 88 | 2021-03-31 → 2026-05-14 | 2026-06-06 12:11:10.207+00 |
| N5216 | jammu | 1 | 2026-06-03 → 2026-06-03 | 2026-06-04 12:13:54.994+00 |
| N6847 | jammu | 1 | 2026-06-04 → 2026-06-04 | 2026-06-04 12:13:54.994+00 |

## Advisor-wise Lubricants VAS (`hyundai_adv_wise_lubricants_vas`)
- **Rows:** 14,768
- **Size:** 10.44 MB
- **Import freshness (uploaded_at):** 2026-06-04 11:14:58.881+00 → 2026-06-13 12:21:05.491+00

| Dealer | Branch | Rows | Date range | Latest upload |
|--------|--------|------|------------|---------------|
| N5203 | other | 7,689 | — → — | 2026-06-13 11:56:16.045+00 |
| N5804 | other | 3,080 | — → — | 2026-06-13 12:02:59.867+00 |
| N5701 | other | 2,285 | — → — | 2026-06-07 12:35:33.289+00 |
| N6815 | other | 1,663 | — → — | 2026-06-08 17:30:31.747+00 |
| ACTIVE | other | 50 | — → — | 2026-06-04 11:14:58.881+00 |
| N6819 | other | 1 | — → — | 2026-06-13 12:21:05.491+00 |

## Service Appointments (`hyundai_service_appointment`)
- **Rows:** 10,944
- **Size:** 5.55 MB
- **Import freshness (uploaded_at):** 2026-06-04 11:22:48.718+00 → 2026-06-13 07:46:07.658+00

| Dealer | Branch | Rows | Date range | Latest upload |
|--------|--------|------|------------|---------------|
| N5203 | other | 4,292 | — → — | 2026-06-13 07:26:09.01+00 |
| N5804 | other | 3,255 | — → — | 2026-06-13 07:28:36.346+00 |
| N6815 | other | 1,839 | — → — | 2026-06-08 15:43:04.095+00 |
| N5701 | other | 1,549 | — → — | 2026-06-13 07:27:47.62+00 |
| ACTIVE | other | 7 | — → — | 2026-06-04 11:22:48.718+00 |
| N6819 | other | 2 | — → — | 2026-06-13 07:46:07.658+00 |

## Demo Cars (`hyundai_demo_car_list`)
- **Rows:** 3,536
- **Size:** 2.65 MB
- **Import freshness (uploaded_at):** 2026-06-06 08:53:04.498+00 → 2026-06-13 06:39:11.841+00

| Dealer | Branch | Rows | Date range | Latest upload |
|--------|--------|------|------------|---------------|
| N5203 | other | 3,536 | — → — | 2026-06-13 06:39:11.841+00 |

## Customer Complaints (`hyundai_customer_complaint_list`)
- **Rows:** 118
- **Size:** 0.29 MB
- **Business dates (complaint_date):** 2026-05-05 → 2026-06-04 (0 null)
- **Import freshness (uploaded_at):** 2026-06-04 10:23:42.229+00 → 2026-06-05 04:21:34.315+00
- **Rows by year:** 2026: 118

| Dealer | Branch | Rows | Date range | Latest upload |
|--------|--------|------|------------|---------------|
| N5216 | jammu | 72 | 2026-05-05 → 2026-06-03 | 2026-06-05 04:21:34.315+00 |
| ACTIVE | other | 46 | 2026-05-29 → 2026-06-04 | 2026-06-04 10:23:56.197+00 |

## Operation-wise Analysis (dropped from Supabase) (`hyundai_operation_wise_analysis_report`)
- **Status:** not in Supabase
- **Local backup:** 15,426 rows exported 2026-06-15T09:10:07.919Z

## PSF Yearly (dropped from Supabase) (`hyundai_psf_yearly`)
- **Status:** not in Supabase
- **Local backup:** 15,772 rows exported 2026-06-15T09:09:43.925Z
