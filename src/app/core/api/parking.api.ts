import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { inlineErrors } from '../auth/error.interceptor';
import {
  Allotment,
  BulkSlotsRequest,
  FlatParking,
  ParkingRequest,
  ParkingSlot,
  RegisterVehicleRequest,
  ReportViolationRequest,
  SlotPurpose,
  SlotRequest,
  SlotState,
  UpdateVehicleRequest,
  Vehicle,
  VehicleStatus,
  VehicleType,
  Violation,
  ViolationOutcome,
  ViolationStatus,
  VisitorParking,
  VisitorSlot,
} from '../models';

/** Drops null/undefined/empty values so they don't reach the query string. */
function params(source: object): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value != null && value !== '') out[key] = value as string | number | boolean;
  }
  return out;
}

/** Multipart form: text fields plus optional files (no Content-Type header: the browser sets it). */
function form(fields: object, files: Record<string, File | null | undefined> = {}): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value != null && value !== '') fd.append(key, String(value));
  }
  for (const [key, file] of Object.entries(files)) if (file) fd.append(key, file);
  return fd;
}

@Injectable({ providedIn: 'root' })
export class ParkingApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/api`;

  // ---- Slots (committee) ----

  slots(societyId: number, filter: { purpose?: SlotPurpose | null; type?: VehicleType | null; area?: string | null; state?: SlotState | null } = {}) {
    return this.http.get<ParkingSlot[]>(`${this.base}/societies/${societyId}/parking/slots`, { params: params(filter) });
  }

  createSlot(societyId: number, request: SlotRequest) {
    return this.http.post<ParkingSlot>(`${this.base}/societies/${societyId}/parking/slots`, request, { context: inlineErrors() });
  }

  createSlots(societyId: number, request: BulkSlotsRequest) {
    return this.http.post<ParkingSlot[]>(`${this.base}/societies/${societyId}/parking/slots/bulk`, request, {
      context: inlineErrors(),
    });
  }

  updateSlot(id: number, request: SlotRequest) {
    return this.http.put<ParkingSlot>(`${this.base}/parking/slots/${id}`, request, { context: inlineErrors() });
  }

  setActive(id: number, active: boolean) {
    return this.http.post<ParkingSlot>(`${this.base}/parking/slots/${id}/${active ? 'activate' : 'deactivate'}`, {});
  }

  deleteSlot(id: number) {
    return this.http.delete<void>(`${this.base}/parking/slots/${id}`);
  }

  /** note: required when the slot goes past the head of the waitlist (400, shown inline). */
  allot(slotId: number, request: { flatId: number; from?: string | null; note?: string | null; requestId?: number | null }) {
    return this.http.post<ParkingSlot>(`${this.base}/parking/slots/${slotId}/allot`, request, { context: inlineErrors() });
  }

  release(slotId: number, request: { on?: string | null; note?: string | null } = {}) {
    return this.http.post<ParkingSlot>(`${this.base}/parking/slots/${slotId}/release`, request, { context: inlineErrors() });
  }

  history(slotId: number) {
    return this.http.get<Allotment[]>(`${this.base}/parking/slots/${slotId}/history`);
  }

  waitlist(societyId: number, type?: VehicleType | null) {
    return this.http.get<ParkingRequest[]>(`${this.base}/societies/${societyId}/parking/waitlist`, { params: params({ type }) });
  }

  rejectRequest(id: number, reason: string) {
    return this.http.post<ParkingRequest>(`${this.base}/parking/requests/${id}/reject`, { reason }, { context: inlineErrors() });
  }

  /** what: allotments | vehicles | violations. */
  export(societyId: number, what: 'allotments' | 'vehicles' | 'violations') {
    return this.http.get(`${this.base}/societies/${societyId}/parking/export`, {
      params: { what },
      responseType: 'blob',
      observe: 'response',
    });
  }

  // ---- A flat ----

  ofFlat(flatId: number) {
    return this.http.get<FlatParking>(`${this.base}/flats/${flatId}/parking`);
  }

  ask(flatId: number, request: { vehicleType: VehicleType; coveredPreferred?: boolean; note?: string | null }) {
    return this.http.post<ParkingRequest>(`${this.base}/flats/${flatId}/parking/requests`, request, { context: inlineErrors() });
  }

  withdraw(requestId: number) {
    return this.http.post<ParkingRequest>(`${this.base}/parking/requests/${requestId}/withdraw`, {});
  }

  surrender(slotId: number) {
    return this.http.post<ParkingSlot>(`${this.base}/parking/slots/${slotId}/surrender`, {});
  }

  // ---- Vehicles ----

  registerVehicle(flatId: number, request: RegisterVehicleRequest, rc?: File | null) {
    return this.http.post<Vehicle>(`${this.base}/flats/${flatId}/vehicles`, form(request, { rc }), { context: inlineErrors() });
  }

  updateVehicle(id: number, request: UpdateVehicleRequest) {
    return this.http.put<Vehicle>(`${this.base}/vehicles/${id}`, request, { context: inlineErrors() });
  }

  removeVehicle(id: number) {
    return this.http.delete<Vehicle>(`${this.base}/vehicles/${id}`);
  }

  approveVehicle(id: number) {
    return this.http.post<Vehicle>(`${this.base}/vehicles/${id}/approve`, {});
  }

  rejectVehicle(id: number, reason: string) {
    return this.http.post<Vehicle>(`${this.base}/vehicles/${id}/reject`, { reason }, { context: inlineErrors() });
  }

  vehicles(societyId: number, query: { status?: VehicleStatus | null; q?: string | null } = {}, options: { silent?: boolean } = {}) {
    return this.http.get<Vehicle[]>(`${this.base}/societies/${societyId}/vehicles`, {
      params: params(query),
      context: options.silent ? inlineErrors() : undefined,
    });
  }

  /** At the gate: 400 (fewer than 3 characters) is shown inline; an empty list means "not registered". */
  searchVehicles(societyId: number, number: string) {
    return this.http.get<Vehicle[]>(`${this.base}/societies/${societyId}/vehicles/search`, {
      params: { number },
      context: inlineErrors(),
    });
  }

  rc(id: number) {
    return this.http.get(`${this.base}/vehicles/${id}/rc`, { responseType: 'blob' });
  }

  // ---- Visitor parking ----

  visitorSlots(societyId: number, options: { silent?: boolean } = {}) {
    return this.http.get<VisitorSlot[]>(`${this.base}/societies/${societyId}/parking/visitor-slots`, {
      context: options.silent ? inlineErrors() : undefined,
    });
  }

  parkVisitor(visitorId: number, slotId: number, vehicleNumber?: string | null) {
    return this.http.post<VisitorParking>(`${this.base}/visitors/${visitorId}/parking`, { slotId, vehicleNumber: vehicleNumber || null }, {
      context: inlineErrors(),
    });
  }

  freeVisitorSlot(parkingId: number) {
    return this.http.post<VisitorParking>(`${this.base}/parking/visitor/${parkingId}/free`, {});
  }

  // ---- Violations ----

  report(societyId: number, request: ReportViolationRequest, photo?: File | null) {
    return this.http.post<Violation>(`${this.base}/societies/${societyId}/parking/violations`, form(request, { photo }), {
      context: inlineErrors(),
    });
  }

  violations(societyId: number, status?: ViolationStatus | null, options: { silent?: boolean } = {}) {
    return this.http.get<Violation[]>(`${this.base}/societies/${societyId}/parking/violations`, {
      params: params({ status }),
      context: options.silent ? inlineErrors() : undefined,
    });
  }

  violationsOfFlat(flatId: number) {
    return this.http.get<Violation[]>(`${this.base}/flats/${flatId}/parking/violations`);
  }

  violationPhoto(id: number) {
    return this.http.get(`${this.base}/parking/violations/${id}/photo`, { responseType: 'blob' });
  }

  reply(id: number, text: string) {
    return this.http.post<Violation>(`${this.base}/parking/violations/${id}/reply`, { text }, { context: inlineErrors() });
  }

  decide(id: number, outcome: ViolationOutcome, amount?: number | null, note?: string | null) {
    return this.http.post<Violation>(`${this.base}/parking/violations/${id}/decide`, { outcome, amount: amount ?? null, note: note || null }, {
      context: inlineErrors(),
    });
  }
}
