"use client";

import { useEffect, useState } from "react";
import type { ApplicationContext } from "@sitecore-marketplace-sdk/client";
import { useMarketplaceClient } from "@/utils/hooks/useMarketplaceClient";
import TransferConsole from "@/components/TransferConsole";

export default function StandaloneExtensionPage() {
  const { client, error, isInitialized } = useMarketplaceClient();
  const [appContext, setAppContext] = useState<ApplicationContext>();

  useEffect(() => {
    if (!error && isInitialized && client) {
      client
        .query("application.context")
        .then((res) => setAppContext(res.data))
        .catch((e) => console.error("Error retrieving application.context:", e));
    }
  }, [client, error, isInitialized]);

  return <TransferConsole orgLabel={appContext?.name} />;
}
