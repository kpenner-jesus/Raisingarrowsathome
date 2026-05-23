"use client";
import { Toaster } from "./Toaster";

export function AdminProviders({ children }: { children: React.ReactNode }) {
  return <Toaster>{children}</Toaster>;
}
