import { z } from "zod";

/** Custom-quote request schema — shared by the form and /api/quote. */
export const quoteSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required").max(200),
  contactName: z.string().trim().min(1, "Contact name is required").max(200),
  email: z.string().trim().email("Enter a valid email address").max(320),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  productType: z.string().trim().min(1, "Tell us which product you need").max(200),
  dimensions: z.string().trim().max(200).optional().or(z.literal("")),
  quantity: z.string().trim().min(1, "Quantity is required").max(40),
  printing: z.string().trim().max(500).optional().or(z.literal("")),
  desiredDelivery: z.string().trim().max(100).optional().or(z.literal("")),
  postalCode: z.string().trim().max(12).optional().or(z.literal("")),
  notes: z.string().trim().max(4000).optional().or(z.literal("")),
});

export type QuoteRequest = z.infer<typeof quoteSchema>;
