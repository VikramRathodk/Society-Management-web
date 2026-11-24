/**
 * Razorpay Checkout, shared by platform invoices (the society pays the platform) and maintenance
 * (residents pay the society). Loads Razorpay's script once, on first use.
 */

export interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export interface RazorpayInstance {
  open(): void;
  on(event: string, handler: (response: { error?: { description?: string } }) => void): void;
}

export type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

let script: Promise<RazorpayConstructor> | null = null;

export function loadRazorpay(): Promise<RazorpayConstructor> {
  const existing = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
  if (existing) return Promise.resolve(existing);
  script ??= new Promise<RazorpayConstructor>((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = CHECKOUT_SCRIPT;
    tag.async = true;
    tag.onload = () => {
      const loaded = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
      if (loaded) resolve(loaded);
      else reject(new Error('Razorpay missing'));
    };
    tag.onerror = () => {
      script = null;
      tag.remove();
      reject(new Error('Razorpay failed to load'));
    };
    document.head.appendChild(tag);
  });
  return script;
}
