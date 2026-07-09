"use client";

import { ClientSDK } from "@sitecore-marketplace-sdk/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface MarketplaceClientState {
  client: ClientSDK | null;
  error: Error | null;
  isLoading: boolean;
  isInitialized: boolean;
}

export interface UseMarketplaceClientOptions {
  /** Number of retry attempts when initialization fails. @default 3 */
  retryAttempts?: number;
  /** Delay between retry attempts in milliseconds. @default 1000 */
  retryDelay?: number;
  /** Whether to automatically initialize the client. @default true */
  autoInit?: boolean;
}

const DEFAULT_OPTIONS: Required<UseMarketplaceClientOptions> = {
  retryAttempts: 3,
  retryDelay: 1000,
  autoInit: true,
};

// Singleton — the SDK should only be initialized once per page.
let client: ClientSDK | undefined = undefined;

async function getMarketplaceClient(): Promise<ClientSDK> {
  if (client) return client;
  client = await ClientSDK.init({
    target: window.parent,
  });
  return client;
}

export function useMarketplaceClient(
  options: UseMarketplaceClientOptions = {}
): MarketplaceClientState & { initialize: () => Promise<void> } {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const [state, setState] = useState<MarketplaceClientState>({
    client: client || null,
    error: null,
    isLoading: !client,
    isInitialized: !!client,
  });
  const isInitializingRef = useRef(false);

  const initializeClient = useCallback(async () => {
    if (isInitializingRef.current || client) {
      if (client) {
        setState({ client, error: null, isLoading: false, isInitialized: true });
      }
      return;
    }
    isInitializingRef.current = true;
    setState((s) => ({ ...s, isLoading: true }));

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < opts.retryAttempts; attempt++) {
      try {
        const c = await getMarketplaceClient();
        setState({ client: c, error: null, isLoading: false, isInitialized: true });
        isInitializingRef.current = false;
        return;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        await new Promise((r) => setTimeout(r, opts.retryDelay));
      }
    }

    setState({
      client: null,
      error: lastError ?? new Error("Failed to initialize MarketplaceClient"),
      isLoading: false,
      isInitialized: false,
    });
    isInitializingRef.current = false;
  }, [opts.retryAttempts, opts.retryDelay]);

  useEffect(() => {
    if (opts.autoInit) {
      initializeClient();
    }
    // Intentionally not tearing the client down on unmount — it is a
    // page-scoped singleton shared across every component in this app.
  }, [opts.autoInit, initializeClient]);

  return useMemo(
    () => ({ ...state, initialize: initializeClient }),
    [state, initializeClient]
  );
}
