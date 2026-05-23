// ============================================================
//  Shared types for the grant portal
// ============================================================

export type AppStatus       = "pending" | "approved" | "denied";
export type ReceiptStatus   = "pending" | "approved" | "rejected";
export type RecipientStatus = "active"  | "completed" | "suspended";
export type BatchStatus     = "draft"   | "approved" | "exported" | "paid";
export type PayoutStatus    = "scheduled" | "approved" | "paid" | "cancelled";
export type Currency        = "CAD" | "USD";

export interface Child { age: number; grade: string; }

export interface Application {
  id: string;
  app_ref: string;
  parent_names: string;
  city: string;
  contact_email: string;
  contact_phone: string;
  income_range: string;
  current_schooling: string;
  children: Child[];
  answers: Record<string, string>;
  video_link: string | null;
  status: AppStatus;
  admin_notes: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface Recipient {
  id: string;
  application_id: string;
  profile_id: string | null;
  approved_amount: number;
  reimbursement_rate: number;
  status: RecipientStatus;
  address_street: string | null;
  address_city: string | null;
  address_postal: string | null;
  submission_deadline: string | null;
  grandfathered: boolean;
  created_at: string;
}

export interface Receipt {
  id: string;
  recipient_id: string;
  image_path: string;
  amount: number;
  currency: Currency;
  reimbursable_amount: number | null;     // admin sets at approval; CAD
  purchase_date: string | null;
  description: string | null;
  status: ReceiptStatus;
  admin_notes: string | null;
  created_at: string;
}

export interface PayoutBatch {
  id: string;
  scheduled_date: string;
  status: BatchStatus;
  total: number;
  ceo_reference: string | null;
  bucket: string | null;       // 'mid' | 'end' | 'legacy' | 'manual'
  exported_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface Payout {
  id: string;
  batch_id: string | null;
  recipient_id: string;
  amount: number;
  receipts_included: string[];
  status: PayoutStatus;
  paid_at: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  recipient_acknowledged_at: string | null;
  created_at: string;
}
