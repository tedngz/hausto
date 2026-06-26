import { supabase as mainClient } from "./client";

export async function invokeFunction<T = unknown>(
  name: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ data: T | null; error: any }> {
  const { data, error } = await mainClient.functions.invoke(name, {
    body: options.body,
    headers: options.headers,
  });

  if (error) {
    console.error(`Error from ${name} function:`, error);
    throw error;
  }

  return { data, error };
}

export const functionsClient = { invoke: invokeFunction };

