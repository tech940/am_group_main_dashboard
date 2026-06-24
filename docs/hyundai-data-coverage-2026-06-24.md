# Hyundai Analytics Data Coverage

Generated: 2026-06-24T07:34:11.015Z

Scope: all `hyundai_*` analytics tables **except warranty** (`hyundai_warranty_*`).

Canonical Hyundai dealer codes in app:
- Jammu: `N5203`, `N5216`
- Akhnoor: `N5701`, `N6844`
- Kathua: `N5804`, `N6845`
- RS Pura: `N6815`, `N6846`
- Vijaypur: `N6819`, `N6847`
- Billawar: `N6828`, `N6848`
- Legacy URL label `UDHAMPUR` aliases to Billawar; source codes `N5217` and `N6849` remain unmapped.

## Summary

| Table | Status | Rows | Size | Business date range | Dealers |
|-------|--------|------|------|---------------------|---------|
| `hyundai_ro_billing_report` | present | 1,34,485 | 114.50 MB | 2021-01-01 → 2026-06-18 | 6 |
| `hyundai_repair_order_list` | present | 1,70,132 | 105.88 MB | 2021-01-01 → 2026-06-20 | 8 |
| `hyundai_call_center_complaints` | present | 1,184 | 2.39 MB | — → — | 4 |
| `hyundai_ew_report` | present | 5,208 | 10.72 MB | 2021-01-09 → 2026-05-28 | 6 |
| `hyundai_adv_wise_lubricants_vas` | present | 41,370 | 96.94 MB | — | 5 |
| `hyundai_service_appointment` | present | 98,489 | 112.71 MB | — | 7 |
| `hyundai_demo_car_list` | present | 11,102 | 28.82 MB | — | 2 |
| `hyundai_customer_complaint_list` | present | 72 | 0.29 MB | 2026-05-05 → 2026-06-03 | 1 |
| `hyundai_operation_wise_analysis_report` | present | 34,979 | 29.55 MB | 2021-01-01 → 2026-06-01 | 6 |
| `hyundai_psf_yearly` | present | 1,02,696 | 178.32 MB | — | 3 |

## RO Billing (`hyundai_ro_billing_report`)
- **Rows:** 1,34,485
- **Size:** 114.50 MB
- **Business dates (bill_date):** 2021-01-01 → 2026-06-18 (0 null)
- **Import freshness (uploaded_at):** 2026-06-04 12:00:45.613+00 → 2026-06-24 05:16:13.531+00
- **Rows by year:** 2021: 21,634, 2022: 24,788, 2023: 24,671, 2024: 27,757, 2025: 26,242, 2026: 9,393

| Dealer | Branch | Rows | Date range | Latest upload |
|--------|--------|------|------------|---------------|
| N5216 | jammu | 85,735 | 2021-01-01 → 2026-06-18 | 2026-06-19 12:33:00.072+00 |
| N6845 | kathua | 22,858 | 2021-01-01 → 2026-06-11 | 2026-06-19 17:02:10.303+00 |
| N6847 | vijaypur | 10,736 | 2021-01-01 → 2026-06-04 | 2026-06-24 05:16:13.531+00 |
| N6846 | rs_pura | 5,459 | 2021-01-01 → 2026-06-03 | 2026-06-24 04:37:50.287+00 |
| N6844 | akhnoor | 5,394 | 2021-01-02 → 2026-06-04 | 2026-06-21 14:15:10.382+00 |
| N6848 | billawar | 4,303 | 2021-01-05 → 2026-06-04 | 2026-06-21 13:44:40.06+00 |

## Open RO / Repair Orders (`hyundai_repair_order_list`)
- **Rows:** 1,70,132
- **Size:** 105.88 MB
- **Business dates (r_o_date):** 2021-01-01 → 2026-06-20 (0 null)
- **Import freshness (uploaded_at):** 2026-06-04 08:59:25.885+00 → 2026-06-24 05:12:06.699+00
- **Rows by year:** 2021: 28,628, 2022: 32,836, 2023: 31,664, 2024: 33,697, 2025: 31,423, 2026: 11,884

