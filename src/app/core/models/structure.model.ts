export interface Complex {
  id: number;
  name: string;
  address: string | null;
}

export interface Society {
  id: number;
  name: string;
  address: string | null;
  complexId: number | null;
}

export interface CreateSocietyRequest {
  name: string;
  address?: string;
  complexId?: number;
}

export interface UpdateSocietyRequest {
  name?: string;
  address?: string;
}

export interface Wing {
  id: number;
  societyId: number;
  name: string;
}

export interface Flat {
  id: number;
  wingId: number;
  flatNumber: string;
}
