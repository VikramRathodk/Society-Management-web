import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-forbidden',
  imports: [RouterLink, MatButtonModule],
  template: `
    <h1>Access denied</h1>
    <p>You don't have permission to view this page.</p>
    <a mat-flat-button routerLink="/dashboard">Back to dashboard</a>
  `,
})
export class Forbidden {}