| Dealer | Branch | Rows | Date range | Latest upload |
|--------|--------|------|------------|---------------|
| N5203 | jammu | 1,08,749 | 2021-01-01 → 2026-05-15 | 2026-06-20 04:02:01.827+00 |
| N5804 | kathua | 27,722 | 2021-01-01 → 2026-06-06 | 2026-06-19 16:51:02.575+00 |
| (null) | unknown | 20,991 | 2021-01-01 → 2026-06-20 | 2026-06-24 05:11:55.914+00 |
| N6826 | other | 3,955 | 2021-07-02 → 2026-05-14 | 2026-06-20 13:08:09.154+00 |
| N6815 | rs_pura | 3,754 | 2021-01-01 → 2026-05-14 | 2026-06-24 04:34:55.09+00 |
| N6819 | vijaypur | 3,472 | 2021-01-18 → 2026-05-23 | 2026-06-24 05:12:06.699+00 |
| N5701 | akhnoor | 1,463 | 2021-01-02 → 2026-05-13 | 2026-06-20 13:08:19.88+00 |
| N5216 | jammu | 24 | 2026-05-30 → 2026-05-31 | 2026-06-04 12:51:19.868+00 |
| N6847 | vijaypur | 2 | 2026-06-04 → 2026-06-04 | 2026-06-04 10:58:29.867+00 |

## Call Center Complaints (`hyundai_call_center_complaints`)
- **Rows:** 1,184
- **Size:** 2.39 MB
- **Business dates (complaint_date):** null → null (1184 null)
- **Import freshness (uploaded_at):** 2026-06-18 08:51:14.483+00 → 2026-06-24 07:14:10.193+00

| Dealer | Branch | Rows | Date range | Latest upload |
|--------|--------|------|------------|---------------|
| N5216 | jammu | 856 | — → — | 2026-06-21 14:08:34.547+00 |
| N5203 | jammu | 266 | — → — | 2026-06-24 06:07:04.742+00 |
| N5804 | kathua | 54 | — → — | 2026-06-24 07:14:10.193+00 |
| N5701 | akhnoor | 8 | — → — | 2026-06-24 06:47:56.055+00 |

## Extended Warranty (`hyundai_ew_report`)
- **Rows:** 5,208
- **Size:** 10.72 MB
- **Business dates (reg_date):** 2021-01-09 → 2026-05-28 (0 null)
- **Import freshness (uploaded_at):** 2026-06-07 11:30:15.673+00 → 2026-06-24 07:10:37.847+00
- **Rows by year:** 2021: 792, 2022: 903, 2023: 1,087, 2024: 1,094, 2025: 973, 2026: 359

| Dealer | Branch | Rows | Date range | Latest upload |
|--------|--------|------|------------|---------------|
| N5203 | jammu | 3,884 | 2021-01-09 → 2026-05-28 | 2026-06-24 06:41:57.032+00 |
| N5804 | kathua | 588 | 2021-01-11 → 2026-05-21 | 2026-06-24 06:41:57.032+00 |
| N6819 | vijaypur | 247 | 2021-04-17 → 2026-05-04 | 2026-06-24 06:41:57.032+00 |
| N5701 | akhnoor | 203 | 2021-03-27 → 2026-05-08 | 2026-06-24 07:10:37.847+00 |
| N6826 | other | 151 | 2021-03-31 → 2026-05-14 | 2026-06-24 06:41:57.032+00 |
| N6815 | rs_pura | 135 | 2021-03-27 → 2026-05-08 | 2026-06-24 06:41:57.032+00 |

## Advisor-wise Lubricants VAS (`hyundai_adv_wise_lubricants_vas`)
- **Rows:** 41,370
- **Size:** 96.94 MB
- **Import freshness (uploaded_at):** 2026-06-06 12:11:34.29+00 → 2026-06-18 14:35:48.164+00

| Dealer | Branch | Rows | Date range | Latest upload |
|--------|--------|------|------------|---------------|
| N5216 | jammu | 34,338 | — → — | 2026-06-18 14:33:49.397+00 |
| N6845 | kathua | 3,082 | — → — | 2026-06-18 14:34:31.025+00 |
| N6844 | akhnoor | 2,285 | — → — | 2026-06-07 12:35:33.289+00 |
| N6846 | rs_pura | 1,663 | — → — | 2026-06-08 17:30:31.747+00 |
| N6847 | vijaypur | 2 | — → — | 2026-06-18 14:35:48.164+00 |

## Service Appointments (`hyundai_service_appointment`)
- **Rows:** 98,489
- **Size:** 112.71 MB
- **Import freshness (uploaded_at):** 2026-06-07 06:32:01.65+00 → 2026-06-24 07:27:24.689+00

