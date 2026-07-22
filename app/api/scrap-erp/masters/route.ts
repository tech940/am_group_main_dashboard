import { NextResponse } from 'next/server'
import {
  DEFAULT_SCRAP_GROUPS,
  DEFAULT_SCRAP_LOCATIONS,
  DEFAULT_SCRAP_DEPARTMENTS,
  DEFAULT_SCRAP_TYPES,
  DEFAULT_SCRAP_DESCRIPTIONS,
  DEFAULT_SCRAP_EMPLOYEES,
  DEFAULT_SCRAP_PAYMENT_MODES,
  DEFAULT_SCRAP_HANDOVER_USERS,
} from '@/lib/scrap-erp/mock-data'
import {
  ScrapGroup,
  ScrapLocation,
  ScrapDepartment,
  ScrapType,
  ScrapDescription,
  ScrapEmployee,
  ScrapPaymentMode,
  ScrapHandoverUser,
} from '@/lib/scrap-erp/types'

let groupsStore: ScrapGroup[] = [...DEFAULT_SCRAP_GROUPS]
let locationsStore: ScrapLocation[] = [...DEFAULT_SCRAP_LOCATIONS]
let departmentsStore: ScrapDepartment[] = [...DEFAULT_SCRAP_DEPARTMENTS]
let typesStore: ScrapType[] = [...DEFAULT_SCRAP_TYPES]
let descriptionsStore: ScrapDescription[] = [...DEFAULT_SCRAP_DESCRIPTIONS]
let employeesStore: ScrapEmployee[] = [...DEFAULT_SCRAP_EMPLOYEES]
let paymentModesStore: ScrapPaymentMode[] = [...DEFAULT_SCRAP_PAYMENT_MODES]
let handoverUsersStore: ScrapHandoverUser[] = [...DEFAULT_SCRAP_HANDOVER_USERS]

export async function GET() {
  return NextResponse.json({
    success: true,
    masters: {
      groups: groupsStore,
      locations: locationsStore,
      departments: departmentsStore,
      scrapTypes: typesStore,
      descriptions: descriptionsStore,
      employees: employeesStore,
      paymentModes: paymentModesStore,
      handoverUsers: handoverUsersStore,
    },
  })
}

export async function POST(request: Request) {
  try {
    const { category, item } = await request.json()

    if (!category || !item || !item.name) {
      return NextResponse.json({ error: 'Category and item name are required' }, { status: 400 })
    }

    const newItemId = `${category}-${Date.now()}`

    switch (category) {
      case 'group': {
        const newGrp: ScrapGroup = {
          id: newItemId,
          name: item.name,
          code: item.code || item.name,
        }
        groupsStore = [...groupsStore, newGrp]
        return NextResponse.json({ success: true, item: newGrp, category })
      }
      case 'location': {
        const newLoc: ScrapLocation = {
          id: newItemId,
          name: item.name,
          code: item.code || `LOC-${locationsStore.length + 1}`,
          address: item.address || '',
        }
        locationsStore = [...locationsStore, newLoc]
        return NextResponse.json({ success: true, item: newLoc, category })
      }
      case 'department': {
        const newDept: ScrapDepartment = {
          id: newItemId,
          name: item.name,
          code: item.code || `DEPT-${departmentsStore.length + 1}`,
        }
        departmentsStore = [...departmentsStore, newDept]
        return NextResponse.json({ success: true, item: newDept, category })
      }
      case 'scrapType': {
        const newType: ScrapType = {
          id: newItemId,
          name: item.name,
          unit: item.unit || 'Kg',
          defaultRatePerUnit: Number(item.defaultRatePerUnit || 0),
        }
        typesStore = [...typesStore, newType]
        return NextResponse.json({ success: true, item: newType, category })
      }
      case 'description': {
        const newDesc: ScrapDescription = {
          id: newItemId,
          scrapTypeId: item.scrapTypeId || '',
          name: item.name,
        }
        descriptionsStore = [...descriptionsStore, newDesc]
        return NextResponse.json({ success: true, item: newDesc, category })
      }
      case 'employee':
      case 'soldBy': {
        const newEmp: ScrapEmployee = {
          id: newItemId,
          name: item.name,
          role: item.role || 'Staff',
          phone: item.phone || '',
        }
        employeesStore = [...employeesStore, newEmp]
        return NextResponse.json({ success: true, item: newEmp, category })
      }
      case 'paymentMode': {
        const newPm: ScrapPaymentMode = {
          id: newItemId,
          name: item.name,
          isOnline: Boolean(item.isOnline),
        }
        paymentModesStore = [...paymentModesStore, newPm]
        return NextResponse.json({ success: true, item: newPm, category })
      }
      case 'handoverUser':
      case 'paymentHandoverTo': {
        const newHo: ScrapHandoverUser = {
          id: newItemId,
          name: item.name,
          designation: item.designation || 'Staff',
        }
        handoverUsersStore = [...handoverUsersStore, newHo]
        return NextResponse.json({ success: true, item: newHo, category })
      }
      default:
        return NextResponse.json({ error: 'Invalid master category' }, { status: 400 })
    }
  } catch (error) {
    console.error('Error in POST /api/scrap-erp/masters:', error)
    return NextResponse.json({ error: 'Failed to update master data' }, { status: 500 })
  }
}
