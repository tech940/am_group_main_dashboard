const dotenv = require('dotenv')
const postgres = require('postgres')

dotenv.config({ quiet: true })

function databaseUrl() {
  const raw = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!raw) throw new Error('DATABASE_URL is not configured')
  const url = new URL(raw)
  if (url.port === '6543' || url.searchParams.get('pgbouncer') === 'true') {
    url.port = '5432'
    url.searchParams.delete('pgbouncer')
  }
  return url.toString()
}

const categories = (free, paid, running, accidental) => ({
  'Free Service': free,
  'Paid Service': paid,
  'Running Repair': running,
  'Accidental Repair': accidental,
})

const snapshots = [
  {
    reportDate: '2026-06-08',
    sourceLabel: 'MD verified report dated 08/06/2026',
    metrics: {
      exportDate: '2026-06-08',
      monthStart: '2026-06-01',
      intake: categories(
        { today: 5, mtd: 21 },
        { today: 3, mtd: 16 },
        { today: 1, mtd: 17 },
        { today: 3, mtd: 16 },
      ),
      pending: {
        accidental: { today: 3, mtd: 8 },
        mechanical: { today: 0, mtd: 0 },
      },
      addons: {
        ew: { today: 0, mtd: 1 },
        rsa: { today: 1, mtd: 11 },
        mcp: { today: 0, mtd: 0 },
        bodyshopMcp: { today: 0, mtd: 0 },
      },
      revenue: {
        delivered: categories(
          { today: 4, mtd: 20 },
          { today: 3, mtd: 18 },
          { today: 1, mtd: 18 },
          { today: 4, mtd: 11 },
        ),
        mechanicalLabour: { today: 19864, mtd: 121550 },
        mechanicalParts: { today: 27607, mtd: 214778 },
        bodyshopLabour: { today: 51914, mtd: 96482 },
        bodyshopParts: { today: 261547, mtd: 307207 },
      },
      operations: {
        alignmentCount: 27,
        balancingCount: 21,
        alignmentLabour: 16783,
        balancingLabour: 12673,
      },
      oil: {
        engineOilQty: { today: 148, mtd: 148 },
        syntheticOilQty: { today: 0, mtd: 0 },
      },
      vasAmount: 26814,
      bodyshopPnaCases: 3,
      sourceMetadata: {
        workingDayCount: 5,
        source: 'verified_md_snapshot',
        dateBasis: 'Values frozen from the MD report issued on 08/06/2026',
      },
      sourceWarnings: [
        'The current transactional tables contain later corrections and cannot reconstruct the 08/06/2026 pending/status state exactly.',
      ],
    },
    cellOverrides: {
      B28: 9, C28: 9,
      B29: 3254, C29: 3254,
      B30: 2171, C30: 2171,
      B31: 8771, C31: 8771,
      B32: 7791, C32: 7791,
      B33: 3835, C33: 3835,
      B34: 27928, C34: 27928,
      B36: 2, C36: 2,
      B39: 0, C39: 0,
      B40: 3, C40: 3,
      B41: 2854, C41: 2854,
    },
  },
  {
    reportDate: '2026-06-17',
    sourceLabel: 'MD verified report dated 17/06/2026',
    metrics: {
      exportDate: '2026-06-17',
      monthStart: '2026-06-01',
      intake: categories(
        { today: 0, mtd: 38 },
        { today: 4, mtd: 43 },
        { today: 1, mtd: 38 },
        { today: 0, mtd: 33 },
      ),
      pending: {
        accidental: { today: 0, mtd: 17 },
        mechanical: { today: 1, mtd: 1 },
      },
      addons: {
        ew: { today: 0, mtd: 3 },
        rsa: { today: 1, mtd: 18 },
        mcp: { today: 0, mtd: 1 },
        bodyshopMcp: { today: 0, mtd: 0 },
      },
      revenue: {
        delivered: categories(
          { today: 0, mtd: 38 },
          { today: 4, mtd: 46 },
          { today: 0, mtd: 37 },
          { today: 2, mtd: 27 },
        ),
        mechanicalLabour: { today: 16486, mtd: 298011 },
        mechanicalParts: { today: 21748, mtd: 520941 },
        bodyshopLabour: { today: 4521, mtd: 301468 },
        bodyshopParts: { today: 40662, mtd: 495145 },
      },
      operations: {
        alignmentCount: 57,
        balancingCount: 48,
        alignmentLabour: 35436,
        balancingLabour: 30073,
      },
      oil: {
        engineOilQty: { today: 309, mtd: 309 },
        syntheticOilQty: { today: 0, mtd: 0 },
      },
      vasAmount: 62979,
      bodyshopPnaCases: 6,
      sourceMetadata: {
        workingDayCount: 13,
        source: 'verified_md_snapshot',
        dateBasis: 'Values frozen from the MD report issued on 17/06/2026',
      },
    },
    cellOverrides: {
      B28: 12, C28: 12,
      B29: 4051, C29: 4051,
      B30: 2463, C30: 2463,
      B31: 11165, C31: 11165,
      B32: 6865, C32: 6865,
      B33: 4305, C33: 4305,
      B34: 18339, C34: 18339,
      B36: 2, C36: 2,
      B39: 0, C39: 0,
      B40: 3, C40: 3,
      B41: 3625, C41: 3625,
    },
  },
]

async function main() {
  const db = postgres(databaseUrl(), {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    connect_timeout: 30,
  })

  try {
    await db.unsafe(`
      CREATE TABLE IF NOT EXISTS kia_service_dashboard_snapshots (
        id bigserial PRIMARY KEY,
        dealer_code text NOT NULL DEFAULT 'all',
        report_date date NOT NULL,
        metrics jsonb NOT NULL,
        cell_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
        source_label text,
        is_verified boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (dealer_code, report_date)
      )
    `)
    await db.unsafe(`
      CREATE INDEX IF NOT EXISTS kia_service_dashboard_snapshots_report_date_idx
      ON kia_service_dashboard_snapshots (report_date DESC, dealer_code)
    `)

    for (const snapshot of snapshots) {
      for (const dealerCode of ['JK402', 'all']) {
        await db`
          INSERT INTO kia_service_dashboard_snapshots (
            dealer_code,
            report_date,
            metrics,
            cell_overrides,
            source_label,
            is_verified
          )
          VALUES (
            ${dealerCode},
            ${snapshot.reportDate}::date,
            ${db.json(snapshot.metrics)},
            ${db.json(snapshot.cellOverrides)},
            ${snapshot.sourceLabel},
            true
          )
          ON CONFLICT (dealer_code, report_date)
          DO UPDATE SET
            metrics = EXCLUDED.metrics,
            cell_overrides = EXCLUDED.cell_overrides,
            source_label = EXCLUDED.source_label,
            is_verified = EXCLUDED.is_verified,
            updated_at = now()
        `
        console.log(`[kia-service-dashboard] saved ${dealerCode} @ ${snapshot.reportDate} (${snapshot.sourceLabel})`)
      }
    }
  } finally {
    await db.end()
  }
}

main().catch((error) => {
  console.error('[kia-service-dashboard] snapshot setup failed', error)
  process.exit(1)
})
