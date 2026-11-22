import { AuthStore } from '../../core/auth/auth.store';
import { canOpenMyParking, canOpenParkingGate } from './parking-access';
import { inr, kindLabel, requestState, slotLabel, vehicleState, vehicleTypeLabel, violationState } from './parking-ui';

describe('parking labels', () => {
  it('describes a slot by kind, cover and area', () => {
    expect(slotLabel({ vehicleType: 'CAR', covered: true, area: 'Basement 1', purpose: 'RESIDENT' })).toBe('Car, covered · Basement 1');
    expect(slotLabel({ vehicleType: 'BIKE', covered: false, area: null, purpose: 'RESIDENT' })).toBe('Two-wheeler');
    expect(slotLabel({ vehicleType: 'CAR', covered: false, area: 'Gate', purpose: 'VISITOR' })).toBe('Visitor, open · Gate');
  });

  it('names states and kinds', () => {
    expect(vehicleTypeLabel('OTHER')).toBe('Other');
    expect(kindLabel('DOUBLE_PARKING')).toBe('Double parking');
    expect(requestState('WAITING').tone).toBe('warning');
    expect(vehicleState('APPROVED').label).toBe('Approved');
    expect(violationState('FINED').tone).toBe('danger');
    expect(inr(1500)).toBe('₹1,500');
    expect(inr(null)).toBe('');
  });
});

describe('parking access', () => {
  const auth = (permissions: string[], flatId: number | null) =>
    ({
      can: (p: string, societyId?: number | null) => societyId === 1 && permissions.includes(p),
      user: () => ({ roles: [{ societyId: 1, flatId }] }),
    }) as unknown as AuthStore;

  it('opens "My parking" for residents with a flat', () => {
    expect(canOpenMyParking(auth(['PARKING.SLOT.VIEW'], 4), 1)).toBe(true);
    expect(canOpenMyParking(auth(['PARKING.SLOT.VIEW'], null), 1)).toBe(false);
  });

  it('opens the parking gate for guards', () => {
    expect(canOpenParkingGate(auth(['PARKING.GATE.VIEW'], null), 1)).toBe(true);
    expect(canOpenParkingGate(auth([], null), 1)).toBe(false);
  });
});
