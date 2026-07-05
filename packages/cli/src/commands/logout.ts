import { loadCliConfig, registryUrl, revokeCurrentToken, saveCliConfig } from "@envo/core";
import { defineCommand } from "citty";
import { consola } from "consola";

export const logoutCommand = defineCommand({
  meta: {
    description: "Log out of Envo on this machine",
  },
  async run() {
    const config = await loadCliConfig();
    const registry = registryUrl();

    if (config.token) {
      try {
        await revokeCurrentToken({ registry, token: config.token });
      } catch (error) {
        consola.warn(`Could not revoke token: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    delete config.token;
    await saveCliConfig(config);
    consola.success("logged out");
    consola.info(`registry: ${registry}`);
  },
});