| Dealer | Branch | Rows | Date range | Latest upload |
|--------|--------|------|------------|---------------|
| N5216 | jammu | 68,273 | — → — | 2026-06-18 13:25:41.017+00 |
| N5203 | jammu | 19,609 | — → — | 2026-06-24 06:19:07.581+00 |
| (null) | unknown | 6,637 | — → — | 2026-06-08 15:43:04.095+00 |
| N5804 | kathua | 3,858 | — → — | 2026-06-24 07:27:24.689+00 |
| N5701 | akhnoor | 103 | — → — | 2026-06-24 06:55:31.525+00 |
| N6845 | kathua | 5 | — → — | 2026-06-18 13:29:10.654+00 |
| N6847 | vijaypur | 3 | — → — | 2026-06-18 13:37:38.717+00 |
| N6844 | akhnoor | 1 | — → — | 2026-06-18 13:28:28.093+00 |

## Demo Cars (`hyundai_demo_car_list`)
- **Rows:** 11,102
- **Size:** 28.82 MB
- **Import freshness (uploaded_at):** 2026-06-18 09:18:48.461+00 → 2026-06-24 06:11:03.78+00

| Dealer | Branch | Rows | Date range | Latest upload |
|--------|--------|------|------------|---------------|
| N5216 | jammu | 8,637 | — → — | 2026-06-18 09:49:20.751+00 |
| N5203 | jammu | 2,465 | — → — | 2026-06-24 06:11:03.78+00 |

## Customer Complaints (`hyundai_customer_complaint_list`)
- **Rows:** 72
- **Size:** 0.29 MB
- **Business dates (complaint_date):** 2026-05-05 → 2026-06-03 (0 null)
- **Import freshness (uploaded_at):** 2026-06-05 04:21:19.689+00 → 2026-06-05 04:21:34.315+00
- **Rows by year:** 2026: 72

| Dealer | Branch | Rows | Date range | Latest upload |
|--------|--------|------|------------|---------------|
| N5216 | jammu | 72 | 2026-05-05 → 2026-06-03 | 2026-06-05 04:21:34.315+00 |

## Operation-wise Analysis (dropped from Supabase) (`hyundai_operation_wise_analysis_report`)
- **Rows:** 34,979
- **Size:** 29.55 MB
- **Business dates (report_period_start):** 2021-01-01 → 2026-06-01 (0 null)
- **Import freshness (uploaded_at):** 2026-06-19 12:36:31.738+00 → 2026-06-24 05:17:08.384+00
- **Rows by year:** 2021: 2,110, 2022: 3,068, 2023: 3,637, 2024: 5,023, 2025: 8,127, 2026: 13,014

| Dealer | Branch | Rows | Date range | Latest upload |
|--------|--------|------|------------|---------------|
| N5216 | jammu | 18,361 | 2021-01-01 → 2026-06-01 | 2026-06-21 15:02:11.044+00 |
| N6845 | kathua | 7,913 | 2021-01-01 → 2026-06-01 | 2026-06-21 15:59:06.543+00 |
| N6847 | vijaypur | 5,117 | 2021-01-01 → 2026-06-01 | 2026-06-24 05:17:08.384+00 |
| N6848 | billawar | 1,507 | 2021-01-01 → 2026-06-01 | 2026-06-21 18:04:04.573+00 |
| N6844 | akhnoor | 1,215 | 2021-01-01 → 2026-06-01 | 2026-06-21 15:30:56.092+00 |
| N6846 | rs_pura | 866 | 2021-01-01 → 2026-06-01 | 2026-06-24 05:05:16.242+00 |

## PSF Yearly (dropped from Supabase) (`hyundai_psf_yearly`)
- **Rows:** 1,02,696
- **Size:** 178.32 MB
- **Import freshness (uploaded_at):** 2026-06-18 12:00:09.465+00 → 2026-06-24 07:07:33.478+00

| Dealer | Branch | Rows | Date range | Latest upload |
|--------|--------|------|------------|---------------|
| N5216 | jammu | 81,996 | — → — | 2026-06-18 12:29:44.23+00 |
| N5203 | jammu | 19,466 | — → — | 2026-06-24 06:38:22.744+00 |
| N5701 | akhnoor | 1,234 | — → — | 2026-06-24 07:07:33.478+00 |
