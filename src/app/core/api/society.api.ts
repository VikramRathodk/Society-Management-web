import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { environment } from '../../../environments/environment';
import { Society } from '../models';

@Injectable({ providedIn: 'root' })
export class SocietyApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/societies`;

  list() {
    return this.http.get<Society[]>(this.baseUrl);
  }

  get(id: number) {
    return this.http.get<Society>(`${this.baseUrl}/${id}`);
  }
}
