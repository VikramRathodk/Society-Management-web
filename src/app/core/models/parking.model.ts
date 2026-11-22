/** Parking (backend module 17, a paid module): slots, allotment, waitlist, vehicles, visitor slots, reports. */

export type VehicleType = 'CAR' | 'BIKE' | 'OTHER';
export type SlotPurpose = 'RESIDENT' | 'VISITOR';
export type SlotState = 'FREE' | 'ALLOTTED' | 'INACTIVE';
export type ParkingRequestStatus = 'WAITING' | 'ALLOTTED' | 'REJECTED' | 'WITHDRAWN';
export type VehicleStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REMOVED';
/** FULL: the committee. FLAT: the vehicle's own flat. GATE: guards. */
export type VehicleView = 'FULL' | 'FLAT' | 'GATE';
export type ViolationKind = 'WRONG_SLOT' | 'NO_PARKING_ZONE' | 'DOUBLE_PARKING' | 'UNREGISTERED' | 'OTHER';
export type ViolationStatus = 'OPEN' | 'DISMISSED' | 'WARNED' | 'FINED';
export type ViolationOutcome = 'DISMISS' | 'WARN' | 'FINE';

export interface ParkingPerson {
  id: number;
  name: string;
}

export interface Allotment {
  id: number;
  slotId: number;
  slotNumber: string | null;
  flatId: number;
  /** "A-101" */
  flat: string;
  fromDate: string;
  toDate: string | null;
  current: boolean;
  note: string | null;
  surrendered: boolean;
  allottedBy: ParkingPerson | null;
  releasedBy: ParkingPerson | null;
}

export interface ParkingSlot {
  id: number;
  societyId: number;
  slotNumber: string;
  area: string | null;
  vehicleType: VehicleType;
  covered: boolean;
  purpose: SlotPurpose;
  /** Null: the society's default for its kind. */
  monthlyCharge: number | null;
  active: boolean;
  current: Allotment | null;
}

export interface SlotRequest {
  slotNumber: string;
  vehicleType: VehicleType;
  purpose?: SlotPurpose;
  area?: string | null;
  covered?: boolean;
  monthlyCharge?: number | null;
}

export interface BulkSlotsRequest {
  prefix: string;
  from: number;
  to: number;
  digits?: number | null;
  vehicleType: VehicleType;
  purpose?: SlotPurpose;
  area?: string | null;
  covered?: boolean;
  monthlyCharge?: number | null;
}

export interface ParkingRequest {
  id: number;
  flatId: number;
  flat: string;
  vehicleType: VehicleType;
  coveredPreferred: boolean;
  note: string | null;
  status: ParkingRequestStatus;
  /** Place in the vehicle type's queue (1 = next), while waiting. */
  position: number | null;
  requestedAt: string;
  requestedBy: ParkingPerson;
  decidedAt: string | null;
  reason: string | null;
  allotmentId: number | null;
}

export interface Vehicle {
  id: number;
  societyId: number;
  flatId: number;
  flat: string;
  registrationNumber: string;
  vehicleType: VehicleType;
  make: string | null;
  model: string | null;
  colour: string | null;
  status: VehicleStatus;
  stickerNumber: string | null;
  slotId: number | null;
  slotNumber: string | null;
  view: VehicleView;
  rcUrl: string | null;
  rejectionReason: string | null;
  createdBy: ParkingPerson | null;
  createdAt: string | null;
  approvedBy: ParkingPerson | null;
  approvedAt: string | null;
}

export interface RegisterVehicleRequest {
  registrationNumber: string;
  vehicleType: VehicleType;
  make?: string | null;
  model?: string | null;
  colour?: string | null;
  slotId?: number | null;
}

/** null/undefined leaves a field unchanged; clearSlot unlinks the slot. */
export interface UpdateVehicleRequest {
  registrationNumber?: string;
  vehicleType?: VehicleType;
  make?: string;
  model?: string;
  colour?: string;
  slotId?: number;
  clearSlot?: boolean;
}

export interface FlatParking {
  flatId: number;
  flat: string;
  slots: ParkingSlot[];
  past: Allotment[];
  requests: ParkingRequest[];
  vehicles: Vehicle[];
}

export interface VisitorParking {
  id: number;
  slotId: number;
  slotNumber: string;
  visitorId: number;
  flatId: number;
  flat: string;
  vehicleNumber: string | null;
  fromAt: string;
  toAt: string | null;
  flatChargeId: number | null;
}

export interface VisitorSlot {
  slotId: number;
  slotNumber: string;
  area: string | null;
  vehicleType: VehicleType;
  occupied: boolean;
  parking: VisitorParking | null;
  visitorName: string | null;
  overstaying: boolean;
}

export interface Violation {
  id: number;
  societyId: number;
  vehicleNumber: string;
  kind: ViolationKind;
  flatId: number | null;
  flat: string | null;
  registered: boolean;
  slotId: number | null;
  slotNumber: string | null;
  place: string | null;
  note: string | null;
  photoUrl: string | null;
  reportedAt: string;
  reply: string | null;
  repliedAt: string | null;
  status: ViolationStatus;
  fineAmount: number | null;
  decisionNote: string | null;
  decidedAt: string | null;
  view: 'FULL' | 'FLAT';
  /** The committee only. */
  reportedBy: ParkingPerson | null;
  decidedBy: ParkingPerson | null;
  /** Warnings and fines against the flat over the last 12 months (committee only). */
  flatOffences: number | null;
}

export interface ReportViolationRequest {
  vehicleNumber: string;
  kind: ViolationKind;
  slotId?: number | null;
  place?: string | null;
  note?: string | null;
}
