import zipfile, sys
from xml.etree import ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
M = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
z = zipfile.ZipFile(sys.argv[1])
ss = ET.fromstring(z.read('xl/sharedStrings.xml'))
S = [''.join(t.text or '' for t in si.iter(M + 't')) for si in ss.findall('m:si', NS)]
sh = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))

rows = []
for r in sh.iter(M + 'row'):
    cells = {}
    for c in r.findall('m:c', NS):
        v = c.find('m:v', NS)
        isel = c.find('m:is', NS)
        if isel is not None:
            val = ''.join(x.text or '' for x in isel.iter(M + 't'))
        elif v is None or v.text is None:
            continue
        elif c.get('t') == 's':
            val = S[int(v.text)]
        else:
            val = v.text
        cells[''.join(ch for ch in c.get('r') if ch.isalpha())] = str(val).strip()
    rows.append((int(r.get('r')), cells))

# The GSM's manual sheet — the reference we must match. label -> (today, mtd)
REF = {
    'Free Service': ('3', '67'), 'Paid Service': ('4', '69'), 'Running Repair': ('1', '68'),
    'Accidental Repair': ('0', '59'), 'Total Vehicle': ('8', '263'),
    'Accidental Pending Vehicle': ('0', '10'), 'Mechanical Pending Vehicle': ('1', '6'),
    'E/W': ('0', '4'), 'RSA': ('1', '26'), 'SOT/MCP': ('0', '0'), 'Bodyshop SOT/MCP': ('0', '0'),
    'Total Labour': ('148587', '1270704'), 'Total Parts': ('135404', '1953730'),
    'Mechanical Labour': ('20700', '466696'), 'Mechanical Parts': ('31965', '768680'),
    'Bodyshop Labour': ('127887', '804008'), 'Bodyshop Parts': ('103439', '1185050'),
    'Free Service Delivered': ('4', '66'), 'Paid Service Delivered': ('5', '69'),
    'Running Repair Delivered': ('0', '63'), 'Accidental Repair Delivered': ('5', '50'),
    'Total Delivered': ('14', '248'),
    'Alignment': ('93', '93'), 'Balancing': ('69', '69'),
    'Alignment Labour': ('56773', '56773'), 'Balancing Labour': ('42593', '42593'),
    'Average RO': ('8', '8'),
    'Average Labour': ('5124', '4617'), 'Average Labour Mech': ('2357', '1826'),
    'Average Labour BS': ('16080', '15670'), 'Average Parts': ('7878', '7238'),
    'Average Parts Mech': ('3882', '3080'), 'Average Parts BS': ('23701', '23701'),
    'Engine Oil Qty LTRS': ('434', '434'), 'Oil Sale per RO QTY': ('2', '2'),
    'SYNTHETIC OIL QTY LTS': ('0', '0'), 'SYNTHETIC Oil Sale per RO QTY': ('0', '0'),
    'Oil PER RO BODYSHOP': ('0', '0'), 'Oil PER RO MECH': ('2', '2'),
    'Average Labour Per Ro Without VAS': ('4617', '4617'),
    'Bodyshop PNA Cases': ('6', '6'),
}

def norm(x):
    x = (x or '').strip()
    try:
        f = float(x)
        return str(int(round(f)))
    except Exception:
        return x

print('EXPORT ROWS (label | today | mtd)   vs   GSM SHEET')
print('=' * 96)
cols = ['A', 'B', 'C', 'D', 'E']
match = mismatch = missing = 0
seen = set()
for rn, c in rows:
    label = (c.get('A') or '').strip()
    if not label:
        continue
    vals = [c.get(k, '') for k in cols[1:]]
    vals = [v for v in vals if v != '']
    ref = REF.get(label)
    if ref is None:
        print(f'  ??  {label:<36} export={vals}   (not in the GSM sheet)')
        continue
    seen.add(label)
    got_today = norm(vals[0]) if len(vals) > 0 else ''
    got_mtd = norm(vals[1]) if len(vals) > 1 else got_today
    ok_t = got_today == norm(ref[0])
    ok_m = got_mtd == norm(ref[1])
    if ok_t and ok_m:
        match += 1
        print(f'  ok  {label:<36} {got_today:>10} {got_mtd:>12}')
    else:
        mismatch += 1
        print(f'  XX  {label:<36} export {got_today:>10} {got_mtd:>12}   |  GSM {ref[0]:>10} {ref[1]:>12}')

for k in REF:
    if k not in seen:
        missing += 1
        print(f'  --  {k:<36} MISSING from the export   |  GSM {REF[k][0]:>10} {REF[k][1]:>12}')

print('=' * 96)
print(f'match {match} · mismatch {mismatch} · missing {missing}')
